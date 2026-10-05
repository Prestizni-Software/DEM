# Performance Analysis & Startup Optimization (18s -> ~120ms)

## 1. Problem Statement & Profiler Analysis (Phase 1: Sept 2026)
Analysis of the initial Firefox profiler trace (`Firefox 2026-09-16 08.45 profile.json`) and network HAR archive (`localhost_Archive [26-09-16 08-54-16].har`) revealed that initializing the client with a 3.4 MB pre-populated payload (8,513 objects across 11 managers) was taking ~18 seconds, freezing the main browser thread for over 7.33 seconds.

### Root Causes Identified
1. **Unnecessary Deep Cloning on Ingestion**:
   - `handleDataCleanup()` invoked `_.cloneDeepWith()` recursively over 8,513 pre-parsed JSON objects.
2. **Metadata Walk Overhead (127,000+ Calls)**:
   - On every instance instantiation, `getMetadataRecursive()` walked constructor prototypes repeatedly up the inheritance chain to discover `@props()` and `@ref()`.
3. **V8 Shape De-optimization & Closure Allocation**:
   - `generateSettersAndGetters()` called `delete this[key]` and `Object.defineProperty(this, key, ...)` per property on each instance (~127,500 property definitions).
   - Calling `delete` on instances forced V8 into Dictionary/Hash-table mode and created ~250,000 getter/setter closures.
4. **TypeScript ES2024 Class Field Shadowing**:
   - In modern TypeScript (`useDefineForClassFields: true`), derived class declarations like `public name!: string;` initialize instance properties to `undefined` after `super()`, masking prototype accessors unless removed or configured once on the prototype.
5. **Slow Reference Lookups**:
   - `findReference()` iterated through managers rather than checking `globalCache.objects[id]` in $O(1)$.

---

## 2. Phase 2 Profile Analysis (October 5, 2026)
Analysis of the subsequent profiler trace (`performance/Firefox 2026-10-05 08.04 profile.json`, 19.05s trace on `https://origeoapp.p-soft.cz/`, PID 24988, TID 24992) identified remaining runtime memory churn and GC pressure points:

1. **SpiderMonkey Nursery GC & Tenuring Pressure (~792ms GC pause time)**:
   - Reading multi-reference properties repeatedly allocated 2 new arrays per property access via `.map().filter(Boolean)`.
   - Dynamic `.objectsAsArray` getter allocated an 8,500-element array on every property read in React components and internal sweeps.
2. **Ingestion Normalization Loop Allocations**:
   - `handleDataCleanup()` iterated over all properties and re-mapped arrays even when array items were already string IDs.
3. **Constructor `ObjectId` Generation**:
   - Every object instantiation ran `new ObjectId().toHexString()` for `EmitterID` generation (8,500 BSON byte allocations and crypto/timestamp calculations).
4. **Server-Only Dead Memory Structures on Client Objects**:
   - `toChangeOnParents: []` and `checkedMissingProperties: {}` allocated 17,000 empty arrays/objects across client instances.
5. **Socket.IO Transport Polling Fallback**:
   - HTTP Long-polling fallback caused continuous polling requests (1.9s - 10.1s), packet string decoding churn, and latency spikes.

---

## 3. Implemented Optimizations (Phase 1 & Phase 2)

### A. Prototype-Level Accessor Compilation & Metadata Caching (`AutoUpdatedClientObjectClass.ts`)
- Added `setupClassAccessors(classParam)`:
  - Computes and caches `properties`, `refProps`, and `refsToMap` on the class constructor prototype once.
  - Defines all getters and setters on `classParam.prototype` once per class instead of per instance.
  - Preserves V8/SpiderMonkey fast shapes and avoids closure memory overhead.
- In `generateSettersAndGetters()`:
  - Deletes own shadowing properties initialized by ES2024 class field declarations so prototype accessors take effect immediately.

### B. Fast Reference Array Resolution without Array Allocations
- In `setupClassAccessors` getter:
  - Replaced `.map().filter(Boolean)` with a single pre-allocated array loop, eliminating millions of temporary array and closure allocations during rendering.

### C. `objectsAsArray` Memoization & Event-Driven Invalidation
- Cached `_cachedObjectsArray` on `AutoUpdateClientManager` and `AutoUpdateServerManager`.
- Invalidated only on mutations (`createObject`, `deleteObject`, `loadFromServer`), eliminating redundant array copies on every read.

### D. Zero-Allocation `EmitterID` Generation
- Replaced `new ObjectId().toHexString()` with an atomic integer counter (`dem_e_${++counter}`), cutting 8,500 BSON allocations on startup.

### E. Selective Normalization in `handleDataCleanup`
- Iterates only over `refProps` and skips array re-mapping if items are already string IDs.

### F. Lazy Server-Only Property Allocation
- Made `toChangeOnParents` and `checkedMissingProperties` optional/lazy, saving 17,000 dead memory allocations per client session.

### G. Database & Concurrency Optimizations (`AutoUpdatedServerObjectClass.ts`)
- In `setValueInternal()`, database updates use `model.updateOne({ _id }, { $set: { [key]: value } })` to eliminate Mongoose parallel save contention.
- Internal updates in `onUpdate` bypass `writeQueue` chaining to prevent promise deadlocks.

---

## 4. Benchmark Results

| Metric | Baseline | Phase 1 Optimization | Phase 2 Optimization |
| :--- | :--- | :--- | :--- |
| **Startup Ingestion (8,513 objects)** | ~18,000 ms | ~190 ms | **~110 ms - 140 ms** |
| **Main Thread Freeze** | 7.33 s | < 150 ms | **< 40 ms** |
| **Total Test Suite Execution Time** | 25.14 s | 20.99 s | **10.37 s (~2.4x faster)** |
| **Getter/Setter Allocations** | ~255,000 | ~30 (per-class) | **~30 (per-class)** |
| **Getter Read Array Churn** | High | High | **Zero unnecessary arrays** |
| **V8 / SpiderMonkey Optimization** | Dictionary Mode | Fast Shapes | **Fast Shapes + Zero Nursery GC Churn** |

---

## 5. Test Suite Structure

Tests are organized into dedicated categories in `package.json`:
- `npm run test:basic`: All 15 core functionality test suites (69 tests).
- `npm run test:perf`: Scalability & startup benchmark with 8,500+ objects across 9 managers (`tests/performance.test.ts`).
- `npm run test:optional`: Extended audit & regression catalog (`tests/issue_regression.test.ts`).
- `npm run test_for_AI`: Complete automated regression and performance verification (70 tests).

