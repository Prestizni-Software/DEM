# Smart Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Smart Lazy Loading in DEM to enable lightweight startup manifests with human-readable descriptors, on-demand graph hydration up to configurable depth (default 2), cycle protection, and native self-contained snapshot entities.

**Architecture:** Extend DEM server and client manager handshakes to negotiate lazy mode. On startup, lazy managers stream identifier manifests with entity descriptors instead of full payloads. When an entity is accessed or explicitly loaded, the server resolves the entity graph to the requested depth in a single round-trip, and the client hydrates entities into local manager caches. Self-contained snapshot entities are natively supported via plain `@classProp` definitions.

**Tech Stack:** TypeScript, Socket.IO, EventEmitter3, Jest.

**Spec:** [docs/adr/0001-smart-lazy-loading-and-static-snapshots.md](../../adr/0001-smart-lazy-loading-and-static-snapshots.md) and [GLOSSARY.md](../../../GLOSSARY.md).

## Global Constraints

- Strict type safety: no `as any` unless required for dynamic prototype reflection.
- ASD-STE100 controlled language for in-code comments and JSDoc blocks.
- Full JSDoc documentation for all new/modified methods and properties.
- Backward compatibility: eager loading remains the default behavior for unconfigured managers.
- `npx tsc --noEmit` and `npm run test_for_AI` must pass cleanly at every task boundary.

## Review Focus

1. **Circular Reference Graphs**: Bi-directional references (A -> B -> A) must terminate safely during depth-bounded traversal without stack overflow.
2. **Missing Reference Gracefulness**: References pointing to deleted or non-existent IDs must resolve as `undefined` without throwing or stalling graph hydration.
3. **Concurrent Hydration Requests**: Multiple concurrent `loadObject` requests for the same entity or overlapping subgraphs must deduplicate in-flight promises.
4. **Manifest Desynchronization**: Creating a new entity on the server must immediately update client manifests and stub collections.
5. **Eager Manager Regression**: Existing eager managers must maintain identical startup, delta sync, and reference loading behaviors without performance degradation.

---

### Task 1: Type Definitions and Descriptor Contracts

**Files:**
- Modify: `CommonTypes.ts`
- Test: `tests/lazy_loading_types.test.ts`

- [x] **Step 1: Write failing type and descriptor contract tests**
  Define test verifying `EntityDescriptor` interface, startup response `manifest` payload, and base `getDescriptor` method fallback behavior.
- [x] **Step 2: Run test to confirm failure**
  Run `npx jest tests/lazy_loading_types.test.ts` to verify compilation or test failure.
- [x] **Step 3: Implement type definitions in `CommonTypes.ts`**
  Add `EntityDescriptor`, `LazyLoadingOptions`, update `StartupResponse`, and declare `getDescriptor` contract on base interfaces.
- [x] **Step 4: Verify type checking and tests**
  Run `npx tsc --noEmit` and `npx jest tests/lazy_loading_types.test.ts`.
- [x] **Step 5: Pre-commit verification**
  Confirm passing status and clean output.

---

### Task 2: Server-Side Lazy Manifest & Graph Traversal Engine

**Files:**
- Modify: `AutoUpdateServerManagerClass.ts`
- Test: `tests/lazy_loading_server.test.ts`

- [x] **Step 1: Write failing server lazy startup and traversal tests**
  Create tests for:
  - Startup handshake with `lazyLoading: true` returning `status: "lazy"` and `{ _id, description }[]` manifest.
  - On-demand `EVENT_GET` handling with `{ depth: 2 }` resolving root entity and 2-hop related entities.
  - Cycle detection preventing infinite recursion on circular entity graphs.
- [x] **Step 2: Run tests to verify failure**
  Run `npx jest tests/lazy_loading_server.test.ts` to confirm test failure.
- [x] **Step 3: Implement server manifest generation and graph traversal**
  - Add `lazyLoading` option to `AutoUpdateServerManagerOptions`.
  - In `EVENT_STARTUP`, generate manifest descriptors using `static getDescriptor` or JSON fallback.
  - In `EVENT_GET`, implement recursive reference traversal up to requested `depth` using a `visited = new Set<string>()`.
  - Pack root and related entities into the response.
- [x] **Step 4: Verify server tests pass**
  Run `npx jest tests/lazy_loading_server.test.ts` and `npx tsc --noEmit`.
- [x] **Step 5: Regression check**
  Run `npm run test_for_AI` to ensure no eager server tests break.

---

### Task 3: Client-Side Manifest Processing & On-Demand Hydration

**Files:**
- Modify: `AutoUpdateClientManagerClass.ts`
- Modify: `AutoUpdatedClientObjectClass.ts`
- Test: `tests/lazy_loading_client.test.ts`

- [x] **Step 1: Write failing client lazy loading tests**
  Create tests for:
  - Receiving `status: "lazy"` and populating `manager.manifest`.
  - Instantiating unhydrated stub objects in `objects_`.
  - Calling `await manager.loadObject(id, { depth: 2 })` and verifying synchronous getters work afterwards.
  - Calling `await obj.ensureLoaded({ depth: 2 })` on stub instances.
  - In-flight deduplication of concurrent `loadObject` calls.
- [x] **Step 2: Run tests to verify failure**
  Run `npx jest tests/lazy_loading_client.test.ts` to confirm failure.
- [x] **Step 3: Implement client manifest processing and hydration logic**
  - In `AutoUpdateClientManagerClass.ts`, handle `status: "lazy"` in `loadFromServer`.
  - Implement `manager.manifest` property and stub registration.
  - Implement `manager.loadObject(_id, options)` with deduplication.
  - In `AutoUpdatedClientObjectClass.ts`, implement `ensureLoaded(options)`.
  - Implement base `static getDescriptor(data)`.
- [x] **Step 4: Verify client tests pass**
  Run `npx jest tests/lazy_loading_client.test.ts` and `npx tsc --noEmit`.
- [x] **Step 5: Full test suite verification**
  Run `npm run test_for_AI`.

---

### Task 4: End-to-End Integration, Real-Time Manifest Updates, and Self-Contained Entities

**Files:**
- Modify: `AutoUpdateServerManagerClass.ts`
- Modify: `AutoUpdateClientManagerClass.ts`
- Test: `tests/lazy_loading_e2e.test.ts`

- [x] **Step 1: Write failing end-to-end integration tests**
  Create comprehensive integration tests for:
  - Full client-server lifecycle with lazy loading enabled.
  - Dynamic `new<ClassName>` event broadcasting descriptor updates to client manifests.
  - Self-contained entity verification (standard class with `@classProp` and no `@populatedRef` returning raw stored objects/IDs).
  - Mixed ecosystem (eager managers and lazy managers co-existing on the same socket).
- [x] **Step 2: Run tests to confirm failure**
  Run `npx jest tests/lazy_loading_e2e.test.ts`.
- [x] **Step 3: Implement real-time broadcast and finalize integration**
  - Server broadcasts descriptor in `new<ClassName>` for lazy managers.
  - Client updates `manager.manifest` and adds unhydrated stub on new object event.
- [x] **Step 4: Verify all tests pass**
  Run `npx jest tests/lazy_loading_e2e.test.ts`.
- [x] **Step 5: Full verification suite**
  Run `npx tsc --noEmit` and `npm run test_for_AI`.

---

### Task 5: Documentation & Final Verification

**Files:**
- Modify: `docs/LOADING_PROCESS.md`
- Modify: `docs/README.md`

- [x] **Step 1: Update `docs/LOADING_PROCESS.md`**
  Document Smart Lazy Loading, manifest descriptors, two-phase hydration, and self-contained snapshot entities.
- [x] **Step 2: Run full verification suite**
  Execute `npx tsc --noEmit` and `npm test`.
- [x] **Step 3: Final commit**
  Create final commit with `<Description> --GEMINI`.
