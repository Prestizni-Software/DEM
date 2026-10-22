# BUG-10: Server collectEntityGraph Ignores Unhydrated Database Relations in Lazy Loading

## Metadata
- **Severity**: Critical
- **Estimated Price**: $600 ($400 Base Bounty + $200 Solution Bonus)
- **Affected File**: [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717-L785), [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1180-L1190)
- **Replicating Test**: `BUG 10 [CRITICAL]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L461-L532)

---

## Exact Description

Smart Lazy Loading was introduced in commit `31abca1` ([`ADR 0001`](file:///E:/destop/_data/projects/DEM/src/docs/adr/0001-smart-lazy-loading-and-static-snapshots.md)).
In lazy loading mode, server managers do not load the full database into memory at startup.
When a client requests graph hydration via `manager.loadObject(id, { depth })`, the server executes [`collectEntityGraph`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717).
[`collectEntityGraph`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717) is implemented as a synchronous function.
Line 771 checks for referenced entities using only `const refObj = targetManager.getObject(refId)`.
Because unhydrated entities are not in `targetManager.objects_`, `refObj` evaluates to `undefined`.
Because [`collectEntityGraph`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717) is synchronous, it cannot query MongoDB via `targetManager.handleGetMissingObject(refId)`.
The server returns an empty dictionary `{ related: {} }`.
The client graph remains unhydrated stubs, causing runtime failures when reading entity relationships.

---

## Replicating Test Summary

The test configures `Author` and `Book` managers with `lazyLoading: true`.
`Author` references `book-1`.
`Book` document `book-1` exists in MongoDB, but is not preloaded into `bookManager.objects_`.
Calling `collectEntityGraph` asserts that `related["Book"]` contains the book data.
On current code, `related["Book"]` is undefined.

---

## Solution

Implement an asynchronous graph collector [`collectEntityGraphAsync`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717) that fetches missing entities via `targetManager.handleGetMissingObject(refId)`:

```typescript
  public async collectEntityGraphAsync(
    rootObj: T,
    maxDepth: number,
  ): Promise<Record<string, any[]>> {
    const visited = new Set<string>();
    const relatedByManager: Record<string, Map<string, any>> = {};

    const rootIdStr = rootObj._id.toString();
    visited.add(rootIdStr);

    type QueueItem = {
      obj: IAutoUpdatedClientObject<any>;
      manager: IAutoUpdateManager<any>;
      currentDepth: number;
    };

    const queue: QueueItem[] = [{ obj: rootObj, manager: this, currentDepth: 0 }];

    while (queue.length > 0) {
      const { obj, manager, currentDepth } = queue.shift()!;
      if (currentDepth >= maxDepth) continue;

      const classParam = (manager as any).classParam;
      let refProps: string[] = classParam?.__refPropsCache;
      if (!refProps && classParam) {
        const meta = setupClassAccessors(classParam);
        refProps = (classParam as any).__refPropsCache = Array.from(meta.refProps);
      }
      refProps = refProps ?? [];
      const dataRec = (obj as any).extractedData ?? (obj as any).data ?? obj;

      for (const prop of refProps) {
        const val = dataRec[prop];
        if (!val) continue;

        const targetClassName =
          (classParam?.__metaCache?.refsToMap?.get?.(prop)) ??
          getMetadataRecursive("refsTo", classParam?.prototype ?? obj, prop) ??
          getMetadataRecursive("refsTo", obj, prop);

        const targetManager = targetClassName && this.managers
          ? (this.managers as Record<string, IAutoUpdateManager<any>>)[targetClassName]
          : undefined;

        if (!targetManager) continue;

        const rawIds: string[] = Array.isArray(val)
          ? val.map((v) => (v && (v as any)._id ? (v as any)._id.toString() : v?.toString())).filter(Boolean)
          : [val && (val as any)._id ? (val as any)._id.toString() : val?.toString()].filter(Boolean);

        for (const refId of rawIds) {
          if (visited.has(refId)) continue;
          visited.add(refId);

          let refObj = targetManager.getObject(refId);
          if (!refObj && typeof (targetManager as any).handleGetMissingObject === "function") {
            try {
              refObj = await (targetManager as any).handleGetMissingObject(refId);
            } catch {
              // Ignore dangling references
            }
          }

          if (refObj) {
            if (!relatedByManager[targetManager.className]) {
              relatedByManager[targetManager.className] = new Map();
            }
            const extracted = (refObj as any).extractedData ?? (refObj as any).data ?? refObj;
            relatedByManager[targetManager.className].set(refId, extracted);

            queue.push({
              obj: refObj,
              manager: targetManager,
              currentDepth: currentDepth + 1,
            });
          }
        }
      }
    }

    const result: Record<string, any[]> = {};
    for (const [mgrName, map] of Object.entries(relatedByManager)) {
      result[mgrName] = Array.from(map.values());
    }
    return result;
  }
```

Await this method inside the `EVENT_GET` socket handler:
```typescript
if (requestedDepth > 0) {
  const related = await this.collectEntityGraphAsync(obj, requestedDepth);
  if (typeof ack === "function") {
    ack({
      data: (obj as any).extractedData,
      related,
      success: true,
      message: "Retrieved successfully",
    });
  }
}
```
