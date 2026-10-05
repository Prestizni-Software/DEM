# DEM Library Defect Report & Reproduction Guide

This document provides a comprehensive analysis and step-by-step reproduction guide for critical architectural defects identified in the DEM synchronization library (`@prestizni-software/client-dem` and `@prestizni-software/server-dem`).

---

## 1. Bug A: Dynamic Permission Boundary Subscription Gap (Invisible Changes Until Restart)

### Overview
Action buttons on the client update database properties correctly, but other connected clients whose permissions dynamically qualify them to see the updated document do not receive real-time updates until they completely restart the application.

### Mechanism & Root Cause in DEM
1. **Initial Subscription at Startup (`EVENT_STARTUP`):**
   - When a client connects, DEM executes `startupMiddleware` per collection on the server.
   - For example, a `Supervisor` user only receives protocols in `SUPERVISOR`, `APPROVED`, or `DONE` status. Protocols in `FOR_REVIEW` (Category 5) are filtered out.
   - For every document returned at startup, the client instantiates an `AutoUpdatedClientObject` and registers a Socket.io listener:
     ```javascript
     this.socket.on("update" + this.className + this._id.toString(), (update) => { ... });
     ```
2. **Mutation Across Permission Boundary:**
   - An HSV user clicks **Schválit** on a protocol in `FOR_REVIEW` status.
   - The protocol's `status` changes from `FOR_REVIEW` to `SUPERVISOR`.
   - The server calls `setValueInternal("status", "SUPERVISOR")` and emits:
     ```javascript
     this.socket.emit("updateProtocol" + id, update);
     ```
3. **The Architectural Flaw:**
   - The Supervisor's client socket receives the WebSocket packet for `updateProtocol<id>`.
   - However, because the Supervisor never received this document at startup, the client has **no object instance** in `DB_HANDLER.Protocol.objects` and **no active listener** for `updateProtocol<id>`.
   - In DEM's server architecture, `socket.emit("new" + className, id)` is **only invoked inside `createObject(data)` upon initial document creation**. DEM never emits `new<ClassName>` when existing documents mutate to match a client's permission filter.
   - **Result:** The document remains completely invisible to the Supervisor until the app is restarted (which triggers a fresh startup sync).

---

### Step-by-Step Reproduction Guide

#### Prerequisites:
- Server running with DEM synchronization.
- Two active client sessions:
  - **Client A:** User with role `HeadConstructionLeader` (HSV).
  - **Client B:** User with role `Supervisor` (Dozor).

#### Steps:
1. In Client A (HSV), create or locate a task where the protocol is in Category 5 (`FOR_REVIEW`).
2. In Client B (Supervisor), observe that this task is **not visible** in Category 6 (`SUPERVISOR`) or anywhere else (filtered out by `startupMiddleware`).
3. In Client A (HSV), click **Schválit** (Approve).
4. Open the Developer Tools / Network WebSocket tab on Client B (Supervisor):
   - Client B receives the socket frame `42["updateProtocol<id>", {...}]`.
   - Inspect `DB_HANDLER.Protocol.getObject("<id>")` on Client B: it returns `undefined`.
   - Inspect the UI on Client B: **The card is missing and does not appear**.
5. Reload / restart Client B:
   - Startup runs.
   - The protocol is now in `SUPERVISOR` status, matching the Supervisor's `startupMiddleware`.
   - The task appears in Category 6 (`SUPERVISOR`).

---

### Recommended Fix in DEM Library Source

In `@prestizni-software/server-dem` inside `AutoUpdatedServerObjectClass.js` / `AutoUpdateServerManagerClass.js`:
After `setValue` or `onUpdate` resolves on an object:
1. Iterate connected client sockets and evaluate `startupMiddleware` for the mutated object.
2. If a connected socket did not previously have access to the object but now satisfies `startupMiddleware`, emit `new<ClassName>` with the object ID to that socket:
   ```javascript
   socket.emit("new" + this.className, this._id.toString());
   ```
3. If a connected socket previously had access to the object but no longer satisfies `startupMiddleware`, emit `delete<ClassName>` with the object ID to that socket.

---

## 2. Bug B: `writeQueue` Recursive Self-Deadlock (App Freezes on Approvals / Rejections)

### Overview
When a Supervisor or HSV approves or rejects a protocol, the action hangs indefinitely with a loading spinner. The database update never resolves on the client, and subsequent actions freeze.

### Mechanism & Root Cause in DEM
1. **Client Action:**
   - The mobile client executes `await protocol.setValue("supervisorAprovement", ApprovementStatus.APPROVED)`.
   - The client creates a promise that only resolves when the server responds via Socket.io acknowledgment (`ack`).
2. **Server Execution Chain:**
   - The server receives `EVENT_UPDATE` and calls `await obj.setValue(key, value)`.
   - In `AutoUpdatedClientObjectClass.js`, `setValue` chains operations onto an internal promise queue:
     ```javascript
     async setValue__(key, val) {
         this.writeQueue = this.writeQueue
             .catch(() => {})
             .then(() => this.setValueQueueInternal(key, val));
         return this.writeQueue;
     }
     ```
   - Inside `setValueQueueInternal`, DEM calls `await this.onUpdate(noUpdate, key)`.
3. **The Deadlock:**
   - The execution of `onUpdate` takes place **inside the active `then()` callback of `this.writeQueue`**.
   - If `onUpdate` triggers any workflow that calls `await obj.setValue(...)` on that same object (for example: `moveProtocolFileToIntegrationFolder` updates `attachment.path`, which triggers `Attachment.onUpdate`, which in turn triggers `logAttachmentSystemComment` calling `await protoObj.setValue("comments", ...)`):
     - `protoObj.setValue` chains onto `protoObj.writeQueue` and returns that Promise.
     - The inner call `await protoObj.setValue(...)` pauses execution waiting for `writeQueue` to resolve.
     - However, `writeQueue` cannot resolve until the parent `onUpdate` completes!
   - **Result:** Recursive self-deadlock. The server hangs permanently on the promise. Socket acknowledgment (`ack`) is never returned to the client. The mobile app's `await protocol.setValue(...)` hangs forever with a spinning loader.

---

### Step-by-Step Reproduction Guide

#### Minimal DEM Reproduction Code:
```javascript
// Server DEM configuration:
const managers = await AUCManagerFactory({
    Protocol: {
        class: Protocol,
        options: {
            onUpdate: async (protocol, set, key) => {
                if (key === "supervisorAprovement") {
                    // Triggering a secondary async action that invokes protocol.setValue directly
                    await protocol.setValue("comments", [...protocol.comments, "Approved"]);
                }
            }
        }
    }
});

// Client action:
const result = await protocol.setValue("supervisorAprovement", 1);
// OBSERVE: Promise hangs forever. Neither resolve nor reject is ever called.
```

---

### Recommended Fix in DEM Library Source

In `@prestizni-software/server-dem` inside `AutoUpdatedServerObjectClass.js`:
Modify `setValue` to detect if the object is currently processing an update (`this._isUpdating === true`). When updating, bypass `this.writeQueue` chaining to prevent self-deadlock:

```javascript
async setValue(key, val) {
    if (this._isUpdating && typeof this.setValueQueueInternal === "function") {
        return this.setValueQueueInternal(key, val, false, false, true);
    }
    return await this.setValue__(key, val);
}
```
