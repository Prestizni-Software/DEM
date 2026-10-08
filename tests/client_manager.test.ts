import { jest } from '@jest/globals';
import { AUCManagerFactory, AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { EventEmitter } from "eventemitter3";
import { globalCache, LoggersType, MongoId, ServerResponse, IAutoUpdateManager, DEMClientCallbacks } from "../CommonTypes.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { Socket } from "socket.io-client";

interface MockClientData {
  _id: MongoId;
  name?: string;
}

class TestClientObject extends AutoUpdatedClientObject<MockClientData> {
  public name?: string;
  get _id(): MongoId {
    return (this.data as MockClientData)?._id;
  }
  public override waitForPreloaded = jest.fn().mockImplementation(async () => {});
}
Reflect.defineMetadata("props", ["_id", "name"], TestClientObject.prototype);

describe("AutoUpdateClientManagerClass Full Coverage", () => {
  let loggers: LoggersType;
  let emitter: EventEmitter;
  let mockSocket: Socket;
  let callbacks: DEMClientCallbacks<any>;
  let managersToClose: AutoUpdateClientManager<any>[] = [];

  beforeEach(() => {
    managersToClose = [];
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    emitter = new EventEmitter();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
    callbacks = {
      new: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      progress: jest.fn(),
    };
  });

  afterEach(async () => {
    for (const m of managersToClose) {
      if (typeof m.close === 'function') await m.close();
    }
    for (const key in globalCache.objects) delete globalCache.objects[key];
  });

  test("AUCManagerFactory success", async () => {
    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "startupTest") {
        cb({ success: true, data: { ids: ["1"], properties: ["name"] }, message: "" });
      }
    });

    const managers = await AUCManagerFactory(
      { Test: TestClientObject },
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
    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "startupTest") {
        cb({ success: false, message: "Load error", data: undefined });
      }
    });

    const managers = await AUCManagerFactory(
      { Test: TestClientObject },
      loggers,
      mockSocket
    );
    Object.values(managers).forEach(m => managersToClose.push(m));
    expect(loggers.error).toHaveBeenCalled();
  });

  test("AutoUpdateClientManager socket listeners", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    (manager as unknown as { startSocketListeners: () => void }).startSocketListeners();

    expect(mockSocket.on).toHaveBeenCalledWith("newTest", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("deleteTest", expect.any(Function));

    const newCallback = (mockSocket.on as unknown as jest.Mock).mock.calls.find((c: unknown[]) => c[0] === "newTest")?.[1] as (id: string) => Promise<void>;
    if (newCallback) {
      await newCallback("123");
      expect(manager.getObject("123")).toBeDefined();
    }

    const deleteCallback = (mockSocket.on as unknown as jest.Mock).mock.calls.find((c: unknown[]) => c[0] === "deleteTest")?.[1] as (id: string) => Promise<void>;
    if (deleteCallback) {
      const mockObj = manager.getObject("123");
      if (mockObj) {
        mockObj.destroy = jest.fn().mockResolvedValue({ success: true, message: "" }) as unknown as typeof mockObj.destroy;
        await deleteCallback("123");
        expect(manager.getObject("123")).toBeUndefined();
      }
    }
  });

  test("loadFromServer property mismatch", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);

    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "startupTest") {
        cb({ success: true, data: { ids: [], properties: ["extra"] }, message: "" });
      }
    });

    await expect(manager.loadFromServer()).rejects.toThrow();
    expect(loggers.error).toHaveBeenCalled();
  });

  test("handleGetMissingObject success", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);

    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "getTest123") {
        cb({ success: true, data: { _id: "123", name: "test" }, message: "" });
      }
    });

    const obj = await manager.handleGetMissingObject("123");
    expect(obj).toBeDefined();
    expect(obj._id).toBe("123");
  });

  test("handleGetMissingObject failure", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);

    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "getTest999") {
        cb({ success: false, message: "Error", data: undefined });
      }
    });

    await expect(manager.handleGetMissingObject("999")).rejects.toThrow();
  });

  test("createObject success", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);

    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "newTest") {
        cb({ success: true, data: { _id: "123", name: "123" }, message: "" });
      }
    });

    const obj = await manager.createObject({ name: "123" });
    expect(obj).toBeDefined();
    expect(manager.getObject(obj._id)).toBe(obj);
  });

  test("createObject failure", async () => {
    let failedObj: TestClientObject | undefined;
    class BadClass extends TestClientObject {
      constructor(cp: any, s: Socket, data: any, l: LoggersType, cn: string, pm: IAutoUpdateManager<any>, cb: DEMClientCallbacks<any>, e: EventEmitter) {
        super(cp, s, data, l, cn, pm, cb, e);
        failedObj = this;
        throw new Error("Fail");
      }
    }
    const badManager = new AutoUpdateClientManager(
      BadClass, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(badManager);

    await expect(badManager.createObject({ name: "fail" })).rejects.toThrow();
    if (failedObj) failedObj.destroyImmediate();
    expect(loggers.error).toHaveBeenCalled();
  });

  test("Getters", () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(manager);
    const obj = new TestClientObject(TestClientObject, mockSocket, { _id: "1", name: "test" }, loggers, "Test", manager, callbacks, emitter);
    (manager.objects as Record<string, TestClientObject>)["1"] = obj;

    expect(manager.getObject("1")).toBe(obj);
    expect(manager.getObject(undefined)).toBeNull();
    expect(manager.objects["1"]).toBe(obj);
    expect(manager.objectsAsArray).toContain(obj);
  });

  test("waitForPreloaded timeout", async () => {
    const noRespSocket = { emit: () => {}, on: () => {}, off: () => {}, disconnect: () => {} } as unknown as Socket;
    class RealClass extends AutoUpdatedClientObject<MockClientData> {
      get _id() { return (this.data as MockClientData)?._id; }
    }
    Reflect.defineMetadata("props", ["_id"], RealClass.prototype);
    const obj = new RealClass(RealClass, noRespSocket, "pending-id" as unknown as MockClientData, loggers, "Test", {} as unknown as IAutoUpdateManager<any>, callbacks, emitter);
    await expect(obj.waitForPreloaded(50)).rejects.toThrow("Timeout waiting for object preloading");
  });

  test("createObject socket error failure", async () => {
    const errorSocket = {
      emit: (_evt: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => cb?.({ success: false, message: "Socket failure", data: undefined }),
      on: () => {},
      off: () => {},
      disconnect: () => {}
    } as unknown as Socket;
    class RealClass extends AutoUpdatedClientObject<MockClientData> {
      get _id() { return (this.data as MockClientData)?._id; }
    }
    Reflect.defineMetadata("props", ["_id"], RealClass.prototype);
    const badManager = new AutoUpdateClientManager(
      RealClass, "Test", errorSocket, loggers, {}, emitter, callbacks
    );
    managersToClose.push(badManager);
    await expect(badManager.createObject({ name: "test" })).rejects.toThrow("Socket failure");
  });

  test("AUCManagerFactory concurrent calls deduplication on same socket", async () => {
    let startupEmitCount = 0;
    (mockSocket.emit as unknown as jest.Mock).mockImplementation((event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
      if (event === "startupTest") {
        startupEmitCount++;
        setTimeout(() => {
          cb({ success: true, data: { ids: ["1"], properties: ["name"] }, message: "" });
        }, 10);
      }
    });

    const [managers1, managers2] = await Promise.all([
      AUCManagerFactory({ Test: TestClientObject }, loggers, mockSocket, false, emitter),
      AUCManagerFactory({ Test: TestClientObject }, loggers, mockSocket, false, emitter),
    ]);

    Object.values(managers1).forEach((m) => managersToClose.push(m));

    expect(managers1).toBe(managers2);
    expect(managers1.Test).toBe(managers2.Test);
    expect(startupEmitCount).toBe(1);
  });

  test("AutoUpdateClientManager.close() removes reconnect and socket listeners", async () => {
    const manager = new AutoUpdateClientManager(
      TestClientObject, "Test", mockSocket, loggers, {}, emitter, callbacks
    );
    (manager as unknown as { startSocketListeners: () => void }).startSocketListeners();

    expect(mockSocket.on).toHaveBeenCalledWith("reconnect", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("newTest", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("deleteTest", expect.any(Function));

    manager.close();

    expect(mockSocket.off).toHaveBeenCalledWith("reconnect", expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith("newTest");
    expect(mockSocket.off).toHaveBeenCalledWith("deleteTest");
  });
});

