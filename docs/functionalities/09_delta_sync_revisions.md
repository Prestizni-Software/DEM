# F09: Delta Synchronization & Monotonic Revisions

## 1. Description
Tracks entity lifecycle mutations on the server using monotonic revision counters.
Transmits incremental mutation logs (`create`, `update`, `delete`) to reconnecting client managers.
Eliminates full state downloads for clients possessing valid previous revisions.

## 2. Core Components
- `ServerChangeTracker`: Records mutations, assigns sequence numbers, and manages retention logs.
- `ChangeEntry<T>`: Mutation record containing revision, mutation type, timestamp, and payload.
- `prune`: Enforces size limits, maximum entry counts, and time-to-live expiration policies.
- `ClientStateReconciler.applyDelta`: Applies received change sequences to client manager caches.

## 3. Operational Rules
- Increment monotonic revision sequence numbers upon every creation, property update, or deletion.
- Prune change history when total bytes, maximum age, or entry limits exceed configured thresholds.
- Return `status: "up-to-date"` when client revision equals current server revision counter.
- Return `status: "delta"` with change entries when client revision is within retained history.
- Fall back to full synchronization when client revision is older than lowest retained revision.

## 4. Key Interfaces
- `ServerDeltaSyncOptions`: Configuration options for retention TTL, memory limits, and prune policies.
- `DeltaSyncPayload<T>`: Wire contract containing sync status, revision, and mutation entries.
- `getChangesSince(clientRev, allowedIds)`: Retrieves historical mutation changes since given revision.

## 5. Edge Cases
- Client revision higher than server revision must trigger immediate full resynchronization.
- Pruning policy set to `both` requires both age and size limits to be exceeded.
- Applying delete mutations for non-existent local entities must complete idempotently without errors.
