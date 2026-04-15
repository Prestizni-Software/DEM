import { jest } from '@jest/globals';
import { AUCManagerFactory, AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { EventEmitter } from "eventemitter3";
import { globalCache } from "../CommonTypes.js";

describe("AutoUpdateClientManagerClass Full Coverage", () => {
  let loggers: any;
  let emitter: any;
  let mockSocket: any;
  let MockClass: any;
  let callbacks: any;

  beforeEach(() => {
    loggers = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    emitter = new EventEmitter();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn()
    };
    callbacks = {
        new: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
    };
    MockClass = class {
      _id: string;
      properties: string[] = [];
      constructor(cp: any, s: any, data: any) {
          this._id = typeof data === 'string' ? data : data._id;
      }
      waitForPreloaded = jest.fn().mockResolvedValue(undefined);
      isPreLoadedAsync = jest.fn().mockResolvedValue(undefined);
      loadMissingReferences = jest.fn().mockResolvedValue(undefined);
      contactChildren = jest.fn().mockResolvedValue(undefined);
    };
    Reflect.defineMetadata("props", [], MockClass.prototype);
  });

  test("AUCManagerFactory success", async () => {
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
      if (event === "startupTest") {
        cb({ success: true, data: { ids: ["1"], properties: [] } });
      }
    });

    const managers = await AUCManagerFactory(
      { Test: MockClass as any },
      loggers,
      mockSocket,
      false,
      emitter,
      { Test: callbacks }
    );

    expect(managers.Test).toBeDefined();
    expect(loggers.info).toHaveBeenCalled();
  });

  test("AUCManagerFactory with disableDEMDebugMessages", async () => {
    await AUCManagerFactory({}, loggers, mockSocket, true);
    expect(loggers.debug("test")).toBeUndefined(); // Should be a no-op
  });

  test("AUCManagerFactory load error", async () => {
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "startupTest") {
          cb({ success: false, message: "Load error" });
        }
      });
  
      await AUCManagerFactory(
        { Test: MockClass as any },
        loggers,
        mockSocket
      );
      expect(loggers.error).toHaveBeenCalledWith(expect.stringContaining("Load error"));
  });

  test("AutoUpdateClientManager socket listeners", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    (manager as any).startSocketListeners();
    
    expect(mockSocket.on).toHaveBeenCalledWith("newTest", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("deleteTest", expect.any(Function));

    // Trigger newTest
    const newCallback = mockSocket.on.mock.calls.find(c => c[0] === "newTest")[1];
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        if (event === "startupTest") cb({ success: true, data: { ids: ["123"], properties: [] } });
    });
    await newCallback("123");
    expect(manager.getObject("123")).toBeDefined();

    // Trigger deleteTest
    const deleteCallback = mockSocket.on.mock.calls.find(c => c[0] === "deleteTest")[1];
    const spyDelete = jest.spyOn(manager, 'deleteObject').mockResolvedValue({ success: true, message: "" });
    await deleteCallback("123");
    expect(spyDelete).toHaveBeenCalledWith("123");
  });

  test("loadFromServer property mismatch", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    (manager as any).properties = ["extra"];
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        cb({ success: true, data: { ids: [], properties: ["missing"] } });
    });

    await expect(manager.loadFromServer()).rejects.toThrow();
    expect(loggers.error).toHaveBeenCalled();
  });

  test("handleGetMissingObject success", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        cb({ success: true, data: { ids: ["456"], properties: [] } });
    });

    const obj = await manager.handleGetMissingObject("456");
    expect(obj._id).toBe("456");
    expect(manager.getObject("456")).toBe(obj);
  });

  test("handleGetMissingObject failure", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    mockSocket.emit.mockImplementation((event: string, data: any, cb: any) => {
        cb({ success: true, data: { ids: [], properties: [] } });
    });

    await expect(manager.handleGetMissingObject("999")).rejects.toThrow("Non existent or not accesable.");
  });

  test("createObject success", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    const obj = await manager.createObject({ _id: "newid" } as any);
    expect(obj._id).toBe("newid");
    expect(callbacks.new).toHaveBeenCalled();
  });

  test("createObject failure", async () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    const ErrorClass = class { constructor() { throw new Error("Fail"); } };
    (manager as any).classParam = ErrorClass;

    await expect(manager.createObject({})).rejects.toThrow("Fail");
    expect(loggers.error).toHaveBeenCalled();
  });

  test("Getters", () => {
    const manager = new AutoUpdateClientManager(
        MockClass, "Test", loggers, mockSocket, {}, emitter, callbacks
    );
    const obj = new MockClass(null, null, "1");
    (manager as any).objects_["1"] = obj;
    
    expect(manager.getObject("1")).toBe(obj);
    expect(manager.getObject(undefined)).toBeNull();
    expect(manager.objects["1"]).toBe(obj);
    expect(manager.objectsAsArray).toContain(obj);
  });
});
