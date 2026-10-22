# BUG-04: callbacks.delete Receives Manager Instance Instead of Entity

## Metadata
- **Severity**: High
- **Estimated Price**: $300 ($200 Base Bounty + $100 Solution Bonus)
- **Affected File**: [`AutoUpdateManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L158), [`sync/ClientStateReconciler.ts`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L161)
- **Replicating Test**: `BUG 4 [HIGH]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L238-L276)

---

## Exact Description

[`CommonTypes.ts`](file:///E:/destop/_data/projects/DEM/src/CommonTypes.ts#L42) specifies callback signatures:
```typescript
delete: (item: T) => void
```
The callback expects the deleted entity instance.
In [`AutoUpdateManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts#L158), the code executes:
```typescript
o?.callbacks?.delete?.(this);
```
`this` is the `AutoUpdateManager` instance.
`o` is the deleted entity instance.
The callback receives the manager rather than the entity.
`item._id` evaluates to `undefined` in UI callbacks.
UI components cannot remove deleted items from views.
Furthermore, [`ClientStateReconciler.ts:161`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L161) attempts to compensate by calling `manager.callbacks?.delete?.(existing)`.
This causes `callbacks.delete` to execute twice during delta sync.

---

## Replicating Test Summary

The test defines a spy callback for `callbacks.delete`.
An object is added to `manager.objects_` and deleted via `await manager.deleteObject(id)`.
The test asserts that `callbacks.delete` is called with the deleted object.
On current code, `callbacks.delete` is called with the manager instance.

---

## Solution

Modify line 158 of [`AutoUpdateManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateManagerClass.ts) to pass `o` instead of `this`:

```typescript
    if (res?.success || !o || typeof o?.destroy !== "function") {
      delete this.objects_[_idStr];
      delete globalCache.objects[_idStr];
    }
    if (o) {
      o.callbacks?.delete?.(o);
    }
    return res ?? { success: true, message: "Already gone" };
```

Remove the redundant duplicate call in [`sync/ClientStateReconciler.ts`](file:///E:/destop/_data/projects/DEM/src/sync/ClientStateReconciler.ts#L161).
