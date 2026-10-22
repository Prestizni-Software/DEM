# BUG-02: Socket Handler Hardcoded 24-Char ID Length Drops Non-Hex IDs

## Metadata
- **Severity**: Critical
- **Estimated Price**: $600 ($400 Base Bounty + $200 Solution Bonus)
- **Affected File**: [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1113-L1115), [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1162-L1165)
- **Replicating Test**: `BUG 2 [CRITICAL]` in [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts#L144-L188)

---

## Exact Description

[`CommonTypes.ts`](file:///E:/destop/_data/projects/DEM/src/CommonTypes.ts#L7) defines `MongoId` as `string | ObjectId`.
Applications frequently use UUIDs (36 characters), numeric strings, or custom slug identifiers.
In [`AutoUpdateServerManager.registerSocket`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1113), the event routing logic checks:
```typescript
event.startsWith(EVENT_UPDATE + this.className) &&
event.replace(EVENT_UPDATE + this.className, "").length === 24
```
And in line 1164 for get requests:
```typescript
event.startsWith(EVENT_GET + this.className) &&
event.replace(EVENT_GET + this.className, "").length === 24
```
If an entity ID is not exactly 24 characters, the server drops the incoming WebSocket event.
The server never calls `ack`.
The client application promise hangs indefinitely in `this.writeQueue`.
The entire entity modification pipeline deadlocks.

---

## Replicating Test Summary

The test registers a socket on an `AutoUpdateServerManager`.
An entity with a 36-character standard UUID is added to `manager.objects_`.
The test emits `updateOrder<UUID>` with a callback acknowledgment.
On current code, `ack` is never invoked, and the update is ignored.

---

## Solution

Remove the hardcoded `.length === 24` check from [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts). Parse the identifier using prefix length slicing:

```typescript
        const updatePrefix = EVENT_UPDATE + this.className;
        const getPrefix = EVENT_GET + this.className;

        if (event.startsWith(updatePrefix)) {
          const id = event.slice(updatePrefix.length);
          if (!id) return;
          this.loggers.debug(
            "Updating object in manager " +
              this.className +
              ": " +
              event +
              " - " +
              (typeof data === "object" ? "[object]" : String(data)),
          );
          try {
            let obj = this.objects_[id];
            if (!obj) {
              obj = await this.handleGetMissingObject(id);
            }
            if (!obj)
              throw new DEMError(
                DEMErrorCode.OBJECT_GET_FAILED,
                `Never... failed to get object somehow: ${id}`,
              );
            const res = await (obj as any).setValue(
              (data as any).key,
              (data as any).value,
            );
            if (typeof ack === "function") {
              res.success
                ? ack({
                    data: null,
                    success: res.success,
                    code: (res as any).code,
                    message: res.msg,
                  })
                : ack({
                    data: null,
                    success: res.success,
                    code: (res as any).code ?? DEMErrorCode.DB_SAVE_FAILED,
                    message: res.msg,
                  });
            }
          } catch (error: unknown) {
            this.loggers.warn(
              "Failed to update object in manager " + this.className,
            );
            const demErr = toDEMError(error, DEMErrorCode.DB_SAVE_FAILED);
            if (typeof ack === "function") {
              ack({
                success: false,
                code: demErr.code,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } else if (event.startsWith(getPrefix)) {
          const id = event.slice(getPrefix.length);
          if (!id) return;
          try {
            let obj = this.objects_[id];
            if (!obj) {
              obj = await this.handleGetMissingObject(id);
            }
            if (!obj)
              throw new DEMError(
                DEMErrorCode.OBJECT_NOT_FOUND,
                `Object not found: ${id}`,
              );

            const requestedDepth =
              typeof data === "object" && data && typeof (data as any).depth === "number"
                ? (data as any).depth
                : 0;

            if (requestedDepth > 0) {
              const related = this.collectEntityGraph(obj, requestedDepth);
              if (typeof ack === "function") {
                ack({
                  data: (obj as any).extractedData,
                  related,
                  success: true,
                  message: "Retrieved successfully",
                });
              }
            } else {
              if (typeof ack === "function") {
                ack({
                  data: (obj as any).extractedData,
                  success: true,
                  message: "Updated successfully",
                });
              }
            }
          } catch (error: unknown) {
            this.loggers.error(
              "Error sending startup data for manager " +
                this.className +
                ": " +
                (error instanceof Error ? error.message : String(error)),
            );
            if (error instanceof Error && error.stack)
              this.loggers.error(error.stack);
            const demErr = toDEMError(error, DEMErrorCode.OBJECT_GET_FAILED);
            if (typeof ack === "function") {
              ack({
                success: false,
                code: demErr.code,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
```
