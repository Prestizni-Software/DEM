# Collection-Level Socket Event Multiplexing

## 1. Problem Statement & Motivation

In previous versions of DEM, every client entity instance registered an individual Socket.IO listener upon hydration:
```typescript
socket.on(`update${className}${id}`, async (update, ack) => { ... });
```

In applications with large datasets (e.g. 8,500 entities across 13 collections), this architecture caused severe bottlenecks:
1. **Socket Listener Proliferation**: 8,500 active listeners attached to a single `socket` connection, triggering `MaxListenersExceededWarning`.
2. **Memory Overhead**: Thousands of listener closures retained in memory.
3. **$O(N)$ Removal Cost on Teardown**: Calling `socket.off()` during entity eviction or full re-sync iterated through thousands of listeners in EventEmitter arrays, producing $O(N^2)$ teardown pauses.

---

## 2. Architecture & Solution

### A. Dual Emission on Server (`AutoUpdatedServerObjectClass.ts`)
When modifying an entity property (`setValueInternal`) or mutating an array (`mutateArray`), the server emits:
1. Per-instance event (`update${className}${id}`) for backward compatibility with older clients.
2. Collection-level event (`update${className}`) with payload containing `{ _id, key, value, ... }`.

### B. Multiplexed Dispatcher on Client Manager (`AutoUpdateClientManagerClass.ts`)
When `multiplexUpdateEvents: true` is configured in `DEMClientOptions`:
1. The `AutoUpdateClientManager` registers a single listener for `update${className}`.
2. Incoming updates are routed in $O(1)$ to `this.objects_[id].handleUpdateRequest(update)`.
3. Individual client objects detect `parentManager.hasCollectionUpdateListener === true` and skip registering per-instance socket listeners.
4. Entity eviction and re-sync skip per-instance `socket.off()`, eliminating the $O(N)$ teardown cost.

### C. Backward Compatibility & Standalone Objects
- If `multiplexUpdateEvents` is not enabled, or if an entity is created standalone without a collection manager, it falls back to per-instance socket listeners.
- Both legacy and multiplexed clients can communicate with the server concurrently.

---

## 3. Usage & Configuration

Enable multiplexing globally or per manager via `clientOptions`:

```typescript
import { AUCManagerFactory } from "@prestizni-software/client-dem";

const managers = await AUCManagerFactory(
  definitions,
  loggers,
  socket,
  false,
  emitter,
  callbacks,
  versionOptions,
  deltaSyncOptions,
  lazyLoadingOptions,
  {
    multiplexUpdateEvents: true,
  },
);
```

---

## 4. Verification

Verified via `tests/collection_socket_multiplexing.test.ts`:
- Confirms 0 per-entity socket listeners are registered when multiplexing is enabled.
- Confirms 1 collection-level listener routes mutations to target entities in $O(1)$.
- Confirms standalone entities without collection listener fall back to per-instance listeners.
- Confirms server emits both per-instance and collection-level events.
