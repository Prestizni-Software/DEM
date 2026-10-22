import { jest } from "@jest/globals";
import { AutoUpdateServerManager } from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import { AutoUpdatedClientObject } from "../../AutoUpdatedClientObjectClass.js";
import { EventEmitter } from "eventemitter3";
import { globalCache, LoggersType } from "../../CommonTypes.js";
import { ClientStateReconciler } from "../../sync/ClientStateReconciler.js";
import "reflect-metadata";

jest.setTimeout(10000);

function makeLoggers(): LoggersType {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

function makeMockSocket(overrides: Record<string, any> = {}) {
  const listeners: Record<string, Function[]> = {};
  const anyListeners: Function[] = [];
  return {
    on: jest.fn((event: string, cb: Function) => {
      (listeners[event] = listeners[event] || []).push(cb);
    }),
    off: jest.fn((event: string, cb?: Function) => {
      if (!cb) {
        delete listeners[event];
      } else if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== cb);
      }
    }),
    once: jest.fn((event: string, cb: Function) => {
      (listeners[event] = listeners[event] || []).push(cb);
    }),
    onAny: jest.fn((cb: Function) => {
      anyListeners.push(cb);
    }),
    emit: jest.fn((event: string, data: any, cb?: Function) => {
      if (typeof cb === "function") {
        cb({ success: true, message: "OK" });
      }
    }),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(() => {
      for (const k in listeners) delete listeners[k];
      anyListeners.length = 0;
    }),
    listeners: (event: string) => listeners[event] || [],
    _trigger: async (event: string, ...args: any[]) => {
      for (const fn of anyListeners) {
        await fn(event, ...args);
      }
      const handlers = listeners[event] || [];
      for (const fn of handlers) {
        await fn(...args);
      }
    },
    ...overrides,
  } as any;
}

function makeMockModel(overrides: Record<string, any> = {}) {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findByIdAndDelete: jest.fn().mockResolvedValue({ _id: "deleted" }),
    schema: { path: (key: string) => ({ instance: "String" }) },
    ...overrides,
  } as any;
}

function createClientMockClass(props: string[] = ["_id"], refProps: string[] = []) {
  class MockClientEntity extends AutoUpdatedClientObject<any> {
    get _id() {
      return (this as any).data?._id;
    }
    override waitForPreloaded = jest.fn().mockResolvedValue(undefined as any);
  }
  Reflect.defineMetadata("props", props, MockClientEntity.prototype);
  for (const ref of refProps) {
    Reflect.defineMetadata("isRef", true, MockClientEntity.prototype, ref);
  }
  return MockClientEntity;
}

function createServerMockClass(props: string[] = ["_id"], refProps: string[] = []) {
  class MockServerEntity extends AutoUpdatedServerObject<any> {
    get _id() {
      return (this as any).data?._id;
    }
  }
  Reflect.defineMetadata("props", props, MockServerEntity.prototype);
  for (const ref of refProps) {
    Reflect.defineMetadata("isRef", true, MockServerEntity.prototype, ref);
  }
  return MockServerEntity;
}

describe("Strict DEM Bug Repositories — Automated Proof Suite", () => {
  afterEach(() => {
    globalCache.clear();
  });

  // =========================================================================
  // BUG 1 (CRITICAL): Server deleteObject skips DB delete on unhydrated/lazy objects
  // =========================================================================
  test("BUG 1 [CRITICAL]: Server deleteObject must delete unhydrated/lazy entities from MongoDB and not falsely record changes on DB error", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockModel = makeMockModel();
    const ServerClass = createServerMockClass(["_id", "name"]);

    const manager = new AutoUpdateServerManager(
      ServerClass as any,
      "TestItem",
      makeMockSocket(),
      loggers,
      mockModel,
      {},
      emitter,
    );

    // Entity exists in MongoDB, but is NOT yet loaded into memory (e.g. lazy loading / startup filter)
    const entityId = "64b0f0000000000000000001";
    expect(manager.getObject(entityId)).toBeUndefined();

    // Invoking deleteObject for an unhydrated object
    const result = await manager.deleteObject(entityId);

    // EXPECTED: MongoDB model.deleteOne or model.findByIdAndDelete must be executed!
    // ON CURRENT CODE: DB delete is NEVER called because this.objects_[id] is undefined!
    expect(mockModel.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ _id: entityId }));
    expect(result.success).toBe(true);
  });

  // =========================================================================
  // BUG 2 (CRITICAL): Server socket ignores update/get for non-24-char IDs (UUIDs, custom string IDs)
  // =========================================================================
  test("BUG 2 [CRITICAL]: Server socket handler must not silently drop update/get events for non-24-character IDs", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const ServerClass = createServerMockClass(["_id", "status"]);
    const mockModel = makeMockModel();

    const manager = new AutoUpdateServerManager(
      ServerClass as any,
      "Order",
      makeMockSocket(),
      loggers,
      mockModel,
      {},
      emitter,
    );

    const clientSocket = makeMockSocket({ id: "client-1" });
    manager.registerSocket(clientSocket);

    // Standard UUID identifier (36 characters)
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const serverObj = new ServerClass(
      ServerClass,
      clientSocket,
      { _id: uuid, status: "pending" },
      loggers,
      "Order",
      manager,
      emitter,
    );
    (manager as any).objects_[uuid] = serverObj;

    let ackResponse: any = null;
    const ackFn = (res: any) => {
      ackResponse = res;
    };

    // Client emits update event with UUID
    await clientSocket._trigger(`updateOrder${uuid}`, { key: "status", value: "completed" }, ackFn);

    // EXPECTED: Server must acknowledge the update request and update the status
    // ON CURRENT CODE: The server handler checks `length === 24`, ignores UUIDs completely, and ack is NEVER called!
    expect(ackResponse).not.toBeNull();
    expect(ackResponse?.success).toBe(true);
    expect((serverObj as any).status).toBe("completed");
  });

  // =========================================================================
  // BUG 3 (HIGH): Client deleteObject echoes EVENT_DELETE back to server on incoming delete
  // =========================================================================
  test("BUG 3 [HIGH]: Client must not echo delete events back to server when handling server deletion broadcast or delta sync", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();
    const ClientClass = createClientMockClass(["_id", "title"]);

    const clientManager = new AutoUpdateClientManager(
      ClientClass as any,
      "Task",
      mockSocket,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const obj = new ClientClass(
      ClientClass,
      mockSocket,
      { _id: "task-100", title: "Test" },
      loggers,
      "Task",
      clientManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (clientManager as any).objects_["task-100"] = obj;

    // Simulate delta sync receiving a deletion from the server
    await ClientStateReconciler.applyDelta(clientManager as any, {
      status: "delta",
      revision: 10,
      changes: [{ revision: 10, type: "delete", id: "task-100", timestamp: Date.now() }],
    });

    // EXPECTED: Client should clean up local state without echoing "deleteTask" back to the server
    // ON CURRENT CODE: applyDelta calls manager.deleteObject which calls obj.destroy(true) which emits "deleteTask" back to the server!
    const deleteEmits = mockSocket.emit.mock.calls.filter((call: any[]) => call[0] === "deleteTask");
    expect(deleteEmits.length).toBe(0);
  });

  // =========================================================================
  // BUG 4 (HIGH): AutoUpdateManager.deleteObject passes Manager to callbacks.delete
  // =========================================================================
  test("BUG 4 [HIGH]: AutoUpdateManager.deleteObject must pass deleted entity instance to callbacks.delete, not the Manager instance", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const deleteCallback = jest.fn();
    const ClientClass = createClientMockClass(["_id", "name"]);

    const manager = new AutoUpdateClientManager(
      ClientClass as any,
      "Person",
      makeMockSocket(),
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: deleteCallback },
    );

    const person = new ClientClass(
      ClientClass,
      makeMockSocket(),
      { _id: "person-99", name: "Alice" },
      loggers,
      "Person",
      manager,
      { new: jest.fn(), update: jest.fn(), delete: deleteCallback },
      emitter,
    );
    (manager as any).objects_["person-99"] = person;

    await manager.deleteObject("person-99");

    // EXPECTED: deleteCallback must be called with the deleted person object `person`
    // ON CURRENT CODE: Line 158 calls `o?.callbacks?.delete?.(this)` passing `this` (the Manager instance)!
    expect(deleteCallback).toHaveBeenCalledWith(person);
    expect(deleteCallback).not.toHaveBeenCalledWith(manager);
  });

  // =========================================================================
  // BUG 5 (HIGH): Client loadFromServer stacks duplicate update listeners on reload
  // =========================================================================
  test("BUG 5 [HIGH]: loadFromServer on reload must remove update listeners from old objects to prevent zombie listener leaks", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket({
      emit: jest.fn((event: string, _data: any, cb: any) => {
        if (event === "startupDocument") {
          cb({
            success: true,
            data: {
              ids: ["doc-1"],
              properties: ["_id", "title"],
              objects: [{ _id: "doc-1", title: "Doc 1" }],
              status: "full",
            },
          });
        }
      }),
    });

    const ClientClass = createClientMockClass(["_id", "title"]);
    const manager = new AutoUpdateClientManager(
      ClientClass as any,
      "Document",
      mockSocket,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    // Initial startup
    await manager.loadFromServer();
    const initialListenersCount = mockSocket.listeners("updateDocumentdoc-1").length;
    expect(initialListenersCount).toBe(1);

    // Reconnection / reload
    await manager.loadFromServer();
    const reconnectedListenersCount = mockSocket.listeners("updateDocumentdoc-1").length;

    // EXPECTED: Exactly 1 active listener for "updateDocumentdoc-1"
    // ON CURRENT CODE: 2 listeners exist because old object's listener was never removed!
    expect(reconnectedListenersCount).toBe(1);
  });

  // =========================================================================
  // BUG 6 (MEDIUM): hydrateFromData on lazy stub registers duplicate update listeners
  // =========================================================================
  test("BUG 6 [MEDIUM]: hydrateFromData on lazy stub must not register duplicate socket update listeners", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();
    const ClientClass = createClientMockClass(["_id", "name"]);

    const stub = new ClientClass(
      ClientClass,
      mockSocket,
      { _id: "lazy-10", __isLazyStub: true } as any,
      loggers,
      "Project",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    // First hydration registers a listener
    stub.hydrateFromData({ _id: "lazy-10", name: "Hydrated Project 1" });
    expect(mockSocket.listeners("updateProjectlazy-10").length).toBe(1);

    // Second hydration (e.g. refresh, delta sync or re-hydration)
    stub.hydrateFromData({ _id: "lazy-10", name: "Hydrated Project 2" });

    // EXPECTED: Still exactly 1 listener on the socket
    // ON CURRENT CODE: hydrateFromData calls openSockets() again without off(), so listener count becomes 2!
    expect(mockSocket.listeners("updateProjectlazy-10").length).toBe(1);
  });

  // =========================================================================
  // BUG 7 (HIGH): Server setValueInternal creates literal dotted property key
  // =========================================================================
  test("BUG 7 [HIGH]: Server setValueInternal must update nested object property instead of creating literal dotted key", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const ServerClass = createServerMockClass(["_id", "config"]);
    const mockModel = makeMockModel();

    const manager = new AutoUpdateServerManager(
      ServerClass as any,
      "SystemConfig",
      makeMockSocket(),
      loggers,
      mockModel,
      {},
      emitter,
    );

    const initialConfig = { theme: "light", volume: 50 };
    const serverObj = new ServerClass(
      ServerClass,
      makeMockSocket(),
      { _id: "cfg-1", config: { ...initialConfig } },
      loggers,
      "SystemConfig",
      manager,
      emitter,
    );
    (serverObj as any).entry = {
      save: jest.fn().mockResolvedValue({}),
      config: { ...initialConfig },
      toObject: () => ({ _id: "cfg-1", config: { ...initialConfig } }),
    };

    await (serverObj as any).setValue("config.theme", "dark");

    // EXPECTED: serverObj.getValue("config.theme") should return "dark" and config.theme is "dark"
    // ON CURRENT CODE: (serverObj.data as any)["config.theme"] is literally set to "dark", leaving config.theme as "light"!
    expect(serverObj.getValue("config.theme")).toBe("dark");
    expect((serverObj.data as any)["config.theme"]).toBeUndefined();
    expect((serverObj.data as any).config.theme).toBe("dark");
  });

  // =========================================================================
  // BUG 8 (MEDIUM): Client setValueQueueInternal crashes on undefined intermediate object
  // =========================================================================
  test("BUG 8 [MEDIUM]: Client setValue must safely initialize intermediate nested objects when undefined", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") cb({ success: true, message: "Saved" });
      }),
    });
    const ClientClass = createClientMockClass(["_id", "metadata"]);

    const clientObj = new ClientClass(
      ClientClass,
      mockSocket,
      { _id: "meta-1", metadata: undefined },
      loggers,
      "Profile",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    // Setting a nested property where intermediate object metadata is undefined
    const res = await clientObj.setValue("metadata.role" as any, "admin" as any);

    // EXPECTED: Setter succeeds and creates { metadata: { role: "admin" } }
    // ON CURRENT CODE: Throws TypeError: Cannot set properties of undefined (setting 'role') and returns success: false
    expect(res.success).toBe(true);
    expect(clientObj.getValue("metadata.role")).toBe("admin");
  });

  // =========================================================================
  // BUG 9 (LOW): getRawId on array of references returns comma-separated string
  // =========================================================================
  test("BUG 9 [LOW]: getRawId on reference array property must return string array, not a comma-separated string", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const ClientClass = createClientMockClass(["_id", "members"], ["members"]);

    const clientObj = new ClientClass(
      ClientClass,
      makeMockSocket(),
      { _id: "team-1", members: ["user-1", "user-2"] },
      loggers,
      "Team",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const raw = clientObj.getRawId("members");

    // EXPECTED: Array of IDs ["user-1", "user-2"] (or appropriate array structure)
    // ON CURRENT CODE: Line 565 executes String(val) returning "user-1,user-2"
    expect(Array.isArray(raw)).toBe(true);
    expect(raw).toEqual(["user-1", "user-2"]);
  });

  // =========================================================================
  // BUG 10 (CRITICAL): Server collectEntityGraph ignores unhydrated DB relations in Lazy Loading
  // =========================================================================
  test("BUG 10 [CRITICAL]: Server collectEntityGraph must load unhydrated related entities from MongoDB during Lazy Loading", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();

    const AuthorClass = createServerMockClass(["_id", "name", "books"], ["books"]);
    Reflect.defineMetadata("refsTo", "Book", AuthorClass.prototype, "books");

    const BookClass = createServerMockClass(["_id", "title"]);

    const mockBookDoc = {
      _id: "book-1",
      title: "Design Patterns",
      toObject: () => ({ _id: "book-1", title: "Design Patterns" }),
    };

    const bookModel = makeMockModel({
      findById: jest.fn().mockResolvedValue(mockBookDoc),
    });

    const managers: Record<string, any> = {};

    const authorManager = new AutoUpdateServerManager(
      AuthorClass as any,
      "Author",
      makeMockSocket(),
      loggers,
      makeMockModel(),
      managers,
      emitter,
      { lazyLoading: true },
    );

    const bookManager = new AutoUpdateServerManager(
      BookClass as any,
      "Book",
      makeMockSocket(),
      loggers,
      bookModel,
      managers,
      emitter,
      { lazyLoading: true },
    );

    managers["Author"] = authorManager;
    managers["Book"] = bookManager;

    const authorObj = new AuthorClass(
      AuthorClass,
      makeMockSocket(),
      { _id: "author-1", name: "Gamma", books: ["book-1"] },
      loggers,
      "Author",
      authorManager,
      emitter,
    );
    (authorManager as any).objects_["author-1"] = authorObj;

    // Notice: book-1 is NOT pre-loaded in bookManager.objects_ (lazy loading state)
    expect(bookManager.getObject("book-1")).toBeUndefined();

    // Invoking collectEntityGraph with depth 1
    const related = authorManager.collectEntityGraph(authorObj, 1);

    // EXPECTED: related["Book"] should contain the loaded book data from MongoDB
    // ON CURRENT CODE: collectEntityGraph only checks in-memory getObject() synchronously and returns empty
    expect(related["Book"]).toBeDefined();
    expect(related["Book"].length).toBeGreaterThan(0);
    expect(related["Book"][0]._id).toBe("book-1");
  });

  // =========================================================================
  // BUG 11 (MEDIUM): Server extractedData exposes mutable cached object reference
  // =========================================================================
  test("BUG 11 [MEDIUM]: Server extractedData must return an isolated copy and not permit external mutation of internal cache", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const ServerClass = createServerMockClass(["_id", "settings"]);

    const serverObj = new ServerClass(
      ServerClass,
      makeMockSocket(),
      { _id: "srv-99", settings: { theme: "light" } },
      loggers,
      "SettingsHolder",
      { managers: {}, options: {} } as any,
      emitter,
    );

    // First read caches the extracted data
    const d1 = serverObj.extractedData;
    expect((d1 as any).settings?.theme).toBe("light");

    // External caller mutates the returned object
    (d1 as any).settings.theme = "MUTATED";

    // Second read from extractedData
    const d2 = serverObj.extractedData;

    // EXPECTED: Internal cached extractedData should be protected from external mutation (theme remains "light")
    // ON CURRENT CODE: AutoUpdatedServerObject caches and returns the exact same object reference without cloning, corrupting internal state!
    expect((d2 as any).settings?.theme).toBe("light");
  });
});
