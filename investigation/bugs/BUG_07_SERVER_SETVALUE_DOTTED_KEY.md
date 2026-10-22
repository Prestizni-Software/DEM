# BUG-07: Server setValueInternal Creates Literal Dotted Key

## Metadata
- **Severity**: High
- **Estimated Price**: $300 ($200 Base Bounty + $100 Solution Bonus)
- **Affected File**: [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L384-L386), [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L391)
- **Replicating Test**: `BUG 7 [HIGH]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L357-L399)

---

## Exact Description

When updating a nested property (for example, `key = "config.theme"`), [`AutoUpdatedServerObject.setValueInternal`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L337) executes:
```typescript
if (this.entry) {
  (this.entry as any)[key] = value;
}
(this.data as any)[key] = value;
```
This assigns a property whose literal string key is `"config.theme"`.
It does not update `this.data.config.theme`.
`this.data` becomes `{ config: { theme: "light" }, "config.theme": "dark" }`.
Subsequent reads via `serverObj.config.theme` or `serverObj.getValue("config.theme")` return the stale value `"light"`.
The server in-memory entity state becomes inconsistent with the underlying MongoDB document.

---

## Replicating Test Summary

The test initializes a server object with `{ _id: "cfg-1", config: { theme: "light" } }`.
The test calls `await serverObj.setValue("config.theme", "dark")`.
The test asserts that `serverObj.getValue("config.theme") === "dark"` and `(serverObj.data as any)["config.theme"]` is undefined.
On current code, `(serverObj.data as any)["config.theme"]` is set literally, and `config.theme` remains `"light"`.

---

## Solution

Update [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L384) to traverse dotted paths using lodash `_.set`:

```typescript
      if (isPersisted) {
        this.saveLock = (this.saveLock ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            if (typeof this.parentManager.model?.updateOne === "function") {
              await this.parentManager.model.updateOne(
                { _id },
                { $set: { [key]: value } },
              );
            } else if (this.entry && typeof (this.entry as any).save === "function") {
              await (this.entry as any).save();
            }
            if (this.entry) {
              if (key.includes(".")) {
                _.set(this.entry, key, value);
              } else {
                (this.entry as any)[key] = value;
              }
            }
          });
        await this.saveLock;
      }

      if (key.includes(".")) {
        _.set(this.data as any, key, value);
      } else {
        (this.data as any)[key] = value;
      }
```
