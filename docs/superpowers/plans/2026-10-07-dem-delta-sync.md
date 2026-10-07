# DEM Delta Synchronization & Change Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a modular, opt-in change-tracking and delta-synchronization system for DEM (Data Exchange Manager) enabling clients to persist local state, fast-reconnect with delta patches, and avoid redundant full-database transfers and object instantiations.

**Architecture:** A cleanly decoupled, opt-in subsystem consisting of:
1. `ChangeTracker` on the server: records mutations (`create`, `update`, `delete`) per manager with monotonic revisions, memory-size tracking in MB, and time-based TTL pruning (either/both configurable).
2. Pluggable Client Storage Adapters (`IClientStorageAdapter`, `MemoryStorageAdapter`, `LocalStorageAdapter`, `IndexedDbStorageAdapter`).
3. `DeltaSyncManager` hooks integrated into `AutoUpdateServerManagerClass` and `AutoUpdateClientManagerClass` through optional configuration flags (`deltaSyncOptions`), falling back gracefully to full sync whenever delta sync is disabled, invalid, or outdated.

**Tech Stack:** TypeScript, Socket.IO, Jest, Node.js (in-memory & IndexedDB mock for testing).

**Spec:** Modular Addon design with zero breaking changes for existing DEM consumers.

---

## Global Constraints
- Strictly opt-in: Existing DEM behavior remains 100% untouched when `deltaSync` options are omitted or set to false.
- Type Safety: Strict TypeScript types with zero unnecessary `as any`.
- Zero Regression: All existing tests in `npm run test_for_AI` and `npx tsc` must continue passing.
- TDD: Every module and behavior must have dedicated unit and integration tests.

---

## Review Focus
1. **Compacted/Purged Revisions**: When a client connects with a revision older than the server's purged change buffer, the server must automatically respond with a clean fallback to `FullSync`.
2. **Back-to-Back Multiple Mutations on the Same Object**: If an object is created and then updated 3 times before sync, the delta response should either emit the sequential events or coalesce them correctly into the latest object state.
3. **Deletion (Tombstones)**: Deleted objects must be tracked as deletions in the change log and properly removed from client cache and local persistent storage.
4. **Storage Adapter Error Resilience**: If IndexedDB / LocalStorage fails (e.g. quota exceeded or private mode), the client must log a warning and safely fall back to in-memory operation without crashing DEM.
5. **Dynamic Permissions & Startup Middleware**: If `startupMiddleware` is used, the server must filter delta changes so clients only receive deltas for objects they are permitted to see.

---

## Subsystem Architecture & File Structure

```
src/
├── sync/
│   ├── types.ts                     # Interfaces for ChangeLog, DeltaPayload, StorageAdapters, PruningConfig
│   ├── ServerChangeTracker.ts       # Server mutation history, monotonic revisions, size & TTL pruning
│   ├── ClientStateReconciler.ts     # Client delta application, conflict-free state patching & cache updates
│   └── storage/
│       ├── IClientStorageAdapter.ts # Interface for client persistent stores
│       ├── MemoryStorageAdapter.ts  # Fallback in-memory storage
│       ├── LocalStorageAdapter.ts   # Browser localStorage / Node mock store
│       └── IndexedDbStorageAdapter.ts # Browser IndexedDB store
├── tests/
│   ├── sync_change_tracker.test.ts  # Unit tests for ServerChangeTracker & pruning (size MB + TTL)
│   ├── sync_storage_adapters.test.ts# Unit tests for storage adapters
│   ├── sync_reconciler.test.ts      # Unit tests for ClientStateReconciler
│   └── sync_delta_integration.test.ts # End-to-end integration tests for delta sync via Socket.IO
```

---

## Tasks

### Task 1: Core Types & Interfaces for Delta Sync

**Files:**
- Create: `src/sync/types.ts`
- Create: `src/sync/storage/IClientStorageAdapter.ts`
- Test: `tests/sync_storage_adapters.test.ts`

**Interfaces:**
- Produces: `ChangeType`, `ChangeEntry<T>`, `ChangeLogOptions`, `DeltaSyncPayload<T>`, `StartupSyncRequest`, `StartupSyncResponse<T>`, `IClientStorageAdapter`, `StoredManagerState`.

- [ ] **Step 1: Write types and storage adapter interface**
  - Define `ChangeEntry` with `revision`, `type` (`'create' | 'update' | 'delete'`), `id`, `data`, `timestamp`, `estimatedBytes`.
  - Define `ChangeLogOptions` supporting:
    - `maxAgeMs?: number` (TTL, e.g. 7 days)
    - `maxSizeBytes?: number` (e.g. 10 * 1024 * 1024 for 10 MB)
    - `maxEntries?: number`
    - `pruneMode?: 'either' | 'both'` (prune if exceeds either condition or must violate both).
  - Define `IClientStorageAdapter` (`saveManagerState`, `loadManagerState`, `clearManagerState`).

- [ ] **Step 2: Run compilation check**
  - Run `npx tsc` to verify no type syntax errors.

---

### Task 2: Server Change Tracker & Configurable Pruning Engine

**Files:**
- Create: `src/sync/ServerChangeTracker.ts`
- Test: `tests/sync_change_tracker.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `ServerChangeTracker` class with:
  - `recordChange(type, id, data)`
  - `getChangesSince(clientRevision, allowedIds?)`
  - `getCurrentRevision()`
  - `getEstimatedSizeBytes()`
  - `prune()`

- [ ] **Step 1: Write unit tests for ServerChangeTracker**
  - Test recording `create`, `update`, `delete` increments revision.
  - Test `getChangesSince(rev)` returns only changes after `rev`.
  - Test size estimation and pruning when total size exceeds `maxSizeBytes` (e.g. 10 MB limit).
  - Test TTL expiration pruning when `timestamp < now - maxAgeMs`.
  - Test `pruneMode: 'either'` vs `pruneMode: 'both'`.
  - Test fallback indicator (`isExpired: true`) if client requests a revision that has been pruned.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx jest tests/sync_change_tracker.test.ts` -> Expected: FAIL (module not found).

- [ ] **Step 3: Implement ServerChangeTracker**
  - Implement byte calculation helper (fast JSON byte estimation).
  - Implement ring buffer / array of `ChangeEntry`.
  - Implement `prune()` logic evaluating `maxAgeMs`, `maxSizeBytes`, and `pruneMode`.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx jest tests/sync_change_tracker.test.ts` -> Expected: PASS.

---

### Task 3: Client Storage Adapters (Memory, LocalStorage, IndexedDB)

**Files:**
- Create: `src/sync/storage/MemoryStorageAdapter.ts`
- Create: `src/sync/storage/LocalStorageAdapter.ts`
- Create: `src/sync/storage/IndexedDbStorageAdapter.ts`
- Test: `tests/sync_storage_adapters.test.ts`

**Interfaces:**
- Consumes: `IClientStorageAdapter`, `StoredManagerState`
- Produces: Implementations of `MemoryStorageAdapter`, `LocalStorageAdapter`, `IndexedDbStorageAdapter`.

- [ ] **Step 1: Write unit tests for Storage Adapters**
  - Test saving manager state (`revision`, `ids`, `objects`).
  - Test loading manager state returns previously saved state.
  - Test handling missing / corrupted storage data gracefully without throwing unhandled exceptions.
  - Test clearing storage.

- [ ] **Step 2: Implement Storage Adapters**
  - `MemoryStorageAdapter`: simple Map-based backing.
  - `LocalStorageAdapter`: JSON-serialized localStorage wrapper with try/catch quota guard.
  - `IndexedDbStorageAdapter`: Promise-based IndexedDB wrapper with version upgrade handling.

- [ ] **Step 3: Run test to verify it passes**
  - Run: `npx jest tests/sync_storage_adapters.test.ts` -> Expected: PASS.

---

### Task 4: Client State Reconciler

**Files:**
- Create: `src/sync/ClientStateReconciler.ts`
- Test: `tests/sync_reconciler.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `IAutoUpdatedClientObjectBase`, `AutoUpdateClientManager`
- Produces: `ClientStateReconciler` with:
  - `applyDelta(manager, deltaPayload)`
  - `restoreFromStorage(manager, storageAdapter)`
  - `persistToStorage(manager, storageAdapter)`

- [ ] **Step 1: Write unit tests for ClientStateReconciler**
  - Test restoring manager objects from stored state without network requests.
  - Test applying delta with `create` (instantiates new object & registers in global cache).
  - Test applying delta with `update` (updates object properties and emits callbacks).
  - Test applying delta with `delete` (calls deleteObject & deregisters from cache).
  - Test updating manager's current `lastRevision` and saving back to storage.

- [ ] **Step 2: Implement ClientStateReconciler**
  - Implement `restoreFromStorage`, `persistToStorage`, and `applyDelta`.

- [ ] **Step 3: Run test to verify it passes**
  - Run: `npx jest tests/sync_reconciler.test.ts` -> Expected: PASS.

---

### Task 5: Integration with AutoUpdateServerManager & AutoUpdateClientManager

**Files:**
- Modify: `src/AutoUpdateServerManagerClass.ts`
- Modify: `src/AutoUpdateClientManagerClass.ts`
- Modify: `src/CommonTypes.ts`
- Test: `tests/sync_delta_integration.test.ts`

**Interfaces:**
- Produces:
  - Server option: `deltaSync?: boolean | ChangeLogOptions`
  - Client option: `deltaSync?: boolean | { storage: IClientStorageAdapter }`
  - Upgraded socket handshake for `EVENT_STARTUP`: accepts `{ lastRevision?: number }` and responds with `{ status: 'up-to-date' | 'delta' | 'full', ... }`.

- [ ] **Step 1: Write comprehensive integration tests in `tests/sync_delta_integration.test.ts`**
  - Case 1: Initial full sync saves state and revision to client storage.
  - Case 2: Reconnection with NO changes -> server returns `status: "up-to-date"`, 0 objects re-created, 0 payload transferred.
  - Case 3: Reconnection with DELTA changes -> server returns only created/updated/deleted items, client reconciles in place without full reload.
  - Case 4: Reconnection with EXPIRED revision -> server returns `status: "full"`, client cleanly flushes and updates state.
  - Case 5: When `deltaSync` is disabled (default), standard legacy DEM startup works identically without regression.

- [ ] **Step 2: Modify Server & Client Managers**
  - In `AutoUpdateServerManagerClass`:
    - Instantiate `ServerChangeTracker` if `deltaSync` option is enabled.
    - Record mutations in `createObject`, `deleteObject`, and `setValue__` / `onUpdate`.
    - In `EVENT_STARTUP`, check client's `lastRevision`. If valid and unexpired, return delta payload.
  - In `AutoUpdateClientManagerClass`:
    - Before emitting `EVENT_STARTUP`, load local state from `storageAdapter` if configured.
    - Send stored `lastRevision` to server.
    - On `up-to-date`: skip object recreation, just refresh listeners and resolve.
    - On `delta`: apply delta via `ClientStateReconciler`.
    - On `full`: perform existing full load and update local storage.

- [ ] **Step 3: Run integration tests**
  - Run: `npx jest tests/sync_delta_integration.test.ts` -> Expected: PASS.

---

### Task 6: Full Verification & Documentation

**Files:**
- Create: `GEMINI_DELTA_SYNC.md`
- Modify: `GEMINI.md` (add entry in Knowledge Index)

- [ ] **Step 1: Run TypeScript compiler check**
  - Run: `npx tsc` -> Expected: 0 errors.

- [ ] **Step 2: Run full regression test suite**
  - Run: `npm run test_for_AI` -> Expected: All tests PASS.

- [ ] **Step 3: Document architecture in `GEMINI_DELTA_SYNC.md` and link in `GEMINI.md`**
  - Explain the configuration options (`maxAgeMs`, `maxSizeBytes`, `pruneMode`, storage adapters).
  - Document the startup handshake protocol and fallback mechanics.

- [ ] **Step 4: Final commit with `--GEMINI` suffix**
