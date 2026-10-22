# BUG-01: Server deleteObject DB Deletion Bypass on Unhydrated Entities

## Metadata
- **Severity**: Critical
- **Estimated Price**: $600 ($400 Base Bounty + $200 Solution Bonus)
- **Affected File**: [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1265-L1279), [`AutoUpdateManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L145-L160)
- **Replicating Test**: `BUG 1 [CRITICAL]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L115-L142)

---

## Exact Description

In Smart Lazy Loading or startup filter configurations, entities remain in MongoDB without in-memory hydration.
Calling [`AutoUpdateServerManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1265) invokes [`super.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L145).
When an entity is not in `this.objects_`, `o` is undefined.
[`AutoUpdateManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L159) returns `{ success: true, message: "Already gone" }`.
The server never calls `this.model.deleteOne` or `this.model.findByIdAndDelete`.
The unhydrated document remains permanently in MongoDB.
Furthermore, line 1271 records a `"delete"` mutation in `this.changeTracker` before database execution.
If database deletion fails, clients receive invalid delta sync instructions.

---

## Replicating Test Summary

The test sets up an `AutoUpdateServerManager` with a mock model.
An entity ID exists in the database but is absent from `manager.objects_`.
Calling `await manager.deleteObject(entityId)` asserts that `mockModel.deleteOne` executes.
On current code, `mockModel.deleteOne` is never called.

---

## Solution

Update [`AutoUpdateServerManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1265) to delete unhydrated documents from MongoDB. Only record change tracking if database deletion succeeds.

```typescript
  public override async deleteObject(
    _id: MongoId,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    this._cachedObjectsArray = null;
    this.startupPayloadCache = null;
    const idStr = _id.toString();

    let res: { success: boolean; message: string; code?: DEMErrorCode };
    const inMemoryObj = this.objects_[idStr];

    if (inMemoryObj && typeof inMemoryObj.destroy === "function") {
      res = await super.deleteObject(_id);
    } else {
      // Unhydrated or lazy object: delete directly from database
      try {
        const doc = await this.model.findById(idStr);
        if (doc) {
          if (this.options?.onDeletion) {
            await this.options.onDeletion(doc as any);
          }
          await doc.deleteOne();
        } else if (typeof this.model.deleteOne === "function") {
          await this.model.deleteOne({ _id: idStr });
        }
        delete this.objects_[idStr];
        delete globalCache.objects[idStr];
        res = { success: true, message: "Deleted" };
      } catch (error: any) {
        this.loggers.error?.(
          `Error deleting unhydrated object ${this.className} ${_id.toString()}: ${error.message}`,
        );
        return {
          success: false,
          code: DEMErrorCode.OBJECT_DELETE_FAILED,
          message: error.message,
        };
      }
    }

    if (res.success) {
      if (this.changeTracker) {
        this.changeTracker.recordChange("delete", idStr);
      }
      for (const socket of this.clientSockets) {
        const known = this.knownObjectIdsBySocket.get(socket);
        if (known) {
          known.delete(idStr);
        }
      }
    }

    return res;
  }
```
