# BUG-05: Client loadFromServer Leaks Socket Listeners on Reconnection

## Metadata
- **Severity**: High
- **Estimated Price**: $300 ($200 Base Bounty + $100 Solution Bonus)
- **Affected File**: [`AutoUpdateClientManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L636-L640), [`AutoUpdateClientManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L719-L721), [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L509-L522)
- **Replicating Test**: `BUG 5 [HIGH]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L278-L323)

---

## Exact Description

On mobile network reconnects or screen refresh cycles, [`AutoUpdateClientManager.loadFromServer`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L507) reloads startup data.
Before populating new objects, lines 719-721 clear in-memory maps:
```typescript
for (const oldId of Object.keys(this.objects_)) {
  delete globalCache.objects[oldId];
}
this.objects_ = {};
```
The manager never detaches `this.socket.on("update" + className + oldId)`.
The old object instances remain retained in memory by the socket event listener map.
When new objects are instantiated for the same IDs, they attach new listeners.
Socket listeners stack linearly upon every reconnection.
When an update packet arrives, all zombie instances and new instances execute `handleUpdateRequest`.
Stale detached objects invoke `callbacks.update`.

---

## Replicating Test Summary

The test executes `await manager.loadFromServer()` twice.
The test counts registered listeners for `updateDocumentdoc-1`.
On current code, two listeners exist after two calls.

---

## Solution

Remove existing object update listeners before replacing `this.objects_` in [`AutoUpdateClientManager.loadFromServer`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L719) and [`ClientStateReconciler.restoreFromStorage`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L42):

```typescript
    // Clear old objects and remove their socket listeners before populating new ones
    for (const oldId of Object.keys(this.objects_)) {
      this.socket.off(EVENT_UPDATE + this.className + oldId);
      const oldObj = this.objects_[oldId];
      if (oldObj && typeof oldObj.destroyImmediate === "function") {
        oldObj.destroyImmediate();
      }
      delete globalCache.objects[oldId];
    }
    this.objects_ = {};
    this._cachedObjectsArray = null;
```
