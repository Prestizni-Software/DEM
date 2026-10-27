# F03: DEMArray Reactive Array Wrapper & Mutation Interception

## 1. Description
Wraps entity array properties in `DEMArray` JavaScript Proxy handlers.
Combines synchronous `ReadonlyArray` query operations with asynchronous mutation methods returning Promises.
Executes mutations pessimistically, awaiting server confirmation before updating local memory.
Synchronizes back-references and foreign key integrity across client and server stores.

## 2. Core Components
- `DEMArray<T>`: Reactive Proxy wrapper implementing synchronous queries and asynchronous mutation Promises.
- `DEM_RAW_ARRAY`: Unique symbol providing access to underlying scalar identifier arrays.
- `MUTATING_ARRAY_METHODS`: Trapped methods (`push`, `pop`, `shift`, `unshift`, `splice`, `set`, `reverse`, `sort`, `clear`).
- `createdWithParent`: Back-reference synchronization hook linking child objects to parents.
- `Cristian Clock Sync`: Handshake time synchronization measuring RTT and client clock offset.

## 3. Operational Rules
- Expose synchronous queries (`length`, `map`, `filter`, `find`, `includes`, `slice`) on committed local state.
- Intercept mutating array operations to execute asynchronously against server socket endpoints.
- Reject direct index assignments (`array[i] = val`) with `DEMError`, requiring `await array.set(i, val)`.
- Use element-anchored operations (`targetId`) to eliminate positional index-drift during concurrent writes.
- Synchronize child foreign keys when elements are inserted into or removed from parent relational arrays.
- Automatically purge deleted or tombstoned entity identifiers during database mutations.
- Transmit confirmed canonical array state in server direct acknowledgments and broadcast to peers.
- Support batch hydration of referenced entities in lazy mode via `await array.ensureLoaded({ depth })`.

## 4. Key Interfaces
- `DEMArray<T>`: Core reactive array type combining `ReadonlyArray<T>` with asynchronous mutations.
- `DEM_RAW_ARRAY`: Unique symbol token retrieving the unwrapped identifier array.
- `ensureLoaded(options?: { depth?: number }): Promise<this>`: Batch hydration for lazy relational arrays.
- `set(index: number, value: T): Promise<T>`: Asynchronous positional replacement method.

## 5. Edge Cases
- Positional splices during concurrent insertions resolve via element anchors rather than numeric offsets.
- In-flight mutations preserve committed local state for synchronous reads until server confirmation.
- Mutations on server objects bypass socket serialization and execute directly via MongoDB save locks.
- Network rejections or server validation errors preserve previous local array state and throw `DEMError`.
