# Dynamic Permissions & WriteQueue Deadlock Prevention

## 1. Dynamic Permission Boundary Subscription Synchronization (Bug A)

### Problem
In DEM, `socket.emit("new" + className, id)` was historically only dispatched during initial document creation (`createObject`). Connected clients filtering collections via `startupMiddleware` (e.g. status-based access control where a Supervisor only sees approved protocols) would miss mutated documents that later satisfied their filter. When an HSV user approved a protocol, the server emitted `updateProtocol<id>`, but the Supervisor had no client object instance and no socket listener for that ID, making the document invisible until app restart.

### Architecture & Fix
- `AutoUpdateServerManager` tracks known object IDs per connected socket in `knownObjectIdsBySocket: Map<Socket, Set<string>>`.
- When an object's properties mutate (`setValueInternal` / `onUpdate`), `parentManager.checkPermissionBoundaries(object)` evaluates `startupMiddleware` for each connected client:
  - **Permission Granted (`hasAccess && !hadAccess`)**: The server emits `new<ClassName>` with the object ID to that socket and adds the ID to `knownObjectIdsBySocket`. The client invokes `handleGetMissingObject`, loads the document, and registers real-time update listeners.
  - **Permission Revoked (`!hasAccess && hadAccess`)**: The server emits `delete<ClassName>` with the object ID to that socket and removes the ID from `knownObjectIdsBySocket`. The client invokes `deleteObject` and unregisters the socket listener.
- `AutoUpdateClientManager` guards against duplicate `new` and `delete` events for existing / absent objects.

---

## 2. WriteQueue Recursion Self-Deadlock Prevention (Bug B)

### Problem
`AutoUpdatedClientObject.prototype.setValue` serializes all write operations via `this.writeQueue = this.writeQueue.then(...)`. During server-side `setValueQueueInternal`, the server awaits the `onUpdate` lifecycle hook. If `onUpdate` (or any secondary workflow triggered by it) called `await obj.setValue(...)` on that same object, the inner call chained onto `this.writeQueue`. Because `this.writeQueue` was blocked waiting for `onUpdate` to finish, a permanent deadlock occurred, freezing socket ACKs and client operations.

### Architecture & Fix
- `AutoUpdatedServerObject` overrides `setValue` and `setValue__` to inspect `this._isUpdating`.
- When `this._isUpdating === true`, `setValue` and `setValue__` bypass `this.writeQueue` chaining and directly execute `setValueQueueInternal(key, val, false, false, true)`, avoiding deadlock while preserving sequential DB persistence and lifecycle handling.
