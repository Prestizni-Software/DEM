# Uncertainties & Architectural Edge Cases Report

## Metadata
- **Classification**: Candidate Defect / Architectural Uncertainty
- **Estimated Review Bounty**: $10
- **Reference Project**: `E:\destop\_data\projects\ukolnicek-geodeta\mobile`

---

## 1. Multi-Tab Socket Duplication & SharedWorker Bridging

### Observation in Mobile Codebase
The mobile project implements [`demWorkerBridge.ts`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile/backend/demWorkerBridge.ts).
Web clients open multiple browser tabs.
Each tab connects independently to the DEM WebSocket server.
Each tab synchronizes full collections and receives identical broadcast events.
This increases server memory usage and network bandwidth linearly with tab count.

### Uncertainty
Should DEM provide native multi-tab transport arbitration, or is client-side WebWorker encapsulation the intended responsibility of the host application?

---

## 2. Authorization Teardown Lifecycle Hooks

### Observation in Mobile Codebase
In [`transmittor.ts`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile/backend/transmittor.ts#L76-L86), HTTP interceptors handle `401 Unauthorized` responses.
When authorization tokens expire, DEM managers do not receive a standardized `unauthorized` event from the server.
The mobile app manually calls `close()` across all manager instances and clears singletons.

### Resolution
Implemented in commit `18293f0`. Standardized `EVENT_DEAUTHENTICATE` ("deauthenticate") socket event emitted by `AutoUpdateServerManager.deauthenticate(targetSocket?, reason?)`. Client managers automatically teardown via `close()`, purge in-memory caches, and emit `EVENT_DEAUTHENTICATE` on `this.emitter`.

---

## 3. Reference Array Getter Referential Instability

### Observation in DEM Engine
In [`setupClassAccessors`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L1269-L1278), getters for reference arrays generate a new array on every access:
```typescript
const result: IAutoUpdatedClientObject<any>[] = [];
...
return result;
```
Every read `obj.items` produces a new array reference (`obj.items !== obj.items`).
In React Native hooks (`useMemo`, `useEffect`, `useSyncExternalStore`), unstable object references trigger re-render cycles.

### Uncertainty
Should DEM cache reference array instances until the underlying ID list mutates, or should consumers assume getter results are ephemeral?

---

## 4. Property Removal via setValue(key, undefined)

### Observation in DEM Engine
In [`setValueInternal`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L377), the server updates MongoDB with `$set: { [key]: value }`.
When a client sets a property to `undefined`, MongoDB driver behavior depends on configuration.
Setting a property to `undefined` does not emit an `$unset` operator.

### Resolution
Implemented in commit `5c8c642`. `setValue(key, undefined)` translates to MongoDB `$unset: { [key]: "" }` with support for dotted paths. The property is deleted in memory via `_.unset(this.data, key)` and `_.unset(this.entry, key)`.
