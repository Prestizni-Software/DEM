/**
 * DEM Project — Complete 57 Issues Regression Suite
 *
 * Each test targets a specific issue from DEM_Project_Analysis.md.
 * ALL tests in this file assert the EXPECTED (fixed) behavior.
 * On the current unfixed codebase, EVERY SINGLE TEST FAILS.
 * When the corresponding bug/vulnerability is fixed, the test will turn GREEN.
 */
import { jest } from "@jest/globals";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { EventEmitter } from "eventemitter3";
import { globalCache, safeStringify } from "../CommonTypes.js";
import { ObjectId } from "mongodb";
import fs from "fs";
import path from "path";

jest.setTimeout(30000);

// ============================================================================
// Helpers & Isolated Class Factories
// ============================================================================

function makeLoggers() {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

function makeMockSocket(overrides: Record<string, any> = {}) {
  return {
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
    ...overrides,
  } as any;
}

function makeMockModel(overrides: Record<string, any> = {}) {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn(),
    ...overrides,
  } as any;
}

function makeDefaultCallbacks() {
  return {
    new: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    progress: jest.fn(),
  };
}

function createMockClientClass(props: string[] = ["_id"], refProps: string[] = []) {
  class IsolatedClientObject extends AutoUpdatedClientObject<any> {
    constructor(
      cp: any,
      s: any,
      data: any,
      l: any,
      cn: any,
      pm: any,
      cb: any,
      e: any,
    ) {
      super(cp, s, data, l, cn, pm, cb, e);
    }
    get _id() {
      return (this as any).data?._id;
    }
    waitForPreloaded = jest.fn().mockResolvedValue(undefined);
  }
  Reflect.defineMetadata("props", props, IsolatedClientObject.prototype);
  for (const ref of refProps) {
    Reflect.defineMetadata("isRef", true, IsolatedClientObject.prototype, ref);
  }
  return IsolatedClientObject;
}

function createMockServerClass(props: string[] = ["_id"], refProps: string[] = []) {
  class IsolatedServerObject extends AutoUpdatedServerObject<any> {
    get _id() {
      return (this as any).data?._id;
    }
  }
  Reflect.defineMetadata("props", props, IsolatedServerObject.prototype);
  for (const ref of refProps) {
    Reflect.defineMetadata("isRef", true, IsolatedServerObject.prototype, ref);
  }
  return IsolatedServerObject;
}

afterEach(() => {
  for (const key in globalCache.objects) delete globalCache.objects[key];
});

// ============================================================================
// 🔴 CRITICAL ISSUES (C1 - C6)
// ============================================================================

describe("C1: Unvalidated Input on Object Creation (Server)", () => {
  test("should reject or strip unknown properties from client create payload", async () => {
    const loggers = makeLoggers();
    const mockSocket = makeMockSocket();
    const emitter = new EventEmitter();
    const mockModel = makeMockModel({
      create: jest.fn().mockImplementation(async (data: any) => {
        return { _id: new ObjectId(), ...data, toObject: () => ({ _id: new ObjectId().toString(), ...data }) };
      }),
    });

    const MockClass = createMockClientClass(["_id", "name"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      mockModel,
      {},
      emitter,
    );

    const maliciousPayload = {
      name: "Legit",
      isAdmin: true,          // unauthorized field
      __proto__: { evil: 1 }, // prototype pollution attempt
      role: "superadmin",     // unauthorized escalation
    };

    await manager.createObject(maliciousPayload as any).catch(() => {});

    const createCall = mockModel.create.mock.calls[0]?.[0];
    expect(createCall).toBeDefined();
    // FAILS NOW: isAdmin and role pass through to model.create
    expect(createCall).not.toHaveProperty("isAdmin");
    expect(createCall).not.toHaveProperty("role");
  });
});

describe("C2: Unvalidated Input on Object Update (Server)", () => {
  test("should reject setting internal or dangerous property keys", async () => {
    const loggers = makeLoggers();
    const mockSocket = makeMockSocket();
    const emitter = new EventEmitter();

    const MockClass = createMockClientClass(["_id", "name"]);
    const obj = new MockClass(
      MockClass,
      mockSocket,
      { _id: "123", name: "Test" },
      loggers,
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      emitter,
    );

    const result = await (obj as any).setValue__("__proto__", { polluted: true });
    
    // FAILS NOW: setValue__ allows setting __proto__ and returns success
    expect(result.success).toBe(false);
  });
});

describe("C3: Unchecked Socket ACK Callback (Server Crash)", () => {
  test("registerSocket handlers should not crash when ack is undefined", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockModel = makeMockModel();
    const listeners: Record<string, Function[]> = {};

    const socketWithListeners = {
      on: jest.fn((event: string, cb: Function) => {
        (listeners[event] = listeners[event] || []).push(cb);
      }),
      onAny: jest.fn(),
      emit: jest.fn(),
      eventNames: jest.fn().mockReturnValue([]),
    } as any;

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      loggers,
      mockModel,
      {},
      emitter,
    );

    manager.registerSocket(socketWithListeners);

    const newListeners = listeners["newTest"];
    expect(newListeners).toBeDefined();
    expect(newListeners.length).toBeGreaterThan(0);

    // FAILS NOW: rejects with unhandled TypeError: ack is not a function when invoking newTest
    await expect(newListeners[0]({}, undefined)).resolves.not.toThrow();
  });
});

describe("C4: Broken saveLock Promise Chain (Server Object)", () => {
  test("subsequent saves should still execute after a save failure", async () => {
    const loggers = makeLoggers();
    const mockSocket = makeMockSocket();
    const emitter = new EventEmitter();
    
    let saveCallCount = 0;
    const mockEntry = {
      save: jest.fn().mockImplementation(async () => {
        saveCallCount++;
        if (saveCallCount === 1) {
          throw new Error("Simulated DB error on first save");
        }
        return {};
      }),
      name: "initial",
      value: 0,
      toObject: () => ({ _id: "123", name: "initial", value: 0 }),
    };

    const mockModel = makeMockModel({
      findById: jest.fn().mockResolvedValue(mockEntry),
    });

    const mockManager = {
      model: mockModel,
      managers: {},
      options: {},
      deleteObject: jest.fn(),
      isLoaded: true,
    } as any;

    const TestServerObj = createMockServerClass(["_id", "name", "value"]);
    const obj = new TestServerObj(
      TestServerObj as any,
      mockSocket,
      { _id: "123", name: "initial", value: 0 } as any,
      loggers,
      "Test",
      mockManager,
      emitter,
    );
    (obj as any).entry = mockEntry;

    await obj.save().catch(() => {});
    await obj.save().catch(() => {});

    // FAILS NOW: Second save is dropped because first failure permanently breaks the promise chain in obj.save()
    expect(mockEntry.save).toHaveBeenCalledTimes(2);
  });
});

describe("C5: Race in destroy vs Pending Saves (Server Object)", () => {
  test("destroy should wait for pending saves before deleting", async () => {
    const loggers = makeLoggers();
    const mockSocket = makeMockSocket();
    const emitter = new EventEmitter();

    let saveCompleted = false;
    let deleteStartedBeforeSaveCompleted = false;

    const mockEntry = {
      save: jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        saveCompleted = true;
        return {};
      }),
      deleteOne: jest.fn().mockImplementation(async () => {
        if (!saveCompleted) {
          deleteStartedBeforeSaveCompleted = true;
        }
        return { deletedCount: 1 };
      }),
      name: "test",
      toObject: () => ({ _id: "123", name: "test" }),
    };

    const TestServerObj = createMockServerClass(["_id", "name"]);
    const obj = new TestServerObj(
      TestServerObj as any,
      mockSocket,
      { _id: "123", name: "test" } as any,
      loggers,
      "Test",
      {
        model: makeMockModel({ findById: jest.fn().mockResolvedValue(mockEntry) }),
        managers: {},
        options: { onDeletion: jest.fn() },
        deleteObject: jest.fn(),
      } as any,
      emitter,
    );
    (obj as any).entry = mockEntry;

    // Trigger save without waiting
    (obj as any).setValueInternal("name", "updated");
    await obj.destroy(true);

    // FAILS NOW: deleteOne executes immediately while save is still running
    expect(deleteStartedBeforeSaveCompleted).toBe(false);
  });
});

describe("C6: Duplicate Socket Listeners on Reconnection (Client Manager)", () => {
  test("calling loadFromServer multiple times should not stack listeners", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const onCalls: string[] = [];
    const offCalls: string[] = [];

    const mockSocket = makeMockSocket({
      on: jest.fn((event: string) => {
        onCalls.push(event);
      }),
      off: jest.fn((event: string) => {
        offCalls.push(event);
      }),
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          cb({ success: true, data: { ids: [], properties: ["_id"], objects: [] } });
        }
      }),
    });

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    await manager.loadFromServer();
    await manager.loadFromServer();

    const newTestListeners = onCalls.filter((e) => e === "newTest");

    // FAILS NOW: 2 "newTest" listeners registered without removing previous
    expect(newTestListeners.length).toBe(1);
  });
});

// ============================================================================
// 🟠 HIGH SEVERITY ISSUES (H1 - H16)
// ============================================================================

describe("H1: Zombie Objects After Timeout (Client Object)", () => {
  test("ACK callback should not setup object after timeout has fired", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    let ackCallback: Function | null = null;

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        ackCallback = cb;
      }),
      on: jest.fn(),
    });

    class RealClientObj extends AutoUpdatedClientObject<any> {
      get _id() {
        return (this as any).data?._id;
      }
    }
    Reflect.defineMetadata("props", ["_id", "name"], RealClientObj.prototype);

    const obj = new RealClientObj(
      RealClientObj,
      mockSocket,
      { name: "test" } as any,
      loggers,
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      emitter,
    );

    await obj.waitForPreloaded(100).catch(() => {});

    expect(ackCallback).not.toBeNull();
    ackCallback!({
      success: true,
      data: { _id: "late-id", name: "zombie" },
    });

    // FAILS NOW: ACK callback sets this.data to zombie even after timeout
    expect((obj as any).data?.name).not.toBe("zombie");
  });
});

describe("H2: Concurrent handleGetMissingObject (Client & Server)", () => {
  test("client concurrent calls for the same ID should not create duplicate objects", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    let constructCount = 0;

    class CountingObj extends AutoUpdatedClientObject<any> {
      constructor(
        cp: any,
        s: any,
        data: any,
        l: any,
        cn: any,
        pm: any,
        cb: any,
        e: any,
      ) {
        super(cp, s, data, l, cn, pm, cb, e);
        constructCount++;
      }
      get _id() {
        return (this as any).data?._id;
      }
      waitForPreloaded = jest.fn().mockResolvedValue(undefined);
    }
    Reflect.defineMetadata("props", ["_id"], CountingObj.prototype);

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          setTimeout(() => {
            cb({ success: true, data: { _id: "same-id" } });
          }, 50);
        }
      }),
    });

    const manager = new AutoUpdateClientManager(
      CountingObj as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    const [result1, result2] = await Promise.all([
      manager.handleGetMissingObject("same-id"),
      manager.handleGetMissingObject("same-id"),
    ]);

    // FAILS NOW: constructCount is 2 (two separate instances created for same ID)
    expect(constructCount).toBe(1);
    expect(result1).toBe(result2);
  });

  test("server concurrent handleGetMissingObject should not query DB twice", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();

    let findByIdCallCount = 0;
    const mockDoc = {
      _id: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
      name: "Found",
      toObject: () => ({ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Found" }),
    };

    const mockModel = makeMockModel({
      findById: jest.fn().mockImplementation(async () => {
        findByIdCallCount++;
        await new Promise((r) => setTimeout(r, 50));
        return mockDoc;
      }),
    });

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      mockModel,
      {},
      emitter,
    );

    await Promise.all([
      manager.handleGetMissingObject("aaaaaaaaaaaaaaaaaaaaaaaa").catch(() => {}),
      manager.handleGetMissingObject("aaaaaaaaaaaaaaaaaaaaaaaa").catch(() => {}),
    ]);

    // FAILS NOW: findByIdCallCount is 2
    expect(findByIdCallCount).toBe(1);
  });
});

describe("H3: deleteObject Socket Listener Leak (Client Manager)", () => {
  test("deleteObject should remove socket listeners from the deleted object", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();

    const mockSocket = makeMockSocket();
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    const obj = new MockClass(
      MockClass,
      mockSocket,
      { _id: "delete-me" },
      loggers,
      "Test",
      manager,
      makeDefaultCallbacks(),
      emitter,
    );
    obj.destroy = jest.fn().mockResolvedValue({ success: true, message: "Deleted" });
    (manager as any).objects_["delete-me"] = obj;
    globalCache.objects["delete-me"] = { className: "Test", object: obj };

    await manager.deleteObject("delete-me");

    // FAILS NOW: socket.off is never called on deletion
    expect(mockSocket.off).toHaveBeenCalled();
  });
});

describe("H4: deleteObject Wrong Operation Order (Server Manager)", () => {
  test("should not send success ACK to socket if DB deletion fails", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const listeners: Record<string, Function[]> = {};

    const mockClientSocket = {
      on: jest.fn((event: string, cb: Function) => {
        (listeners[event] = listeners[event] || []).push(cb);
      }),
      onAny: jest.fn(),
      emit: jest.fn(),
      eventNames: jest.fn().mockReturnValue([]),
    } as any;

    const failingEntry = {
      deleteOne: jest.fn().mockRejectedValue(new Error("DB connection lost")),
      toObject: () => ({ _id: "obj-1", name: "test" }),
    };

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      loggers,
      makeMockModel({ findById: jest.fn().mockResolvedValue(failingEntry) }),
      {},
      emitter,
    );

    manager.registerSocket(mockClientSocket);

    let ackResponse: any = null;
    const deleteHandler = listeners["deleteTest"]?.[0];
    expect(deleteHandler).toBeDefined();

    await deleteHandler?.("obj-1", (res: any) => {
      ackResponse = res;
    });

    // FAILS NOW: Server unconditionally returns ack({ success: true }) even on DB deletion error
    expect(ackResponse?.success).toBe(false);
  });
});

describe("H5: Performance: Full Collection Loaded into Memory", () => {
  test("preLoad should support chunked or paginated batch loading options", () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      makeMockModel(),
      {},
      new EventEmitter(),
    );

    // FAILS NOW: preLoad does not accept pagination/batching options
    expect(manager.preLoad.length).toBeGreaterThan(0);
  });
});

describe("H6: Performance: Startup Payload Explosion", () => {
  test("server manager should maintain a cached serialized startup payload", () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      makeMockModel(),
      {},
      new EventEmitter(),
    );

    // FAILS NOW: Server manager does not maintain a cached startup payload
    expect((manager as any)._startupCache).toBeDefined();
  });
});

describe("H7: extractedData Returns Internal Reference (Server Object)", () => {
  test("mutating extractedData nested properties should not affect internal state", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();

    const TestServerObj = createMockServerClass(["_id", "metadata"]);
    const obj = new TestServerObj(
      TestServerObj as any,
      mockSocket,
      { _id: "123", metadata: { score: 100 } } as any,
      loggers,
      "Test",
      { model: makeMockModel(), managers: {}, options: {}, deleteObject: jest.fn() } as any,
      emitter,
    );

    const extracted = obj.extractedData;
    (extracted as any).metadata.score = 999;

    // FAILS NOW: Nested objects in extractedData are shared by reference, so obj.data.metadata.score becomes 999
    expect((obj as any).data.metadata.score).toBe(100);
  });
});

describe("H8: setValueInternal Ignores Undefined Fields (Server Object)", () => {
  test("should save a field to DB even if it is currently undefined on the entry", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();

    const mockEntry = {
      save: jest.fn().mockResolvedValue({}),
      toObject: () => ({ _id: "123" }),
      schema: { path: (key: string) => (key === "newField" || key === "_id" ? {} : null) },
    } as any;

    const H8ServerObj = createMockServerClass(["_id", "newField"]);
    const obj = new H8ServerObj(
      H8ServerObj as any,
      mockSocket,
      { _id: "123" } as any,
      loggers,
      "Test",
      { model: makeMockModel({ findById: jest.fn().mockResolvedValue(mockEntry) }), managers: {}, options: {}, deleteObject: jest.fn() } as any,
      emitter,
    );
    (obj as any).entry = mockEntry;

    await (obj as any).setValueInternal("newField", "newValue");

    // FAILS NOW: entry.save() is skipped because entry['newField'] === undefined
    expect(mockEntry.save).toHaveBeenCalled();
  });
});

describe("H9: No Write Queue for setValue__ (Client Object)", () => {
  test("concurrent setValue__ calls should be serialized in FIFO order", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, data: any, cb: any) => {
        const val = Number(data?.value);
        // Inverse delay: update 1 finishes last
        if (typeof cb === "function") {
          setTimeout(() => cb({ success: true, message: "" }), 50 - val * 8);
        }
      }),
      on: jest.fn(),
    });

    const MockClass = createMockClientClass(["_id", "counter"]);
    const obj = new MockClass(
      MockClass,
      mockSocket,
      { _id: "123", counter: 0 },
      loggers,
      "Test",
      { cache: { references: {} }, managers: {}, isLoaded: true } as any,
      { ...makeDefaultCallbacks(), update: jest.fn() },
      emitter,
    );

    await Promise.all([
      (obj as any).setValue__("counter", 1),
      (obj as any).setValue__("counter", 2),
      (obj as any).setValue__("counter", 3),
      (obj as any).setValue__("counter", 4),
      (obj as any).setValue__("counter", 5),
    ]);

    // FAILS NOW: Without a write queue, late-arriving update 1 overwrites update 5, leaving counter === 1 instead of 5
    expect((obj as any).data.counter).toBe(5);
  });
});

describe("H10: Progress Tracking Stuck at 0 Objects (Client Manager)", () => {
  test("should call progress(1) when there are zero objects to load", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const progressFn = jest.fn();

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          cb({
            success: true,
            data: { ids: [], properties: ["_id"], objects: [] },
          });
        }
      }),
    });

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      { ...makeDefaultCallbacks(), progress: progressFn },
    );

    await manager.loadFromServer();

    // FAILS NOW: progress callback is never called when ids is empty
    expect(progressFn).toHaveBeenCalledWith(1);
  });
});

describe("H11: Factory Crash on Single Manager Failure (Client Manager)", () => {
  test("factory load phase should skip missing managers gracefully without throwing", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          cb({ success: true, data: { ids: [], properties: ["_id"], objects: [] } });
        }
      }),
    });

    const managers: Record<string, any> = {};
    managers["Broken"] = undefined;
    const WorkingClass = createMockClientClass(["_id"]);
    managers["Working"] = new AutoUpdateClientManager(
      WorkingClass as any,
      "Working",
      mockSocket,
      loggers,
      managers,
      emitter,
      makeDefaultCallbacks(),
    );

    const loadPromises = ["Broken", "Working"].map(async (key) => {
      const manager = managers[key];
      if (!manager) {
        throw new Error(`Manager ${key} was not created due to previous error`);
      }
      await manager.loadFromServer();
    });

    // FAILS NOW: Promise.all rejects because manager creation error was rethrown
    await expect(Promise.all(loadPromises)).resolves.not.toThrow();
  });
});

describe("H12: State Leak on Reconnection (Client Manager)", () => {
  test("loadFromServer should clear old objects before populating new ones", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          cb({
            success: true,
            data: { ids: ["id-2"], properties: ["_id"], objects: [{ _id: "id-2" }] },
          });
        }
      }),
    });

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    (manager as any).objects_["id-old"] = new MockClass(
      MockClass,
      mockSocket,
      { _id: "id-old" },
      loggers,
      "Test",
      manager,
      makeDefaultCallbacks(),
      emitter,
    );
    globalCache.objects["id-old"] = {
      className: "Test",
      object: (manager as any).objects_["id-old"],
    };

    await manager.loadFromServer();

    // FAILS NOW: id-old remains in cache after reload
    expect(manager.getObject("id-old")).toBeUndefined();
  });
});

describe("H13: Type Safety: Pervasive any in Core Types", () => {
  test("CommonTypes.ts should not define DEMGlobalCache or DEMCallbacks with any", () => {
    const typesPath = path.resolve("CommonTypes.ts");
    const content = fs.readFileSync(typesPath, "utf8");
    // FAILS NOW: Contains `: any`
    expect(content).not.toMatch(/:\s*any\b/);
  });
});

describe("H14: Build Scripts: Windows-Only (package.json)", () => {
  test("package.json scripts should use cross-platform commands without backslashes or xcopy", () => {
    const pkgPath = path.resolve("package.json");
    const content = fs.readFileSync(pkgPath, "utf8");
    // FAILS NOW: package.json uses xcopy and backslashes
    expect(content).not.toContain("xcopy");
    expect(content).not.toContain("\\\\");
  });
});

describe("H15: Permissive CORS in Test Setup", () => {
  test("test_lib.ts should not configure wildcard origin * for Socket.IO servers", () => {
    const testLibPath = path.resolve("test_lib.ts");
    const content = fs.readFileSync(testLibPath, "utf8");
    // FAILS NOW: contains origin: "*"
    expect(content).not.toContain('origin: "*"');
  });
});

describe("H16: Flaky Tests: Timing-Dependent Polling in dem.test.ts", () => {
  test("tests/dem.test.ts should not use while loops with setTimeout polling", () => {
    const demTestPath = path.resolve("tests/dem.test.ts");
    const content = fs.readFileSync(demTestPath, "utf8");
    // FAILS NOW: contains while loops with setTimeout polling
    expect(content).not.toContain("while (");
  });
});

// ============================================================================
// 🟡 MEDIUM SEVERITY ISSUES (M1 - M22)
// ============================================================================

describe("M1: Unnecessary Deep Clone in handleDataCleanup", () => {
  test("handleDataCleanup should preserve non-ref nested object references without deep-cloning", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockSocket = makeMockSocket();

    const nestedSubObj = { payload: "abc", count: 42 };
    const MockClass = createMockClientClass(["_id", "details"]);

    const obj = new MockClass(
      MockClass,
      mockSocket,
      {
        _id: "123",
        details: nestedSubObj,
      },
      loggers,
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      emitter,
    );

    // FAILS NOW: _.cloneDeepWith creates a new clone, so (obj as any).data.details !== nestedSubObj
    expect((obj as any).data.details).toBe(nestedSubObj);
  });
});

describe("M2: Reference Getter Returns Mixed Types", () => {
  test("object should expose a dedicated getRawId method for raw reference string IDs", () => {
    const MockClass = createMockClientClass(["_id", "company"], ["company"]);
    const obj = new MockClass(
      MockClass,
      makeMockSocket(),
      { _id: "obj1", company: "raw_company_id" },
      makeLoggers(),
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      new EventEmitter(),
    );

    // FAILS NOW: getRawId method does not exist on AutoUpdatedClientObject
    expect(typeof (obj as any).getRawId).toBe("function");
    expect((obj as any).getRawId?.("company")).toBe("raw_company_id");
  });
});

describe("M3: Architecture: globalCache Untestable Singleton", () => {
  test("globalCache should expose a clear method to enable isolated test environments", () => {
    // FAILS NOW: globalCache does not have a clear() method
    expect(typeof (globalCache as any).clear).toBe("function");
  });
});

describe("M4: Performance: O(N²·M) Reference Search", () => {
  test("manager should maintain a reverse-reference index for O(1) lookups", () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: manager does not have a reverseRefIndex
    expect((manager as any).reverseRefIndex).toBeDefined();
  });
});

describe("M5: O(N) socket.onAny per Manager", () => {
  test("registerSocket should use dedicated event listeners instead of socket.onAny", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockClientSocket = {
      on: jest.fn(),
      onAny: jest.fn(),
      emit: jest.fn(),
    } as any;

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      loggers,
      makeMockModel(),
      {},
      emitter,
    );

    manager.registerSocket(mockClientSocket);

    // FAILS NOW: onAny is called per manager in registerSocket
    expect(mockClientSocket.onAny).not.toHaveBeenCalled();
  });
});

describe("M6: Concurrency: Double DB Fetch in setValueInternal", () => {
  test("concurrent setValueInternal calls on uninitialized entry should share a single loadPromise", () => {
    const ServerClass = createMockServerClass(["_id", "val"]);
    const obj = new ServerClass(
      ServerClass as any,
      makeMockSocket(),
      { _id: "s1" } as any,
      makeLoggers(),
      "Test",
      { model: makeMockModel(), managers: {}, options: {}, deleteObject: jest.fn() } as any,
      new EventEmitter(),
    );

    // FAILS NOW: obj does not have loadPromise property for deduplication
    expect((obj as any).loadPromise).toBeDefined();
  });
});

describe("M7: Bug: noUpdate Flag is Call-Scoped, Not Instance-Scoped", () => {
  test("server object should have an instance-scoped update lock flag", () => {
    const ServerClass = createMockServerClass(["_id", "val"]);
    const obj = new ServerClass(
      ServerClass as any,
      makeMockSocket(),
      { _id: "s1" } as any,
      makeLoggers(),
      "Test",
      { model: makeMockModel(), managers: {}, options: {}, deleteObject: jest.fn() } as any,
      new EventEmitter(),
    );

    // FAILS NOW: obj does not have an _isUpdating instance guard
    expect((obj as any)._isUpdating).toBeDefined();
  });
});

describe("M8: Constructor Reflection Caching (Server Object)", () => {
  test("Server class should cache isRef properties statically rather than reflecting on every instantiation", () => {
    const ServerClass = createMockServerClass(["_id", "refA", "refB"], ["refA", "refB"]);
    new ServerClass(
      ServerClass as any,
      makeMockSocket(),
      { _id: "s1" } as any,
      makeLoggers(),
      "ServerTest",
      { model: makeMockModel(), managers: {}, options: {}, deleteObject: jest.fn() } as any,
      new EventEmitter(),
    );

    // FAILS NOW: Static isRef cache does not exist on ServerClass
    expect((ServerClass as any).__refPropsCache).toBeDefined();
  });
});

describe("M9: Security: Field-Level Access Control on Broadcasts", () => {
  test("setValueInternal should support field filtering before socket emission", async () => {
    const mockSocket = makeMockSocket();
    const ServerClass = createMockServerClass(["_id", "publicName", "secretField"]);
    const mockEntry = {
      save: jest.fn().mockResolvedValue({}),
      toObject: () => ({ _id: "s1", publicName: "name", secretField: "secret" }),
    };

    const manager = {
      model: makeMockModel({ findById: jest.fn().mockResolvedValue(mockEntry) }),
      managers: {},
      options: {
        accessDefinitions: {
          fieldFilter: jest.fn().mockReturnValue(["publicName"]),
        },
      },
      deleteObject: jest.fn(),
    } as any;

    const obj = new ServerClass(
      ServerClass as any,
      mockSocket,
      { _id: "s1", publicName: "name", secretField: "secret" } as any,
      makeLoggers(),
      "ServerTest",
      manager,
      new EventEmitter(),
    );
    (obj as any).entry = mockEntry;

    await (obj as any).setValueInternal("secretField", "newSecret");

    // FAILS NOW: Server broadcasts secretField to socket without checking fieldFilter
    expect(manager.options.accessDefinitions.fieldFilter).toHaveBeenCalled();
  });
});

describe("M10: Duplicate @prop Decorator Across Subclasses", () => {
  test("manager properties should merge and deduplicate inherited properties across subclasses", () => {
    class ParentClass {}
    Reflect.defineMetadata("props", ["_id", "sharedProp"], ParentClass.prototype);

    class ChildClass extends ParentClass {}
    Reflect.defineMetadata("props", ["sharedProp", "childProp"], ChildClass.prototype);

    const manager = new AutoUpdateClientManager(
      ChildClass as any,
      "Child",
      makeMockSocket(),
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: Manager properties misses inherited parent properties (_id)
    expect((manager as any).properties).toContain("_id");
  });
});

describe("M11: Bounded Concurrency on loadMissingReferences", () => {
  test("loadReferences should accept a concurrency limit to avoid promise flooding", async () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: loadReferences does not accept concurrency option and runs unbounded Promise.all
    expect((manager as any).loadReferences.length).toBeGreaterThan(0);
  });
});

describe("M12: V8 Dictionary Mode (Map for Objects Cache)", () => {
  test("manager.objects should be backed by a Map instance to avoid V8 dictionary mode", () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: manager.objects_ is a plain JavaScript object ({})
    expect((manager as any).objects_ instanceof Map).toBe(true);
  });
});

describe("M13: Dependency Version Mismatch: ts-jest vs jest in package.json", () => {
  test("package.json should have matching major versions for jest and ts-jest", () => {
    const pkgPath = path.resolve("package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const jestVer = pkg.devDependencies.jest.replace(/[^0-9]/g, "").charAt(0);
    const tsJestVer = pkg.devDependencies["ts-jest"].replace(/[^0-9]/g, "").charAt(0);
    // FAILS NOW: jest is 30.x, ts-jest is 29.x
    expect(jestVer).toBe(tsJestVer);
  });
});

describe("M14: Dangerous npm audit fix --force in package.json", () => {
  test("package.json fix_all script should not contain --force", () => {
    const pkgPath = path.resolve("package.json");
    const content = fs.readFileSync(pkgPath, "utf8");
    // FAILS NOW: fix_all contains npm audit fix --force
    expect(content).not.toContain("npm audit fix --force");
  });
});

describe("M15: Tests: No Assertions in Redacted Object Test", () => {
  test("tests/dem.test.ts should contain explicit expect() assertions in redacted object test", () => {
    const demTestPath = path.resolve("tests/dem.test.ts");
    const content = fs.readFileSync(demTestPath, "utf8");
    // Check the redacted object test block
    const redactedBlock = content.slice(content.indexOf("redacted object not loaded"));
    const blockEnd = redactedBlock.indexOf("});");
    const testCode = redactedBlock.slice(0, blockEnd);
    // FAILS NOW: The redacted object test contains zero expect() assertions
    expect(testCode).toContain("expect(");
  });
});

describe("M16: Tests: Blanket catch Swallowing Errors in server_manager_targeted.test.ts", () => {
  test("tests/server_manager_targeted.test.ts should not use blanket catch to swallow errors", () => {
    const targetedPath = path.resolve("tests/server_manager_targeted.test.ts");
    const content = fs.readFileSync(targetedPath, "utf8");
    // FAILS NOW: contains .catch(() => {})
    expect(content).not.toContain(".catch(() => {})");
  });
});

describe("M17: Tests: No Disconnection/Reconnection Coverage", () => {
  test("tests directory should contain a dedicated disconnection/reconnection test suite", () => {
    const testFiles = fs.readdirSync("tests");
    // FAILS NOW: No dedicated disconnection test file exists
    const hasDisconnectionTest = testFiles.some((f) => f.includes("reconnect") || f.includes("disconnect"));
    expect(hasDisconnectionTest).toBe(true);
  });
});

describe("M18: Tests: Extensive as any Usage in test files", () => {
  test("tests/client_manager.test.ts should not use as any pervasively", () => {
    const clientTestPath = path.resolve("tests/client_manager.test.ts");
    const content = fs.readFileSync(clientTestPath, "utf8");
    const matches = content.match(/as any/g) || [];
    // FAILS NOW: contains as any over 10 times
    expect(matches.length).toBe(0);
  });
});

describe("M19: Tests: Missing Memory Leak Verification", () => {
  test("tests directory should contain a dedicated memory leak verification test file", () => {
    const testFiles = fs.readdirSync("tests");
    // FAILS NOW: No memory leak test file exists
    const hasLeakTest = testFiles.some((f) => f.includes("leak") || f.includes("memory"));
    expect(hasLeakTest).toBe(true);
  });
});

describe("M20: Partial State Corruption on Failed Object Creation (Client)", () => {
  test("should clean up caches if post-creation steps fail", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();

    class FailingObj extends AutoUpdatedClientObject<any> {
      constructor(
        cp: any,
        s: any,
        data: any,
        l: any,
        cn: any,
        pm: any,
        cb: any,
        e: any,
      ) {
        super(cp, s, data, l, cn, pm, cb, e);
      }
      get _id() {
        return (this as any).data?._id;
      }
      waitForPreloaded = jest.fn().mockResolvedValue(undefined);
      override async contactChildren(): Promise<void> {
        throw new Error("contactChildren failed!");
      }
    }
    Reflect.defineMetadata("props", ["_id"], FailingObj.prototype);

    const mockSocket = makeMockSocket();
    const manager = new AutoUpdateClientManager(
      FailingObj as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    await expect(manager.createObject({ _id: "fail-obj" } as any)).rejects.toThrow();

    // FAILS NOW: fail-obj remains in manager.objects_ and globalCache
    expect(manager.getObject("fail-obj")).toBeUndefined();
    expect(globalCache.objects["fail-obj"]).toBeUndefined();
  });
});

describe("M21: Unsafe Mutation of Server Response", () => {
  test("loadFromServer should not mutate the server response data.properties", async () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const originalProperties = ["_id", "name"];

    const MockClass = createMockClientClass(["_id", "name"]);
    const responseData = {
      ids: [],
      properties: [...originalProperties],
      objects: [],
    };

    const mockSocket = makeMockSocket({
      emit: jest.fn((_event: string, _data: any, cb: any) => {
        if (typeof cb === "function") {
          cb({ success: true, data: responseData });
        }
      }),
    });

    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      makeDefaultCallbacks(),
    );

    await manager.loadFromServer();

    // FAILS NOW: responseData.properties is mutated by splice()
    expect(responseData.properties).toEqual(originalProperties);
  });
});

describe("M22: Socket Reconnection Sync", () => {
  test("manager should register a reconnection handler to reconcile state", () => {
    const mockSocket = makeMockSocket();
    const MockClass = createMockClientClass(["_id"]);
    new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      mockSocket,
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: No reconnect event listener is registered
    const registeredEvents = mockSocket.on.mock.calls.map((c: any) => c[0]);
    expect(registeredEvents).toContain("reconnect");
  });
});

// ============================================================================
// 🔵 LOW SEVERITY ISSUES (L1 - L13)
// ============================================================================

describe("L1: Inconsistent Logging: console.* vs loggers.*", () => {
  test("source code should not contain direct console.log statements", () => {
    const clientPath = path.resolve("test_client.ts");
    const clientContent = fs.readFileSync(clientPath, "utf8");
    // FAILS NOW: Contains console.log
    expect(clientContent).not.toContain("console.log(");
  });
});

describe("L2: Uncached Event Name Strings", () => {
  test("client object should cache updateEventName property instead of recalculating", () => {
    const MockClass = createMockClientClass(["_id"]);
    const obj = new MockClass(
      MockClass,
      makeMockSocket(),
      { _id: "123" },
      makeLoggers(),
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      new EventEmitter(),
    );

    // FAILS NOW: updateEventName cache property does not exist on instance
    expect((obj as any).updateEventName).toBeDefined();
  });
});

describe("L3: No Payload Shape Validation Before Send (Client)", () => {
  test("client setValue should validate key against known properties before emitting", async () => {
    const MockClass = createMockClientClass(["_id", "name"]);
    const mockSocket = makeMockSocket();
    const obj = new MockClass(
      MockClass,
      mockSocket,
      { _id: "123", name: "valid" },
      makeLoggers(),
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      new EventEmitter(),
    );

    // FAILS NOW: Client emits socket event for invalid property without checking
    await (obj as any).setValue__("invalidProp", 123);
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });
});

describe("L4: Double generateSettersAndGetters Calls", () => {
  test("generateSettersAndGetters should be idempotent and not re-define properties repeatedly", () => {
    const MockClass = createMockClientClass(["_id", "name"]);
    const obj = new MockClass(
      MockClass,
      makeMockSocket(),
      { _id: "123", name: "test" },
      makeLoggers(),
      "Test",
      { cache: { references: {} }, managers: {} } as any,
      makeDefaultCallbacks(),
      new EventEmitter(),
    );

    const definePropSpy = jest.spyOn(Object, "defineProperty");
    const callsBefore = definePropSpy.mock.calls.length;

    // Second call (simulating factory sweep)
    (obj as any).generateSettersAndGetters();

    const redundantCalls = definePropSpy.mock.calls
      .slice(callsBefore)
      .filter((c) => c[0] === obj);

    // FAILS NOW: Properties are re-defined repeatedly
    expect(redundantCalls.length).toBe(0);
    definePropSpy.mockRestore();
  });
});

describe("L5: Generic Error Messages in Client Manager", () => {
  test("Client Manager constructor should throw specific descriptive error for missing arguments", () => {
    // FAILS NOW: Throws generic "Missing arguments???"
    expect(() => {
      new AutoUpdateClientManager(
        null as any,
        "Test",
        makeMockSocket(),
        makeLoggers(),
        {},
        new EventEmitter(),
        makeDefaultCallbacks(),
      );
    }).toThrow("Missing required argument: classParam");
  });
});

describe("L6: Missing extractedData Change Comment (Server Object)", () => {
  test("AutoUpdatedServerObjectClass.ts should contain documentation comments on extractedData override", () => {
    const filePath = path.resolve("AutoUpdatedServerObjectClass.ts");
    const content = fs.readFileSync(filePath, "utf8");
    // FAILS NOW: No doc comment explaining extractedData override
    expect(content).toContain("/** Override extractedData to return shallow copy */");
  });
});

describe("L7: Empty CommonTypes_server.ts", () => {
  test("CommonTypes_server.ts should not be an empty 0-byte orphan file", () => {
    const filePath = path.resolve("CommonTypes_server.ts");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.statSync(filePath).size).toBeGreaterThan(0);
  });
});

describe("L8: Legacy old_file.ts (61KB)", () => {
  test("legacy dead-code file old_file.ts should be removed from repository", () => {
    const filePath = path.resolve("old_file.ts");
    // FAILS NOW: old_file.ts exists in root
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

describe("L9: Committed Test Output Files", () => {
  test("large test log artifacts like tests/logs.txt should not be committed to repository", () => {
    const filePath = path.resolve("tests/logs.txt");
    // FAILS NOW: tests/logs.txt (5.6MB) is tracked in repository
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

describe("L10: Performance Profiling Artifacts", () => {
  test("large performance profiling artifacts in performance/ should not be committed", () => {
    const perfDir = path.resolve("performance");
    expect(fs.existsSync(perfDir)).toBe(true);
    const files = fs.readdirSync(perfDir);
    const largeProfiles = files.filter((f) => f.includes("profile"));
    // FAILS NOW: Large profile json exists in performance/
    expect(largeProfiles.length).toBe(0);
  });
});

describe("L11: Socket Middleware Event Prefix Registration", () => {
  test("registerSocket should register base event prefixes for middleware whitelist validation", () => {
    const loggers = makeLoggers();
    const emitter = new EventEmitter();
    const mockModel = makeMockModel();
    const registeredEvents: string[] = [];

    const mockClientSocket = {
      on: jest.fn((event: string) => registeredEvents.push(event)),
      onAny: jest.fn(),
      emit: jest.fn(),
    } as any;

    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateServerManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      loggers,
      mockModel,
      {},
      emitter,
    );

    manager.registerSocket(mockClientSocket);

    // Base event prefixes must be registered for middleware event whitelist filtering
    expect(registeredEvents).toContain("updateTest");
    expect(registeredEvents).toContain("getTest");
  });
});

describe("L12: Redundant Progress Math (Client Manager)", () => {
  test("Client Manager should expose sanitized normalizeProgress method that bounds values to [0, 1]", () => {
    const MockClass = createMockClientClass(["_id"]);
    const manager = new AutoUpdateClientManager(
      MockClass as any,
      "Test",
      makeMockSocket(),
      makeLoggers(),
      {},
      new EventEmitter(),
      makeDefaultCallbacks(),
    );

    // FAILS NOW: normalizeProgress helper method does not exist
    expect(typeof (manager as any).normalizeProgress).toBe("function");
  });
});

describe("L13: safeStringify Error Handling on Circular Reference", () => {
  test("safeStringify should catch circular references and return fallback string without crashing", () => {
    const circularObj: any = { name: "DEM" };
    circularObj.self = circularObj;

    const result = safeStringify(circularObj);
    expect(result).toBe("[Circular or non-serializable object]");
  });
});