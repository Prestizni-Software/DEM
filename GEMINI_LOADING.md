# DEM Loading Process

The loading process in DEM (Data Exchange Manager) is a multi-phase operation designed to initialize objects and resolve their relationships (references) across different managers.

## Initialization Phases

1.  **Pre-Load (`preLoad`)**:
    - Fetches all documents from the database for a given manager.
    - Instantiates `AutoUpdatedServerObject` (or client equivalent) for each document.
    - Adds objects to the `globalCache`.
    - Calls `isPreLoadedAsync()` on each object to trigger initial reference resolution (`loadForceReferences`).

2.  **Load References (`loadReferences`)**:
    - Called after all managers have completed `preLoad`.
    - Iterates through all objects and calls `loadMissingReferences()`.
    - This phase ensures that cross-manager references can be resolved because all managers have their objects instantiated.

## Key Synchronization Mechanisms

- **`createdWithParent`**:
    - Triggered when an object is loaded and has a parent reference (tagged with `@populatedRef`).
    - Automatically updates the parent object's array/field to include this object's ID if missing.
    - Ensures back-references are kept in sync in memory.

- **`findMissingObjectReference`**:
    - Used to find a "parent" reference if it's missing from the object's data but present in the parent's collection.
    - **Optimization**: This is now only triggered if the reference property is empty, avoiding expensive O(N^2) searches during initialization for already-linked objects.

- **`contactChildren`**:
    - Recursively triggers reference loading on child objects when a parent reference is updated.

## Performance Considerations

- **O(N^2) Bottlenecks**: Avoid iterating over `objectsAsArray` of other managers inside loops that run for every object.
- **Redundant Recursion**: Initialization must be carefully sequenced to avoid calling `loadMissingReferences` or `contactChildren` multiple times for the same object tree.
- **Memory Pressure**: Avoid logging large arrays (like ID lists) as it can lead to heap exhaustion in large datasets.
- **DB Saves**: On the server, `setValue__` triggers a DB save. Be cautious when syncing back-references during initialization to avoid massive amounts of concurrent writes.
