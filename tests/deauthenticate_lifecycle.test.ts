import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import {
  EVENT_DEAUTHENTICATE,
  globalCache,
} from "../CommonTypes.js";

function createClientMockClass(props: string[] = ["_id"]) {
  class MockClientEntity extends AutoUpdatedClientObject<any> {
    get _id() {
      return (this as any).data?._id;
    }
    override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
  }
  Reflect.defineMetadata("props", props, MockClientEntity.prototype);
  return MockClientEntity;
}

function makeMockSocket() {
  const listeners: Record<string, Function[]> = {};
  return {
    listeners,
    on: jest.fn((event: string, handler: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    }),
    off: jest.fn((event: string, handler?: Function) => {
      if (!listeners[event]) return;
      if (handler) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      } else {
        delete listeners[event];
      }
    }),
    emit: jest.fn((event: string, ...args: any[]) => {
      if (listeners[event]) {
        for (const handler of [...listeners[event]]) {
          handler(...args);
        }
      }
    }),
    onAny: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe("Standardized Authorization Teardown Lifecycle (EVENT_DEAUTHENTICATE)", () => {
  let loggers: any;

  beforeEach(() => {
    globalCache.clear();
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test("Client manager automatically tears down and purges state when deauthenticate event arrives", async () => {
    const mockSocket = makeMockSocket();
    const emitter = new EventEmitter();
    const deauthListener = jest.fn();
    emitter.on(EVENT_DEAUTHENTICATE, deauthListener);

    const ClientClass = createClientMockClass(["_id", "title"]);
    const manager = new AutoUpdateClientManager(
      ClientClass as any,
      "Task",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const taskObj = new ClientClass(
      ClientClass,
      mockSocket,
      { _id: "task-1", title: "Test Task" },
      loggers,
      "Task",
      manager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (manager as any).objects_["task-1"] = taskObj;
    globalCache.objects["task-1"] = { className: "Task", object: taskObj as any };

    expect(manager.objectIDs).toContain("task-1");
    expect(globalCache.objects["task-1"]).toBeDefined();

    // Trigger server-to-client deauthenticate event on socket
    mockSocket.emit(EVENT_DEAUTHENTICATE, { reason: "401 Unauthorized" });

    // Assert that emitter received deauthenticate event
    expect(deauthListener).toHaveBeenCalledWith({ reason: "401 Unauthorized" });

    // Assert manager purged in-memory objects and global cache
    expect(manager.objectIDs.length).toBe(0);
    expect(globalCache.objects["task-1"]).toBeUndefined();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  test("Server manager deauthenticate method emits EVENT_DEAUTHENTICATE to target socket", () => {
    const mockSocket = makeMockSocket();
    const serverManager = new AutoUpdateServerManager(
      class DummyModel {} as any,
      "Dummy",
      {} as any,
      loggers,
      {},
      new EventEmitter(),
    );

    serverManager.registerSocket(mockSocket as any);
    expect(serverManager.clientSockets.has(mockSocket as any)).toBe(true);

    serverManager.deauthenticate(mockSocket as any, "Token expired");

    expect(mockSocket.emit).toHaveBeenCalledWith(
      EVENT_DEAUTHENTICATE,
      expect.objectContaining({
        reason: "Token expired",
      }),
    );
  });
});
