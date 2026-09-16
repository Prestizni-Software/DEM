# DEM Object Creation Architecture & Complete Lifecycle Guide

This document provides an exhaustive, end-to-end breakdown of the object creation process in DEM (Data Exchange Manager). It details how objects are instantiated, sanitized, persisted to MongoDB, linked via references, synchronized across client and server processes, and protected against browser failure modes.

---

## 1. High-Level Architecture & Communication Sequence

When an application calls `createObject(data)` on a client manager, DEM executes a bi-directional network flow involving database persistence, dynamic reference resolution, reactive getter/setter generation, and peer-to-peer event broadcasting.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           CLIENT MANAGER & OBJECT                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  1. clientManager.createObject(data)
       │
       ▼
  2. Instantiate new ClientObjectClass(classParam, socket, data, loggers, className, parentManager, callbacks, emitter)
       │
       ├──> Extract class properties & static __propsCache (via Reflect metadata)
       │
       ├──> handleDataCleanup(data): convert embedded DEM instances to raw string IDs
       │
       └──> handleNewObject(data):
                ├──> Check socket availability
                ├──> Sanitize payload: JSON.parse(JSON.stringify(data))
                └──> Emit socket.emit("new" + ClassName, payload, ack) ───────┐
                                                                              │
┌─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┐
│                                            SOCKET.IO NETWORK                │                                    │
└─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┘
                                                                              │
                                      "new" + ClassName Event Payload         │
                                                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           SERVER MANAGER & OBJECT                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                        3. Event Middleware Check
                                                                              │
                                                                              ▼
                                                                        4. serverManager.createObject(data)
                                                                              │
                                                                              ├──> Clean payload (remove null/empty _id)
                                                                              ├──> model.create(dataRec) ──► MongoDB _id
                                                                              ├──> createAutoUpdatedClass(...)
                                                                              │     ├──> Instantiate ServerObjectClass
                                                                              │     ├──> Convert reference string IDs to Mongo ObjectIds
                                                                              │     └──> Load from Mongo Document (loadFromDocument)
                                                                              ├──> Sync virtual/unpersisted fields from payload
                                                                              ├──> Register in server globalCache & objects_
                                                                              ├──> Resolve references (loadMissingReferences, contactChildren)
                                                                              │
                                                                              ├──> Broadcast socket.emit("new" + ClassName, id)
                                                                              │    to all authorized client sockets
                                                                              │
                                                                              └──> Execute Server ACK Callback:
                                                                                   { success: true, message: "Created successfully",
                                                                                     data: newDoc.extractedData }
                                                                              │
┌─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┐
│                                            SOCKET.IO NETWORK                │                                    │
└─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┘
                                                                              │
                                      Server ACK Response with data           │
                                                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           CLIENT MANAGER & OBJECT                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  5. Client ACK Callback Handler:
       │
       ├──> Populate this.data = res.data (contains server-generated _id)
       ├──> generateSettersAndGetters()
       ├──> Set isLoading = false
       ├──> Open real-time socket listener ("update" + ClassName + id)
       └──> Emit EVENT_INTERNAL_PRE_LOADED + EmitterID
       │
       ▼
  6. clientManager.createObject Resumes:
       │
       ├──> await object.waitForPreloaded() (bounded by 15s timeout safeguard)
       ├──> Extract & validate string _id
       ├──> Index object in client objects_[id] and globalCache.objects[id]
       ├──> Execute object.isPreLoadedAsync(), loadMissingReferences(), contactChildren()
       ├──> Trigger callbacks.new(object)
       └──> Return initialized client object instance to caller
```

---

## 2. Detailed Step-by-Step Execution Process

### Step 1: Client Invocation & Manager Pre-Checks
1. **Entry Point**: The application calls `await clientManager.createObject(data)` on an `AutoUpdateClientManager` instance.
2. **Manager Verification**: Verifies `this.managers` exists. If missing, throws `No managers.` error immediately.
3. **Instantiation**: Instantiates a new client object via `new this.classParam(...)`, passing:
   - `classParam` (Constructor reference)
   - `socket` (Socket.IO client instance)
   - `data` (User-supplied object payload)
   - `loggers` (Logger delegate)
   - `className` (Manager identifier)
   - `parentManager` (`this`)
   - `callbacks` (Manager callbacks map)
   - `emitter` (EventEmitter3 instance)

### Step 2: Client Object Constructor Initialization
1. **Metadata Property Extraction**:
   - Checks if `classParam.__propsCache` exists.
   - If not cached, recursively walks the prototype chain (`Reflect.getOwnMetadata("props", proto_)`) to collect all `@prop` decorated property names into an array and caches it on `classParam.__propsCache`.
2. **Data Cleanup (`handleDataCleanup`)**:
   - Deep clones and cleans the incoming `data` structure.
   - If embedded objects contain `_id` and `className` (DEM object instances), converts them to raw string IDs (`value._id.toString()`).
   - For all properties decorated with `isRef`, ensures array or single values are normalized to string IDs.
3. **New Object Routing (`handleNewObject`)**:
   - If `(!this.data._id || this.data._id === "")` and `!this.isServer`, the constructor identifies the object as newly created and invokes `this.handleNewObject(this.data)`.

### Step 3: Payload Sanitization & Socket Emission
1. **Socket Guard**: Verifies `this.socket` is present. If missing, sets `loadError` and emits `EVENT_INTERNAL_PRE_LOADED + EmitterID` with failure true to reject `waitForPreloaded()`.
2. **JSON Sanitization**: Sanitizes `data` via `JSON.parse(JSON.stringify(data))`.
   - *Rationale*: Strips non-serializable UI state, DOM node references, framework reactivity proxy traps (Vue/MobX/React), and browser extension wrappers (e.g. Edge context wrappers) before network encoding.
   - *Fallback*: If JSON serialization throws, logs a warning and falls back to raw data.
3. **Network Transmission**: Emits `EVENT_NEW + this.className` (e.g. `"newCompany"`) with the sanitized payload and an ACK callback function over Socket.IO.

### Step 4: Server-Side Socket Middleware & Dispatch
1. **Middleware Security Check**: Server Socket.IO middleware intercepts `new` + `className` event:
   - Constructs a `DEMEvent` of type `DEMEventTypes.new`.
   - Runs `eventMiddleware` (if configured in `accessDefinitions`). If denied, returns `{ success: false, message: "You were denied access..." }` back to client ACK callback.
2. **Server Manager Handlers**: If authorized, dispatches to `serverManager.createObject(data)`.

### Step 5: Server-Side MongoDB Persistence & Server Object Wrapping
1. **Data Record Cleaning**: Removes empty or null `_id` fields (`delete dataRec._id`).
2. **Database Insert**: Calls `await this.model.create(dataRec)`, persisting the document to MongoDB and generating a primary `_id`.
3. **Server Object Instantiation (`createAutoUpdatedClass`)**:
   - Calls `new classParam(...)` with `isServer = true`.
   - **Reference ObjectId Conversion**: Iterates over `isRef` properties in `this.properties`. Converts string IDs to MongoDB `ObjectId` instances for database queries.
   - **Document Binding**: Calls `obj.loadFromDocument(doc)` to populate `this.entry = doc`, update `this.data = doc.toObject()`, set `isLoading = false`, and emit `EVENT_INTERNAL_PRE_LOADED + EmitterID`.
4. **Virtual Reference Copying**:
   - Copies unpersisted/virtual reference properties present in the initial payload (`dataRec`) but not defined in the Mongo schema into `object.data`.
5. **Cache Registration**: Indexes the server object in `serverManager.objects_[id]` and `globalCache.objects[id]`.
6. **Server Reference Loading**:
   - Executes `await object.isPreLoadedAsync()`, `await object.loadMissingReferences()`, and `await object.contactChildren()`.
7. **Peer Broadcast**:
   - Iterates through connected client sockets, runs `startupMiddleware` security checks for each socket, and emits `socket.emit("new" + className, id)` to inform connected clients of the newly created object.
8. **Server ACK Response**: Returns `{ success: true, message: "Created successfully", data: newDoc.extractedData }` to the creating client.

### Step 6: Client ACK Response Processing & Dynamic Setters/Getters
1. **Data Population**: Client receives ACK payload `res.data` (containing the server-assigned `_id`). Sets `this.data = res.data`.
2. **Dynamic Setters & Getters Generation (`generateSettersAndGetters`)**:
   - Defines reactive property accessors on `this` for each property in `this.properties`:
     - **Getter**: Retrieves property value from `this.data[key]`. For `isRef` properties, resolves target object(s) from `globalCache.objects` or `parentManager.cache.references`.
     - **Setter**: Sets `this.data[key]`, normalizes references to string IDs, and emits real-time updates to the server via `setValueInternal`.
3. **State Transition & Real-Time Sockets**: Sets `this.isLoading = false`, opens real-time socket listeners (`EVENT_UPDATE + className + id`), and emits `EVENT_INTERNAL_PRE_LOADED + EmitterID`.

### Step 7: Client Manager Indexing & Final Return
1. **Preload Await (`waitForPreloaded`)**: `clientManager.createObject` awaits `object.waitForPreloaded()`, bounded by a 15-second timeout.
2. **Safe ID Extraction**: Extracts string `_id` (`object._id?.toString() ?? object.data?._id?.toString()`) and validates it is non-null.
3. **Global & Manager Cache Registration**: Registers `object` in `this.objects_[id]` and `globalCache.objects[id]`.
4. **Reference Resolution & Linkage**: Executes `isPreLoadedAsync()`, `loadMissingReferences()`, and `contactChildren()` to establish reference links with pre-existing local objects.
5. **Lifecycle Callbacks**: Triggers `this.callbacks.new(object)`.
6. **Completion**: Returns the fully functional, reactive client object instance.

---

## 3. Data Transformation & Payload Lifecycle

| Stage | Data Format / Structure | Example |
| :--- | :--- | :--- |
| **1. User Input** | Raw JavaScript Object (may include embedded DEM objects) | `{ name: "Project Alpha", company: companyObj }` |
| **2. After `handleDataCleanup`** | Normalized object with string IDs for references | `{ name: "Project Alpha", company: "64f1a2b3c4d5e6f7a8b9c0d1" }` |
| **3. Wire Payload (Socket.IO)** | JSON-serialized stringified representation | `{"name":"Project Alpha","company":"64f1a2b3c4d5e6f7a8b9c0d1"}` |
| **4. MongoDB Document** | BSON Document with native `ObjectId` fields | `{ _id: ObjectId("..."), name: "Project Alpha", company: ObjectId("...") }` |
| **5. Server Object `data`** | Server-side data dictionary | `{ _id: ObjectId("..."), name: "Project Alpha", company: ObjectId("...") }` |
| **6. `extractedData` (ACK)** | Plain JS object shipped back over socket | `{ _id: "64f...", name: "Project Alpha", company: "64f..." }` |
| **7. Final Client Object** | Reactive `AutoUpdatedClientObject` instance with getters/setters | `clientObj.company` returns `Company` object instance |

---

## 4. On-Demand Missing Object Creation (`handleGetMissingObject`)

When a reference property points to an object ID that is not yet loaded in the local client cache:
1. `handleGetMissingObject(id)` is triggered on the manager.
2. It instantiates a stub `ClientObjectClass` passing `data = id` (string).
3. The object constructor emits `EVENT_GET + className + id` to fetch object data from the server.
4. Upon receiving server data, sets `this.data`, generates getters/setters, registers in `globalCache`, resolves missing references, and triggers `callbacks.new(object)`.

---

## 5. Browser Safeguards & Resilience Mechanisms Implemented

To prevent silent hanging, network serialization aborts, and crashes in strict browser environments (e.g. Microsoft Edge, restricted WebViews):

1. **Bounded Preloading Timeout (`waitForPreloaded`)**:
   - `waitForPreloaded()` wraps `emitter.once(EVENT_INTERNAL_PRE_LOADED)` in a 15-second `setTimeout`.
   - If preloading hangs due to dropped network packets or socket ACK loss, the promise explicitly rejects with an `Error`, allowing caller `catch` blocks to execute.

2. **Payload JSON Serialization Guard**:
   - `handleNewObject` sanitizes object payloads via `JSON.parse(JSON.stringify(data))` prior to `socket.emit`.
   - Prevents Socket.IO's internal encoder from throwing silent serialization exceptions when given non-serializable DOM elements, functions, circular references, or browser proxy traps.

3. **Web Crypto Fallback for `EmitterID`**:
   - `EmitterID` generation wraps `new ObjectId().toHexString()` in a `try/catch` block.
   - Falls back to `Math.random().toString(36) + Date.now()` if Web Crypto (`crypto.getRandomValues`) is restricted in non-secure HTTP contexts or WebViews.

4. **Safe `_id` Extraction Guard**:
   - `createObject` uses optional chaining (`object._id?.toString() ?? object.data?._id?.toString()`) and validates non-null state before indexing into `objects_`.

5. **Server Virtual Property Sync**:
   - Ensures reference properties present in the initial creation payload but excluded from MongoDB schemas (virtual/computed references) are preserved in `object.data`.

6. **Database Write Serialization (`saveLock`) & Recursion Safety (`noUpdate`)**:
   - `AutoUpdatedServerObject` serializes DB updates using a promise chain (`saveLock`) to prevent Mongo write collisions.
   - Passes `noUpdate = true` during internal updates to prevent infinite `onUpdate` callback loops.
