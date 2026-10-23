# DEM Loading Process

The loading process in DEM (Data Exchange Manager) is a multi-phase operation designed to initialize objects and resolve their relationships (references) across different managers.

## Initialization Phases

1.  **Pre-Load (`preLoad` / `loadFromServer`)**:
    - Fetches all documents from the database (Server) or IDs from the server (Client).
    - Instantiates objects and adds them to the `globalCache`.
    - **Client Manager**: Also calls `isPreLoadedAsync()` and `loadMissingReferences()` in this phase.
    - **Server Manager**: Focuses exclusively on instantiation to ensure all objects exist before any reference resolution begins.
    - **Optimization**: All objects within a manager are pre-loaded in parallel using `Promise.all`.
    - **Optimization**: All managers are pre-loaded in parallel in the factories (`AUSManagerFactory` / `AUCManagerFactory`).

2.  **Load References (`loadReferences`)**:
    - Called after all managers have completed `preLoad`.
    - **Initial Reference Resolution**: In the Server Manager, this phase first triggers `isPreLoadedAsync()` on each object to perform initial reference resolution (`loadForceReferences`). This ensures that all objects across all managers already exist in `globalCache` before their relationships are established.
    - **Missing Reference Resolution**: Iterates through all objects and calls `loadMissingReferences()` to find any "parent" references (pointers) that might be missing from the data.
    - This phase ensures that cross-manager references are correctly resolved because all managers have their objects instantiated and available in memory.
    - **Optimization**: All objects within a manager have their references loaded in parallel using `Promise.all`.
    - **Optimization**: All managers have their references loaded in parallel in `AUSManagerFactory`.

## Key Synchronization Mechanisms

- **`createdWithParent`**:
    - Triggered when an object is loaded and has a parent reference (tagged with `@populatedRef`).
    - Automatically updates the parent object's array/field to include this object's ID if missing.
    - Ensures back-references are kept in sync in memory.

- **`findMissingObjectReference`**:
    - Used to find a "parent" reference if it's missing from the object's data but present in the parent's collection.
    - **Optimization**: This is only triggered if the reference property is empty, avoiding expensive O(N^2) searches during initialization for already-linked objects.

- **`contactChildren`**:
    - Recursively triggers reference loading on child objects when a parent reference is updated.

## Performance & Complexity Fixes

- **Recursion Elimination**:
    - `loadForceReferences` previously called `handleLoad`, which recursively triggered `loadForceReferences` on referenced objects. In a fully connected graph, this led to O(N * (N+E)) complexity as every object would trigger a recursive walk of the entire graph.
    - **Solution**: Removed cross-object recursion in `loadForceReferences`. Since every object is eventually visited by the manager's `preLoad` loop, the recursion was redundant. `loadForceReferences` now only processes the object itself and its nested plain-object data.

- **Parallelization**:
    - Adapted the Server Manager initialization to use `Promise.all` at all levels (manager creation, manager pre-load, manager reference load, and object-level initialization), matching the efficiency of the Client Manager.

- **Metadata Caching**:
    - The constructor of `AutoUpdatedClientObject` now caches the property list for each class. This avoids redundant prototype walks and metadata lookups when instantiating large numbers of objects of the same type.

- **Reference Loading Optimization**:
    - `findAndLoadReferences` (triggered by `setValue__`) now only calls `loadMissingReferences()` on target objects if their respective managers are already fully loaded. During the initial loading phase, this prevents a massive O(N^3) redundant work chain as back-references are being synchronized, relying instead on the manager's own loading loop to eventually ensure consistency.

- **Logging Overhead**:
    - Removed excessive debug logging from the inner loops of `loadForceReferences` to reduce CPU and memory pressure during large-scale loading.

- **Memory Pressure**:
    - Avoid logging large arrays (like ID lists) as it can lead to heap exhaustion in large datasets.
    - DB Saves: On the server, `setValue__` triggers a DB save unless the `silent` flag is set. The `createdWithParent` mechanism uses `silent: true` to avoid massive amounts of concurrent writes during back-reference synchronization.

---

## Smart Lazy Loading & Self-Contained Entities

Smart Lazy Loading optimizes startup duration and memory consumption for large datasets and archives.

### 1. Startup Manifest Phase
- When `lazyLoading: true` is configured, `loadFromServer()` receives `{ status: "lazy", ids, manifest }`.
- The `manifest` contains `{ _id, description }` items generated by `static getDescriptor(data)`.
- Client manager populates `manager.manifest` and instantiates unhydrated stubs (`isLazyStub = true`).
- Full entity payloads and cross-manager references remain unloaded during startup.

### 2. On-Demand Graph Hydration
- The application invokes `await manager.loadObject(id, { depth: 2 })` or `await obj.ensureLoaded({ depth: 2 })`.
- The server traverses references up to the requested depth in a single network round-trip.
- The server tracks visited identifiers to prevent infinite circular loops.
- The server returns root data and a map of related entities grouped by manager name.
- Client managers hydrate the root and related entities into their respective memory caches.
- Synchronous getters operate immediately after hydration finishes.

### 3. Real-Time Manifest Synchronization
- When an entity is created in a lazy server manager, the server emits `new<ClassName>` with descriptor data.
- The client manager adds the descriptor to `manifest` and registers an unhydrated stub.

### 4. Self-Contained Entities (Snapshots)
- Classes declared with `@classProp` and omitting `@populatedRef` disable reference resolution.
- Getters return raw scalar values or embedded objects without external manager queries.


### 5. Local Storage Snapshots with Lazy Loading
- Persistent storage adapters save lazy manifests and entity stubs with `__isLazyStub` flags.
- `ClientStateReconciler.restoreFromStorage` restores manifests and stubs without falsely marking stubs as loaded.
- Calling `ensureLoaded()` on a restored lazy stub triggers server hydration on demand.
- Calling `ensureLoaded()` on a restored hydrated entity returns immediately without network round-trips.
- Server startup in lazy mode reconciles against stored entities and preserves locally hydrated data.
- Server deletions remove matching entities from local caches and manifests.
- On-demand `loadObject` calls and real-time broadcasts automatically update persistent storage adapters.
