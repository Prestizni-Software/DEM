# Client-Side Reference Population Removal & Server-Side Pre-population

This document describes the architectural changes implemented in July 2026 to optimize the initialization sequence and eliminate redundant network/processing steps when client applications load data.

## Previous Architecture (Pre-July 2026)

1.  **Server Loading**:
    *   The server-side manager loaded raw documents from MongoDB, instantiated server-side objects, and populated references locally in memory (e.g., using `createdWithParent`).
2.  **Client Startup & Individual Get Calls**:
    *   The server sent only the list of IDs (`data.ids`) to the client manager.
    *   The client manager instantiated empty objects for each ID.
    *   Since the client objects were initialized with string IDs only, they emitted individual socket `EVENT_GET` calls to fetch each object's data from the server.
3.  **Client-Side Reference Resolution / Population**:
    *   Upon receiving the raw object data, each client object ran the heavy population logic (`loadForceReferences` / `createdWithParent` / `loadMissingReferences`) to re-compute relations, matching the parent-child linkages in-memory.

## New Architecture & Systems Used

To avoid the overhead of individual GET requests and redundant client-side reference computation, the library now ships fully pre-populated documents from the server and configures references client-side in a single sweep once loading completes.

### 1. Server-Side Data Pre-population (`extractedData` Updates)
*   **Location**: `AutoUpdatedServerObjectClass.ts` -> `extractedData` getter.
*   **Change**: Instead of checking `this.entry ? this.entry.toObject() : this.data`, the server now always uses `this.data` as the source for `extractedData`.
*   **Rationale**: `this.data` contains all in-memory changes and back-references populated during the server's initialization phases (which are not saved in the raw MongoDB documents).

### 2. Startup Data Payload Expansion
*   **Location**: `AutoUpdateServerManagerClass.ts` -> `EVENT_STARTUP` socket handler.
*   **Change**: Expanded the startup response payload. Along with `ids` and `properties`, the server now also returns `objects` (representing the pre-populated `extractedData` array of all permitted objects).
*   **Rationale**: This allows the client to obtain all data in a single network round-trip during startup.

### 3. Client-Side Pre-population in Manager
*   **Location**: `AutoUpdateClientManagerClass.ts` -> `loadFromServer` method.
*   **Change**: During startup, the client manager maps the pre-populated `objects` array. When constructing client object instances, it passes the pre-populated object data structure instead of just the ID string if available.
*   **Rationale**: The client object constructor detects the object payload, sets `this.data` directly, and sets `isLoading = false` immediately, bypassing the individual `EVENT_GET` socket queries entirely.

### 4. Removal of Client-Side Population Logic
*   **Location**: `AutoUpdatedClientObjectClass.ts`.
*   **Change**:
    *   `loadReferencesAsync`: Restricts the execution of `loadForceReferences` and parent field updates (`toChangeOnParents`) to server-side objects only (`this.isServer === true`).
    *   `loadMissingReferences`: Added an early return `if (!this.isServer)` to make it a no-op on the client.
    *   `contactChildren`: Added an early return `if (!this.isServer)` to prevent child recursion updates on the client.
    *   `setValue__`: Restricts `findAndLoadReferences` and `contactChildren` updates to server-side objects only.
*   **Rationale**: The server has already fully populated these reference IDs and shipped them to the client; calculating them again on the client is redundant and computationally expensive.

### 5. Client-Side Getters & Setters Sweep
*   **Location**: `AutoUpdateClientManagerClass.ts` -> `AUCManagerFactory` function.
*   **Change**: After all client managers have finished loading their objects from the startup payload, we execute a sweep to trigger `generateSettersAndGetters()` on all objects.
*   **Rationale**: This ensures that all dynamic getters/setters are properly defined and can successfully resolve their references dynamically using the fully populated cache, preventing timing or ordering issues during instantiation.
