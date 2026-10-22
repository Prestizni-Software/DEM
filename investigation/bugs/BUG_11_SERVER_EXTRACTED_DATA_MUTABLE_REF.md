# BUG-11: Server extractedData Exposes Mutable Cached Object Reference

## Metadata
- **Severity**: Medium
- **Estimated Price**: $150 ($100 Base Bounty + $50 Solution Bonus)
- **Affected File**: [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L243-L258)
- **Replicating Test**: `BUG 11 [MEDIUM]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L534-L565)

---

## Exact Description

In [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L443), `extractedData` returns a deep clone:
```typescript
return _.cloneDeep(extracted) as unknown as ExtractedData<T, IAutoUpdatedClientObject<any>>;
```
In [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L243), `extractedData` caches and returns a direct object reference:
```typescript
if (this._cachedExtractedData) return this._cachedExtractedData;
const extracted = processIsRefProperties(...).newData;
this._cachedExtractedData = extracted;
return extracted;
```
When server code, serialization hooks, or middleware access `serverObj.extractedData` and modify properties, `this._cachedExtractedData` is directly mutated.
The mutated cache persists in memory until the next write.
Subsequent socket broadcasts (`new<ClassName>`, startup payloads, delta changes) transmit the corrupted in-memory object to connected clients.

---

## Replicating Test Summary

The test reads `serverObj.extractedData`.
The test mutates a nested property on the returned object.
The test reads `serverObj.extractedData` again and asserts that the internal cache remains unmutated.
On current code, the second read reflects the external mutation.

---

## Solution

Return a clone of `this._cachedExtractedData` or freeze the cached object:

```typescript
  public override get extractedData(): ExtractedData<
    T,
    IAutoUpdatedClientObject<any>
  > {
    if (this._cachedExtractedData) {
      return _.cloneDeep(this._cachedExtractedData);
    }
    const extracted = processIsRefProperties(
      this.data as any,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData as ExtractedData<T, IAutoUpdatedClientObject<any>>;
    this._cachedExtractedData = extracted;
    return _.cloneDeep(extracted);
  }
```
