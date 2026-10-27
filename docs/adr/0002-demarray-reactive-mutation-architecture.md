# DEMArray Reactive Mutation Architecture

We implement `DEMArray<T>` to wrap entity array properties on both client and server. `DEMArray` combines synchronous read queries (`ReadonlyArray<T>`) with asynchronous mutation methods returning Promises (`push`, `pop`, `shift`, `unshift`, `splice`, `set`, `reverse`, `sort`, `clear`). Array mutations execute pessimistically, waiting for server confirmation before modifying local memory. The protocol uses Cristian's algorithm for clock synchronization, element-anchored operations to prevent index-drift, and two-way acknowledgments with update broadcasts to guarantee convergence.

## Status

Accepted

## Context

DEM previously wrapped relational arrays in `createReadOnlyArrayProxy`, which threw a `DEMError` (`CANNOT_SET_REF_DIRECTLY`) on any mutating method call (such as `push`, `pop`, `splice`). Developers were forced to use manual `setValue()` calls with serialized arrays or external manager APIs. Primitive arrays lacked mutation interception entirely, allowing direct in-memory mutation without server synchronization.

Furthermore, concurrent array operations on distributed clients faced index-drift: if two clients modified an array simultaneously, raw numeric index offsets shifted, causing concurrent splices or positional sets to corrupt target elements.

## Considered Options

1. **Synchronous Optimistic Mutations with Background Sync**: Allow standard synchronous `array.push(...)` modifying local memory immediately and syncing in the background. Rejected because server validation failure or network drops leave local client state desynchronized from the database.
2. **Dedicated Async Methods on Native Array Subclasses (`pushAsync`)**: Subclass JavaScript `Array` and add custom async methods. Rejected because TypeScript method signature inheritance conflicts with Promise returns for standard method names (`push`), and native arrays allow silent synchronous mutations.
3. **Pessimistic Proxy-Wrapped DEMArray with Element Anchoring**: Intercept array property access with a Proxy implementing `ReadonlyArray<T>` synchronously while overriding mutating methods to return Promises. Prevent index-drift via element-anchored operations (`targetId`) and validate state using `rawIdsHash`. Accepted.

## Consequences

- All entity array properties (`@classProp` primitive arrays and `@populatedRef` relational arrays) expose `DEMArray<T>`.
- Mutating operations (`await array.push(...)`, `await array.splice(...)`) return Promises that resolve only after server confirmation.
- Direct index assignments (`array[i] = val`) throw a `DEMError`, requiring `await array.set(i, val)` or `await array.splice(...)`.
- The handshake protocol implements Cristian's algorithm to synchronize client and server clocks without external dependencies.
- Relational positional mutations transmit element identifiers (`targetId`) alongside numeric offsets, allowing the server to resolve the target element if concurrent mutations shift array indices.
- The server acknowledgment returns the confirmed canonical array state to the caller and emits an `EVENT_UPDATE` broadcast to peer clients, ensuring complete convergence.
- Tombstoned and deleted entity identifiers are automatically purged from database arrays during mutations.
- In lazy loading mode, `DEMArray` exposes `await array.ensureLoaded({ depth })` to batch-hydrate referenced entities in a single round-trip.
- On the server, `DEMArray` executes mutations directly against MongoDB and in-memory entries through `saveLock`.
