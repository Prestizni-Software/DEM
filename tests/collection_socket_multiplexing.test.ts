import { jest } from "@jest/globals";
import "reflect-metadata";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { EventEmitter } from "eventemitter3";
import { EVENT_UPDATE, MongoId } from "../CommonTypes.js";

interface MultiplexData {
  _id: MongoId;
  name?: string;
  age?: number;
}

class MultiplexTestEntity extends AutoUpdatedClientObject<MultiplexData> {
  public name!: string;
  public age!: number;
  public override waitForPreloaded = jest.fn().mockImplementation(async () => {});
}
Reflect.defineMetadata("props", ["_id", "name", "age"], MultiplexTestEntity.prototype);

class ServerMultiplexEntity extends AutoUpdatedServerObject<MultiplexData> {
  public name!: string;
  public age!: number;
  public override waitForPreloaded = jest.fn().mockImplementation(async () => {});
}
Reflect.defineMetadata("props", ["_id", "name", "age"], ServerMultiplexEntity.prototype);

function makeMockSocket() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: jest.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    }),
    off: jest.fn((event: string, fn?: Function) => {
      if (!fn) {
        delete listeners[event];
      } else if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    }),
    emit: jest.fn(),
    listeners: (event: string) => listeners[event] || [],
    trigger: async (event: string, ...args: any[]) => {
      const fns = listeners[event] || [];
      const results = [];
      for (const fn of fns) {
        results.push(await fn(...args));
      }
      return results;
    },
    rawListeners: listeners,
  };
}

describe("Collection-Level Socket Multiplexing & Listener Proliferation Fix", () => {
  let loggers: any;

  beforeEach(() => {
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test("Client objects under AutoUpdateClientManager do not register per-instance update listeners", async () => {
    const mockSocket = makeMockSocket();
    const updateCb = jest.fn();

    const manager = new AutoUpdateClientManager(
      MultiplexTestEntity as any,
      "MultiplexTestEntity",
      mockSocket as any,
      loggers,
      {},
      new EventEmitter(),
      {
        new: jest.fn(),
        update: updateCb,
        delete: jest.fn(),
        progress: jest.fn(),
      },
      undefined,
      undefined,
      undefined,
      { multiplexUpdateEvents: true },
    );

    // Mock startup payload with 20 entities
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    const objects = ids.map((id, i) => ({ _id: id, name: `Entity ${i}`, age: 20 + i }));

    mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
      if (event.startsWith("startup")) {
        ack({
          success: true,
          data: {
            status: "full",
            ids,
            objects,
            properties: ["_id", "name", "age"],
            revision: 1,
          },
        });
      }
    });

    await manager.loadFromServer();

    // 1. Verify that collection-level update listener is registered ONCE on socket
    expect(mockSocket.listeners(`${EVENT_UPDATE}MultiplexTestEntity`).length).toBe(1);

    // 2. Verify that NO per-instance listeners exist on the socket for any of the 20 entities
    for (const id of ids) {
      const perInstanceListeners = mockSocket.listeners(`${EVENT_UPDATE}MultiplexTestEntity${id}`);
      expect(perInstanceListeners.length).toBe(0);
    }

    // 3. Trigger a collection-level update from server and verify it routes to the correct object
    const targetObj = manager.getObject("id-5") as MultiplexTestEntity;
    expect(targetObj).toBeDefined();
    expect(targetObj.name).toBe("Entity 5");

    await mockSocket.trigger(`${EVENT_UPDATE}MultiplexTestEntity`, {
      _id: "id-5",
      key: "name",
      value: "Updated Entity 5",
    });

    expect(targetObj.name).toBe("Updated Entity 5");
    expect(updateCb).toHaveBeenCalledWith(targetObj, "name");
  });

  test("Standalone client object without collection listener falls back to per-instance listener", async () => {
    const mockSocket = makeMockSocket();
    const updateCb = jest.fn();

    const standalone = new MultiplexTestEntity(
      MultiplexTestEntity as any,
      mockSocket as any,
      { _id: "standalone-1", name: "Solo", age: 30 },
      loggers,
      "MultiplexTestEntity",
      {} as any, // bare manager without hasCollectionUpdateListener
      { new: jest.fn(), update: updateCb, delete: jest.fn() },
      new EventEmitter(),
    );

    // Standalone entity should register its own per-instance listener
    const perInstanceListeners = mockSocket.listeners(`${EVENT_UPDATE}MultiplexTestEntitystandalone-1`);
    expect(perInstanceListeners.length).toBe(1);

    await mockSocket.trigger(`${EVENT_UPDATE}MultiplexTestEntitystandalone-1`, {
      key: "name",
      value: "Solo Renamed",
    });

    expect(standalone.name).toBe("Solo Renamed");
    expect(updateCb).toHaveBeenCalledWith(standalone, "name");
  });

  test("Server emits both per-instance and collection-level update events on property mutation", async () => {
    const mockSocket = makeMockSocket();
    const mockManager: any = {
      deleteObject: jest.fn(),
      model: {
        findById: jest.fn().mockResolvedValue({ _id: "server-id-1", name: "Initial" } as any),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 } as any),
      },
      managers: {},
      options: {},
    };
    mockManager.managers["ServerMultiplexEntity"] = mockManager;

    const serverObj = new ServerMultiplexEntity(
      ServerMultiplexEntity as any,
      mockSocket as any,
      { _id: "server-id-1", name: "Initial" },
      loggers,
      "ServerMultiplexEntity",
      mockManager,
      new EventEmitter(),
    );

    await serverObj.setValue("name", "UpdatedByServer");

    // Expect emission to per-instance event (backward compatibility)
    expect(mockSocket.emit).toHaveBeenCalledWith(
      `${EVENT_UPDATE}ServerMultiplexEntityserver-id-1`,
      expect.objectContaining({ _id: "server-id-1", key: "name", value: "UpdatedByServer" }),
    );

    // Expect emission to collection-level event (multiplexed)
    expect(mockSocket.emit).toHaveBeenCalledWith(
      `${EVENT_UPDATE}ServerMultiplexEntity`,
      expect.objectContaining({ _id: "server-id-1", key: "name", value: "UpdatedByServer" }),
    );
  });
});
