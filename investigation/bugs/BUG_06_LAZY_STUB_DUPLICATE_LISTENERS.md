# BUG-06: Duplicate Socket Listeners Attached on Lazy Stub Hydration

## Metadata
- **Severity**: Medium
- **Estimated Price**: $150 ($100 Base Bounty + $50 Solution Bonus)
- **Affected File**: [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L484), [`AutoUpdatedClientObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L509-L522)
- **Replicating Test**: `BUG 6 [MEDIUM]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L325-L355)

---

## Exact Description

When a lazy stub is hydrated via [`hydrateFromData(payload)`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L478), line 484 executes:
```typescript
if (!this.isServer) this.openSockets();
```
In [`openSockets`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L509):
```typescript
  private openSockets() {
    const id = this.data?._id ?? this._id;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.on(
      event,
      async (update: unknown, ack: (res: ServerResponse<unknown>) => void) => { ... }
    );
  }
```
The method does not call `this.socket.off(event)` before calling `this.socket.on(event)`.
If an object is hydrated multiple times (e.g. initial hydration followed by delta sync or graph re-fetch), duplicate listeners are attached.
Every subsequent entity update triggers duplicate execution of `handleUpdateRequest` and fires duplicate UI update callbacks.

---

## Replicating Test Summary

The test instantiates a lazy stub and calls `stub.hydrateFromData(...)` twice.
The test measures the listener count on `this.socket` for the entity's update event.
On current code, two listeners are registered.

---

## Solution

Ensure [`openSockets`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L509) cleans up any existing listener for this entity before registering a new one:

```typescript
  private openSockets() {
    const id = this.data?._id ?? this._id;
    if (!id || !this.socket) return;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.off(event);
    this.socket.on(
      event,
      async (update: unknown, ack: (res: ServerResponse<unknown>) => void) => {
        const res = await this.handleUpdateRequest(
          update as { key: string; value: unknown },
        );
        if (ack && typeof ack === "function") ack(res);
        return res;
      },
    );
  }
```
