# DEM Loading Process

The loading process in DEM (Data Exchange Manager) is a multi-phase operation designed to initialize objects and resolve their relationships (references) across different managers.

## Initialization Phases

1.  **Pre-Load (`preLoad`)**:
    - Fetches all documents from the database for a given manager.
    - Instantiates `AutoUpdatedServerObject` (or client equivalent) for each document.
    - Adds objects to the `globalCache`.
    - Calls `isPreLoadedAsync()` on each object to trigger initial reference resolution (`loadForceReferences`).
    - **Optimization**: All objects within a manager are pre-loaded in parallel using `Promise.all`.
    - **Optimization**: All managers are pre-loaded in parallel in `AUSManagerFactory`.

2.  **Load References (`loadReferences`)**:
    - Called after all managers have completed `preLoad`.
    - Iterates through all objects and calls `loadMissingReferences()`.
    - This phase ensures that cross-manager references can be resolved because all managers have their objects instantiated.
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

- **Logging Overhead**:
    - Removed excessive debug logging from the inner loops of `loadForceReferences` to reduce CPU and memory pressure during large-scale loading.

- **Memory Pressure**:
    - Avoid logging large arrays (like ID lists) as it can lead to heap exhaustion in large datasets.
    - DB Saves: On the server, `setValue__` triggers a DB save. Be cautious when syncing back-references during initialization to avoid massive amounts of concurrent writes.

