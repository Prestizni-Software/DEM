# BUG-09: getRawId Corrupts Reference Arrays into Comma Strings

## Metadata
- **Severity**: Low
- **Estimated Price**: $75 ($50 Base Bounty + $25 Solution Bonus)
- **Affected File**: [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L557-L566)
- **Replicating Test**: `BUG 9 [LOW]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L434-L459)

---

## Exact Description

[`getRawId`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L557) extracts raw string IDs for reference fields.
```typescript
  public getRawId(key: string): string | undefined {
    if (!this.data) return undefined;
    const val = (this.data as Record<string, unknown>)[key];
    if (!val) return undefined;
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null && (val as any)._id) {
      return (val as any)._id.toString();
    }
    return String(val);
  }
```
When `val` is an array of IDs or references (for example, `members: ["user-1", "user-2"]`), `Array.isArray(val)` is true.
Arrays lack `(val as any)._id`.
Line 565 executes `return String(val)`.
This returns `"user-1,user-2"` as a joined string rather than an array of ID strings.
Consumers expecting individual ID references receive corrupted concatenated strings.

---

## Replicating Test Summary

The test sets up an entity with `members: ["user-1", "user-2"]`.
The test calls `clientObj.getRawId("members")` and asserts that an array of string IDs is returned.
On current code, it returns the string `"user-1,user-2"`.

---

## Solution

Update [`getRawId`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L557) to handle arrays of references:

```typescript
  public getRawId(key: string): string | string[] | undefined {
    if (!this.data) return undefined;
    const val = (this.data as Record<string, unknown>)[key];
    if (!val) return undefined;
    if (Array.isArray(val)) {
      return val
        .map((item) =>
          item && typeof item === "object" && (item as any)._id
            ? (item as any)._id.toString()
            : item
              ? item.toString()
              : undefined,
        )
        .filter(Boolean) as string[];
    }
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null && (val as any)._id) {
      return (val as any)._id.toString();
    }
    return String(val);
  }
```
