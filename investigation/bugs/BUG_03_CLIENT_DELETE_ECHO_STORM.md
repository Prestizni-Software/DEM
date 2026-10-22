# BUG-03: Client deleteObject Echo Storm on Incoming Server Deletions

## Metadata
- **Severity**: High
- **Estimated Price**: $300 ($200 Base Bounty + $100 Solution Bonus)
- **Affected File**: [`AutoUpdateClientManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L453-L462), [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L1046-L1064), [`sync/ClientStateReconciler.ts`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L152-L162)
- **Replicating Test**: `BUG 3 [HIGH]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L190-L236)

---

## Exact Description

When the server broadcasts entity deletions or sends delta sync delete entries, the client calls [`AutoUpdateClientManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L484).
[`AutoUpdateClientManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L490) calls [`super.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L145).
[`AutoUpdateManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L152) invokes `o.destroy(true)`.
In [`AutoUpdatedClientObject.destroy`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L1051), the method executes:
```typescript
this.socket.emit(EVENT_DELETE + this.className, this.data._id, ...)
```
The client emits a deletion request back to the server for an already-deleted entity.
Every connected client that receives a server broadcast echoes `delete<ClassName>` back to the server.
In delta sync startup replay, clients flood the server with delete requests for historical deletions.

---

## Replicating Test Summary

The test feeds a delta sync deletion entry to `ClientStateReconciler.applyDelta`.
The test verifies whether the client socket emits `deleteTask` to the server.
On current code, `deleteTask` is emitted to the server.

---

## Solution

Add an optional parameter `isRemote: boolean = false` to [`deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts#L484) and [`destroy`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L1046). Skip socket emission when the operation originates from incoming server events:

In [`AutoUpdateClientManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateClientManagerClass.ts):
```typescript
  public override async deleteObject(
    _id: MongoId,
    isRemote: boolean = false,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    const _idStr = _id.toString();
    this.socket.off(EVENT_UPDATE + this.className + _idStr);
    this._cachedObjectsArray = null;

    const o = this.objects_[_idStr];
    let res: { success: boolean; message: string; code?: DEMErrorCode } | undefined;
    if (o && typeof o.destroy === "function") {
      res = await o.destroy(true, isRemote);
    }
    if (res?.success || !o || typeof o?.destroy !== "function") {
      delete this.objects_[_idStr];
      delete globalCache.objects[_idStr];
    }
    o?.callbacks?.delete?.(o);

    if (this.storageAdapter) {
      await ClientStateReconciler.persistToStorage(
        this as any,
        this.lastRevision,
        this.storageAdapter,
      );
    }
    return res ?? { success: true, message: "Already gone" };
  }
```

In [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts):
```typescript
  public async destroy(
    once = false,
    isRemote = false,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    if (!once)
      return await (this.parentManager as any).deleteObject(this.data._id.toString(), isRemote);
    if (isRemote) {
      await this.wipeSelf();
      return { success: true, message: "Cleaned locally" };
    }
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_DELETE + this.className,
        this.data._id,
        (res: ServerResponse<undefined>) => {
          resolve({
            success: res?.success ?? false,
            code: (res as any)?.code,
            message: res?.message ?? "",
          });
        },
      );
    });
  }
```

In [`sync/ClientStateReconciler.ts`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L155):
```typescript
await manager.deleteObject(id, true);
```
