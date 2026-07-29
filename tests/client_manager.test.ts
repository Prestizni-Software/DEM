import { jest } from '@jest/globals';
import { AUCManagerFactory, AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { EventEmitter } from "eventemitter3";
import { globalCache } from "../CommonTypes.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { Test } from "../ClientTypes.js"
describe("AutoUpdateClientManagerClass Full Coverage", () => {
  let loggers: any;
  let emitter: any;
  let mockSocket: any;
  let MockClass: any;
  let callbacks: any;
  let managersToClose: any[] = [];

  beforeEach(() => {
    managersToClose = [];
    loggers = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    emitter = new EventEmitter();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn()
    };
    callbacks = {
        new: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
    };
    MockClass = class extends AutoUpdatedClientObject<any> {
      constructor(cp: any, s: any, data: any, l: any, cn: any, pm: any, cb: any, e: any) {
          super(cp, s, data, l, cn, pm, cb, e);
      }
      get _id() { return (this as any).data?._id; }
      waitForPreloaded = jest.fn().mockResolvedValue(undefined);
    };
    Reflect.defineMetadata("props", ["_id"], MockClass.prototype);
  });

  afterEach(async () => {
    for (const m of managersToClose) {
        if (typeof m.close === 'function') await m.close();
    }
    for (const key in globalCache.objects) delete globalCache.objects[key];
  });

  test("AUCManagerFactory success", async () => {
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
      if (event === "startupTest") {
        cb({ success: true, data: { ids: ["1"], properties: [] } });
      } else if (event === "getBatchTest") {
        cb({ success: true, data: [{ _id: "1" }] });
      }
    });

    const managers = await AUCManagerFactory(
      { Test: MockClass as any },
      loggers,
      mockSocket,
      false,
      emitter
    );
    Object.values(managers).forEach(m => managersToClose.push(m));

    expect(managers.Test).toBeDefined();
  });

  test("AUCManagerFactory with disableDEMDebugMessages", async () => {
    const managers = await AUCManagerFactory({}, loggers, mockSocket, true);
    Object.values(managers).forEach(m => managersToClose.push(m));
  });

  test("AUCManagerFactory load error", async () => {
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "startupTest") {
          cb({ success: false, message: "Load error" });
        }
      });
  
      const managers = await AUCManagerFactory(
        { Test: MockClass as any },
        loggers,
        mockSocket
      );
      Object.values(managers).forEach(m => managersToClose.push(m));
      expect(loggers.error).toHaveBeenCalled();
  });

  test("AutoUpdateClientManager socket listeners", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    (manager as any).startSocketListeners();
    
    expect(mockSocket.on).toHaveBeenCalledWith("newTest", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("deleteTest", expect.any(Function));

    // Trigger newTest
    const newCallback = mockSocket.on.mock.calls.find(c => c[0] === "newTest")[1];
    await newCallback("123");
    expect(manager.getObject("123")).toBeDefined();

    // Trigger deleteTest
    const deleteCallback = mockSocket.on.mock.calls.find(c => c[0] === "deleteTest")[1];
    const mockObj = manager.getObject("123");
    mockObj.destroy = jest.fn().mockResolvedValue({ success: true });
    await deleteCallback("123");
    expect(manager.getObject("123")).toBeUndefined();
  });

  test("loadFromServer property mismatch", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);

    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "startupTest") {
            cb({ success: true, data: { ids: [], properties: ["extra"] } });
        }
    });

    await expect(manager.loadFromServer()).rejects.toThrow();
    expect(loggers.error).toHaveBeenCalled();
  });

  test("handleGetMissingObject success", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "getTest123") {
            cb({ success: true, data: { _id: "123" } });
        }
    });

    const obj = await manager.handleGetMissingObject("123");
    expect(obj).toBeDefined();
    expect(obj._id).toBe("123");
  });

  test("handleGetMissingObject failure", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "getTest999") {
            cb({ success: false, message: "Error" });
        }
    });

    await expect(manager.handleGetMissingObject("999")).rejects.toThrow();
  });

  test("createObject success", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    
    const obj = await manager.createObject({ _id: "123" } as any);
    expect(obj).toBeDefined();
    expect(manager.getObject("123")).toBe(obj);
  });

  test("createObject failure", async () => {
    let failedObj: any;
    const BadClass = class extends MockClass {
        constructor(cp: any, s: any, data: any, l: any, cn: any, pm: any, cb: any, e: any) {
            super(cp, s, data, l, cn, pm, cb, e);
            failedObj = this;
            throw new Error("Fail");
        }
    };
    const badManager = new AutoUpdateClientManager(
        BadClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(badManager);

    await expect(badManager.createObject({} as any)).rejects.toThrow();
    if (failedObj) failedObj.destroyImmediate();
    expect(loggers.error).toHaveBeenCalled();
  });

  test("Getters", () => {
    const manager = new AutoUpdateClientManager(
        MockClass as any, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    const obj = new MockClass(MockClass, mockSocket, "1", loggers, "Test", manager, callbacks, emitter);
    (manager as any).objects_["1"] = obj;
    
    expect(manager.getObject("1")).toBe(obj);
    expect(manager.getObject(undefined)).toBeNull();
    expect(manager.objects["1"]).toBe(obj);
    expect(manager.objectsAsArray).toContain(obj);
  });

  test("waitForPreloaded timeout", async () => {
    const noRespSocket = { emit: () => {}, on: () => {}, off: () => {}, disconnect: () => {} } as any;
    const RealClass = class extends AutoUpdatedClientObject<any> {
      get _id() { return (this as any).data?._id; }
    };
    Reflect.defineMetadata("props", ["_id"], RealClass.prototype);
    const obj = new RealClass(RealClass, noRespSocket, {} as any, loggers, "Test", {} as any, callbacks, emitter);
    await expect(obj.waitForPreloaded(50)).rejects.toThrow("Timeout waiting for object preloading");
  });

  test("createObject socket error failure", async () => {
    const errorSocket = {
      emit: (_evt: string, _data: any, cb: any) => cb?.({ success: false, message: "Socket failure" }),
      on: () => {},
      off: () => {},
      disconnect: () => {}
    } as any;
    const RealClass = class extends AutoUpdatedClientObject<any> {
      get _id() { return (this as any).data?._id; }
    };
    Reflect.defineMetadata("props", ["_id"], RealClass.prototype);
    const badManager = new AutoUpdateClientManager(
      RealClass as any, "Test", errorSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(badManager);
    await expect(badManager.createObject({} as any)).rejects.toThrow("Socket failure");
  });
});
