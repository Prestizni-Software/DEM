import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";
import "reflect-metadata";

import {
  LoggersType,
  MongoId,
  globalCache,
  classProp,
  classRef,
  EVENT_UPDATE,
  EVENT_NEW,
  EVENT_DELETE,
  EVENT_GET,
  ServerResponse,
  IAutoUpdatedClientObject,
  IAutoUpdatedClientObjectBase,
  IAutoUpdateManager,
  DEMClientCallbacks,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";
import {
  AutoUpdateServerManager,
  setupSocketMiddleware,
} from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import {
  AutoUpdatedClientObject,
  setupClassAccessors,
} from "../../AutoUpdatedClientObjectClass.js";

/**
 * Creates mock logger interfaces for testing.
 *
 * @returns LoggersType implementation with Jest mock functions.
 */
function createMockLoggers(): LoggersType {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

/**
 * Creates a mock socket object with event recording and dispatch capabilities.
 *
 * @param initialEvents - Initial event names registered on socket.
 * @returns Mock socket instance for client and server interaction tests.
 */
function createMockSocket(initialEvents: string[] = []) {
  const listeners: Record<string, Function[]> = {};
  const anyListeners: Function[] = [];
  const registered = new Set<string>(initialEvents);

  const socket: any = {
    listeners,
    anyListeners,
    connected: true,
    eventNames: jest.fn(() => Array.from(registered)),
    on: jest.fn((event: string, handler: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      registered.add(event);
      return socket;
    }),
    off: jest.fn((event: string, handler?: Function) => {
      if (!listeners[event]) return socket;
      if (handler) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      } else {
        delete listeners[event];
        registered.delete(event);
      }
      return socket;
    }),
    onAny: jest.fn((handler: Function) => {
      anyListeners.push(handler);
      return socket;
    }),
    emit: jest.fn((_event: string, ..._args: any[]) => {
      return true;
    }),
    /**
     * Dispatches an incoming event to registered on and onAny listeners.
     *
     * @param event - Incoming event name.
     * @param args - Event payload and acknowledgement callback.
     */
    receive: async (event: string, ...args: any[]) => {
      if (listeners[event]) {
        for (const handler of [...listeners[event]]) {
          await handler(...args);
        }
      }
      for (const anyHandler of [...anyListeners]) {
        await anyHandler(event, ...args);
      }
    },
    disconnect: jest.fn(),
    disconnectSockets: jest.fn(),
    use: jest.fn(),
  };

  return socket;
}

/**
 * Creates a mock Mongoose model for server manager tests.
 *
 * @param store - In-memory object store indexed by identifier string.
 * @returns Mock model implementing MongoDB query and mutation methods.
 */
function createMockModel(store: Record<string, any> = {}) {
  const model: any = {
    schema: {
      path: jest.fn((key: string) => {
        if (key === "_id") return { instance: "ObjectID" };
        return undefined;
      }),
    },
    find: jest.fn(async () => Object.values(store)),
    findById: jest.fn(async (id: any) => {
      const idStr = id?.toString() ?? String(id);
      const entry = store[idStr];
      if (!entry) return null;
      return {
        ...entry,
        _id: idStr,
        deleteOne: jest.fn(async () => {
          delete store[idStr];
          return { deletedCount: 1 };
        }),
        save: jest.fn(async () => entry),
      };
    }),
    create: jest.fn(async (data: any) => {
      const idStr = data._id?.toString() || new ObjectId().toString();
      const doc = {
        ...data,
        _id: idStr,
        deleteOne: jest.fn(async () => {
          delete store[idStr];
          return { deletedCount: 1 };
        }),
        save: jest.fn(async () => doc),
      };
      store[idStr] = doc;
      return doc;
    }),
    updateOne: jest.fn(async (query: any, update: any) => {
      const idStr = query._id?.toString();
      if (!idStr || !store[idStr]) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(store[idStr], update.$set);
      }
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
          delete store[idStr][k];
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    deleteOne: jest.fn(async (query: any) => {
      const idStr = query._id?.toString();
      if (idStr && store[idStr]) {
        delete store[idStr];
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    }),
  };
  return model;
}

// Managed entity test classes with metadata reflection properties
class MockServerChild extends AutoUpdatedServerObject<MockServerChild> {
  declare public _id: ObjectId;
  declare public name: string;
}
Reflect.defineMetadata("props", ["_id", "name"], MockServerChild.prototype);
setupClassAccessors(MockServerChild);

class MockServerParent extends AutoUpdatedServerObject<MockServerParent> {
  declare public _id: ObjectId;
  declare public title: string;
  declare public child?: MockServerChild;
  declare public children?: MockServerChild[];
}
Reflect.defineMetadata(
  "props",
  ["_id", "title", "child", "children"],
  MockServerParent.prototype,
);
Reflect.defineMetadata("isRef", true, MockServerParent.prototype, "child");
Reflect.defineMetadata("isRef", true, MockServerParent.prototype, "children");
setupClassAccessors(MockServerParent);

class MockClientEntity extends AutoUpdatedClientObject<any> {
  declare public name?: string;
  declare public count?: number;

  get _id(): MongoId {
    return (this.data as any)?._id;
  }

  public override waitForPreloaded = jest.fn(async () => {});
}
Reflect.defineMetadata(
  "props",
  ["_id", "name", "count"],
  MockClientEntity.prototype,
);
setupClassAccessors(MockClientEntity);

describe("Domain 3 Combination Tests: Real-Time Mutation, Dynamic Sockets, CRUD & Error Subsystem", () => {
  let loggers: LoggersType;
  let emitter: EventEmitter;

  beforeEach(() => {
    globalCache.clear();
    loggers = createMockLoggers();
    emitter = new EventEmitter();
  });

  afterEach(() => {
    globalCache.clear();
  });

  describe("F06 + F07: Real-Time Mutation Engine & Lifecycle CRUD Operations", () => {
    test("Real-time setValue triggers dynamic update channel event with valid payload", async () => {
      // Step 1: Create mock socket and client object.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };
      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "entity-001", name: "OriginalName" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        callbacks,
        emitter,
      );

      // Step 2: Configure mock socket acknowledgement response.
      mockSocket.emit.mockImplementation(
        (event: string, data: any, ack: any) => {
          if (event === `${EVENT_UPDATE}MockClientEntityentity-001` && ack) {
            ack({ success: true, message: "OK" });
          }
        },
      );

      // Step 3: Mutate property and verify dynamic event emission.
      const res = await entity.setValue("name", "UpdatedName");

      expect(res.success).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        `${EVENT_UPDATE}MockClientEntityentity-001`,
        { _id: "entity-001", key: "name", value: "UpdatedName" },
        expect.any(Function),
      );
      expect(callbacks.update).toHaveBeenCalledWith(entity, "name");
    });

    test("createObject on server broadcasts new event to registered client sockets", async () => {
      // Step 1: Create mock store, model, and server manager.
      const store: Record<string, any> = {};
      const mockModel = createMockModel(store);
      const serverSocket = createMockSocket();
      const clientSocket = createMockSocket();

      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );
      (manager as any).managers = { MockServerChild: manager };

      // Step 2: Register client socket connection.
      manager.registerSocket(clientSocket);

      // Step 3: Create new entity on server manager.
      const created = await manager.createObject({ name: "ChildOne" } as any);

      expect(created).toBeDefined();
      expect(created.name).toBe("ChildOne");
      // Step 4: Verify server broadcasts new event to client socket.
      expect(clientSocket.emit).toHaveBeenCalledWith(
        `${EVENT_NEW}MockServerChild`,
        (created as any)._id.toString(),
      );
    });

    test("deleteObject cleans up entity cache and triggers delete callback", async () => {
      // Step 1: Create entity and register in manager cache.
      const store: Record<string, any> = {
        "del-001": { _id: "del-001", name: "ToDelete" },
      };
      const mockModel = createMockModel(store);
      const serverSocket = createMockSocket();

      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );
      (manager as any).managers = { MockServerChild: manager };

      const childDoc = await mockModel.findById("del-001");
      const entity = new MockServerChild(
        MockServerChild,
        serverSocket,
        { _id: "del-001", name: "ToDelete" } as any,
        loggers,
        "MockServerChild",
        manager,
        emitter,
      );
      (entity as any).loadFromDocument(childDoc);

      (manager as any).objects_["del-001"] = entity;
      globalCache.objects["del-001"] = {
        className: "MockServerChild",
        object: entity,
      };

      const deleteCallback = jest.fn();
      (entity as any).callbacks = { delete: deleteCallback };

      // Step 2: Delete entity from manager.
      const outcome = await manager.deleteObject("del-001");

      expect(outcome.success).toBe(true);
      expect((manager as any).objects_["del-001"]).toBeUndefined();
      expect(globalCache.objects["del-001"]).toBeUndefined();
      expect(deleteCallback).toHaveBeenCalledWith(manager);
    });

    test("Client and server deletion echo suppression for remote deletion", async () => {
      // Step 1: Initialize client manager with mock socket.
      const mockSocket = createMockSocket();
      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };

      const clientManager = new AutoUpdateClientManager(
        MockClientEntity,
        "MockClientEntity",
        mockSocket,
        loggers,
        {} as any,
        emitter,
        callbacks,
      );

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "remote-del-01", name: "RemoteTarget" } as any,
        loggers,
        "MockClientEntity",
        clientManager,
        callbacks,
        emitter,
      );

      (clientManager as any).objects_["remote-del-01"] = entity;
      globalCache.objects["remote-del-01"] = {
        className: "MockClientEntity",
        object: entity,
      };

      // Step 2: Execute local eviction via evictObject.
      mockSocket.emit.mockClear();
      const outcome = await clientManager.evictObject("remote-del-01");

      expect(outcome.success).toBe(true);
      expect((clientManager as any).objects_["remote-del-01"]).toBeUndefined();
      expect(globalCache.objects["remote-del-01"]).toBeUndefined();
      expect((entity as any).data.Wiped).toBe(true);

      // Step 3: Verify socket does not emit deletion event to server.
      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        `${EVENT_DELETE}MockClientEntity`,
        expect.anything(),
        expect.anything(),
      );
    });

    test("Local client deletion emits delete event with acknowledgement to server", async () => {
      // Step 1: Initialize client entity with mock socket.
      const mockSocket = createMockSocket();
      const clientManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async (_id: MongoId) => {
          return new Promise((resolve) => {
            mockSocket.emit(
              `${EVENT_DELETE}MockClientEntity`,
              _id,
              (res: ServerResponse<undefined>) => {
                resolve({ success: res.success, message: res.message });
              },
            );
          });
        }),
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "local-del-01", name: "LocalTarget" } as any,
        loggers,
        "MockClientEntity",
        clientManager as any,
        {} as any,
        emitter,
      );

      mockSocket.emit.mockImplementation(
        (event: string, _data: any, ack: any) => {
          if (event === `${EVENT_DELETE}MockClientEntity` && ack) {
            ack({ success: true, message: "Deleted on server" });
          }
        },
      );

      // Step 2: Trigger local destroy method.
      const res = await entity.destroy();

      expect(res.success).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        `${EVENT_DELETE}MockClientEntity`,
        "local-del-01",
        expect.any(Function),
      );
    });

    test("clientManager.deleteObject has single parameter and emits outbound delete event", async () => {
      const mockSocket = createMockSocket();
      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };
      const clientManager = new AutoUpdateClientManager(
        MockClientEntity,
        "MockClientEntity",
        mockSocket,
        loggers,
        {} as any,
        emitter,
        callbacks,
      );

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "manager-del-01", name: "Target" } as any,
        loggers,
        "MockClientEntity",
        clientManager,
        callbacks,
        emitter,
      );

      (clientManager as any).objects_["manager-del-01"] = entity;
      globalCache.objects["manager-del-01"] = {
        className: "MockClientEntity",
        object: entity,
      };

      mockSocket.emit.mockImplementation(
        (event: string, _data: any, ack: any) => {
          if (event === `${EVENT_DELETE}MockClientEntity` && ack) {
            ack({ success: true, message: "Deleted on server" });
          }
        },
      );

      const outcome = await clientManager.deleteObject("manager-del-01");
      expect(outcome.success).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        `${EVENT_DELETE}MockClientEntity`,
        "manager-del-01",
        expect.any(Function),
      );
      expect((clientManager as any).objects_["manager-del-01"]).toBeUndefined();
      expect(globalCache.objects["manager-del-01"]).toBeUndefined();
      expect((entity as any).data.Wiped).toBe(true);
    });
  });

  describe("F06 + F14: Real-Time Mutation & Structured Error Subsystem", () => {
    test("Mutation on client object with missing identifier returns DEMErrorCode.MISSING_ID", async () => {
      // Step 1: Create client entity without _id property.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { name: "NoIdEntity" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        {} as any,
        emitter,
      );

      // Step 2: Attempt setValue mutation.
      const outcome = await entity.setValue("name", "NewValue");

      expect(outcome.success).toBe(false);
      expect(outcome.code).toBe(DEMErrorCode.MISSING_ID);

      // Step 3: Verify makeUpdate throws DEMError with MISSING_ID.
      expect(() => (entity as any).makeUpdate("name", "NewValue")).toThrow(
        expect.objectContaining({
          code: DEMErrorCode.MISSING_ID,
        }),
      );
    });

    test("Mutation on server object with missing identifier returns DEMErrorCode.MISSING_ID", async () => {
      // Step 1: Create server entity without _id property.
      const serverSocket = createMockSocket();
      const mockModel = createMockModel({});
      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );

      const entity = new MockServerChild(
        MockServerChild,
        serverSocket,
        { name: "ServerNoId" } as any,
        loggers,
        "MockServerChild",
        manager,
        emitter,
      );

      // Step 2: Attempt server setValue mutation.
      const outcome = await entity.setValue("name", "NewValue");

      expect(outcome.success).toBe(false);
      expect(outcome.code).toBe(DEMErrorCode.MISSING_ID);
    });

    test("Invalid property mutation returns DEMErrorCode.INVALID_ARGUMENT on client", async () => {
      // Step 1: Create valid client entity.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "valid-001", name: "ValidEntity" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        {} as any,
        emitter,
      );

      // Step 2: Attempt to mutate unlisted property.
      const outcome = await entity.setValue("notAValidProp" as any, "BadVal");

      expect(outcome.success).toBe(false);
      expect(outcome.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
      expect(outcome.msg).toContain("Invalid property key");
    });

    test("Prototype pollution property mutation returns DEMErrorCode.INVALID_ARGUMENT", async () => {
      // Step 1: Create valid entities on client and server.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const clientEntity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "proto-001", name: "ProtoClient" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        {} as any,
        emitter,
      );

      const mockModel = createMockModel({});
      const serverManager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        mockSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );

      const serverEntity = new MockServerChild(
        MockServerChild,
        mockSocket,
        { _id: "proto-002", name: "ProtoServer" } as any,
        loggers,
        "MockServerChild",
        serverManager,
        emitter,
      );

      // Step 2: Attempt prototype pollution attacks.
      const clientRes1 = await clientEntity.setValue("__proto__" as any, {});
      const clientRes2 = await clientEntity.setValue("constructor" as any, {});
      const clientRes3 = await clientEntity.setValue("prototype" as any, {});

      const serverRes1 = await serverEntity.setValue("__proto__" as any, {});
      const serverRes2 = await serverEntity.setValue("constructor" as any, {});
      const serverRes3 = await serverEntity.setValue("prototype" as any, {});

      expect(clientRes1.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
      expect(clientRes2.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
      expect(clientRes3.code).toBe(DEMErrorCode.INVALID_ARGUMENT);

      expect(serverRes1.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
      expect(serverRes2.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
      expect(serverRes3.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
    });

    test("Mutation socket failure or timeout returns structured DEMErrorCode.TIMEOUT", async () => {
      // Step 1: Create client entity with mock socket returning timeout error.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "timeout-001", name: "TimeoutEntity" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        {} as any,
        emitter,
      );

      mockSocket.emit.mockImplementation(
        (event: string, _data: any, ack: any) => {
          if (ack) {
            ack({
              success: false,
              code: DEMErrorCode.TIMEOUT,
              message: "Operation timed out.",
            });
          }
        },
      );

      // Step 2: Attempt mutation and verify timeout propagation.
      const outcome = await entity.setValue("name", "NewName");

      expect(outcome.success).toBe(false);
      expect(outcome.code).toBe(DEMErrorCode.TIMEOUT);
      expect(outcome.msg).toBe("Operation timed out.");
    });
  });

  describe("F07 + F14: Entity Lifecycle CRUD Operations & Structured Error Subsystem", () => {
    test("Entity creation failure in database returns typed DEMError OBJECT_CREATE_FAILED", async () => {
      // Step 1: Create mock model that rejects on create.
      const mockModel = createMockModel();
      mockModel.create.mockRejectedValue(new Error("Mongo connection drop"));

      const serverSocket = createMockSocket();
      const clientSocket = createMockSocket();

      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );
      (manager as any).managers = { MockServerChild: manager };

      manager.registerSocket(clientSocket);

      // Step 2: Dispatch new entity event from socket client.
      let response: ServerResponse<any> | undefined;
      await new Promise<void>((resolve) => {
        clientSocket.receive(
          `${EVENT_NEW}MockServerChild`,
          { name: "WillFail" },
          (res: ServerResponse<any>) => {
            response = res;
            resolve();
          },
        );
      });

      expect(response).toBeDefined();
      expect(response!.success).toBe(false);
      expect(response!.code).toBe(DEMErrorCode.OBJECT_CREATE_FAILED);
      expect(response!.message).toContain("Mongo connection drop");
    });

    test("Entity deletion failure in database returns typed DEMError OBJECT_DELETE_FAILED", async () => {
      // Step 1: Create mock model where document deleteOne throws database error.
      const store: Record<string, any> = {
        "fail-del-01": { _id: "fail-del-01", name: "LockedDoc" },
      };
      const mockModel = createMockModel(store);
      mockModel.findById.mockResolvedValue({
        _id: "fail-del-01",
        deleteOne: jest.fn().mockRejectedValue(new Error("Disk write error")),
      });

      const serverSocket = createMockSocket();
      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );
      (manager as any).managers = { MockServerChild: manager };

      // Step 2: Attempt deletion and verify error code.
      const outcome = await manager.deleteObject("fail-del-01");

      expect(outcome.success).toBe(false);
      expect(outcome.code).toBe(DEMErrorCode.OBJECT_DELETE_FAILED);
      expect(outcome.message).toContain("Disk write error");
    });

    test("handleGetMissingObject throws DOCUMENT_NOT_FOUND when entity does not exist in database", async () => {
      // Step 1: Create mock model returning null for missing object.
      const mockModel = createMockModel({});
      mockModel.findById.mockResolvedValue(null);

      const serverSocket = createMockSocket();
      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );

      // Step 2: Request missing object and assert thrown error.
      await expect(
        manager.handleGetMissingObject("non-existent-id"),
      ).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DOCUMENT_NOT_FOUND,
        }),
      );
    });

    test("Deleting already deleted or non-existent entity returns graceful success", async () => {
      // Step 1: Setup empty manager store.
      const mockModel = createMockModel({});
      const serverSocket = createMockSocket();
      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );

      // Step 2: Delete non-existent ID.
      const outcome = await manager.deleteObject("already-gone-id");

      expect(outcome.success).toBe(true);
      expect(outcome.message).toBe("Already gone");
    });
  });

  describe("F06 + F07 + F14 Triplet: Mutation, Lifecycle CRUD & Error Handling", () => {
    test("Sequential CRUD lifecycle: create -> mutate -> invalid mutation error -> valid mutation -> delete -> post-deletion error", async () => {
      // Step 1: Create server manager and model store.
      const store: Record<string, any> = {};
      const mockModel = createMockModel(store);
      const serverSocket = createMockSocket();
      const clientSocket = createMockSocket();

      const manager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        mockModel,
        {} as any,
        emitter,
      );
      (manager as any).managers = { MockServerChild: manager };
      manager.registerSocket(clientSocket);

      // Step 2: Create entity via server manager.
      const entity = await manager.createObject({ name: "Phase1" } as any);
      const entityId = (entity as any)._id.toString();
      expect(entity.name).toBe("Phase1");

      // Step 3: Mutate valid property via setValue.
      const update1 = await entity.setValue("name", "Phase2");
      expect(update1.success).toBe(true);
      expect(entity.name).toBe("Phase2");

      // Step 4: Attempt invalid property mutation.
      const update2 = await entity.setValue("notReal" as any, "Bad");
      expect(update2.success).toBe(false);
      expect(update2.code).toBe(DEMErrorCode.INVALID_ARGUMENT);

      // Step 5: Perform second valid mutation.
      const update3 = await entity.setValue("name", "Phase3");
      expect(update3.success).toBe(true);
      expect(entity.name).toBe("Phase3");

      // Step 6: Delete entity from manager.
      const delOutcome = await manager.deleteObject(entityId);
      expect(delOutcome.success).toBe(true);

      // Step 7: Socket update for deleted entity triggers OBJECT_NOT_FOUND or OBJECT_GET_FAILED.
      mockModel.findById.mockResolvedValue(null);
      let updateAck: ServerResponse<any> | undefined;
      await new Promise<void>((resolve) => {
        clientSocket.receive(
          `${EVENT_UPDATE}MockServerChild${entityId}`,
          { _id: entityId, key: "name", value: "Phase4" },
          (res: ServerResponse<any>) => {
            updateAck = res;
            resolve();
          },
        );
      });

      expect(updateAck).toBeDefined();
      expect(updateAck!.success).toBe(false);
      expect(
        updateAck!.code === DEMErrorCode.OBJECT_GET_FAILED ||
          updateAck!.code === DEMErrorCode.DOCUMENT_NOT_FOUND,
      ).toBe(true);
    });
  });

  describe("F06 + F07 + F01 Triplet: Mutation, CRUD & Property Reflection Accessor Updates", () => {
    test("Entity accessors reflect values from creation through mutation to teardown", async () => {
      // Step 1: Create mock client entity with property reflection accessors.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "ref-acc-01", name: "InitialTitle", count: 10 } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        callbacks,
        emitter,
      );

      // Step 2: Read properties using reflection getters.
      expect(entity.name).toBe("InitialTitle");
      expect(entity.count).toBe(10);

      // Step 3: Mutate properties and verify reflection accessor updates.
      mockSocket.emit.mockImplementation((_e: string, _d: any, ack: any) => {
        if (ack) ack({ success: true, message: "OK" });
      });

      await entity.setValue("name", "UpdatedTitle");
      await entity.setValue("count", 25);

      expect(entity.name).toBe("UpdatedTitle");
      expect(entity.count).toBe(25);

      // Step 4: Synchronous teardown via destroyImmediate.
      entity.destroyImmediate();

      expect((entity as any).data.Wiped).toBe(true);
      expect(entity.name).toBeUndefined();
      expect(entity.count).toBeUndefined();
    });
  });

  describe("F06 + F07 + F02 Triplet: Mutation, CRUD & Cross-Manager Reference Invalidation", () => {
    test("Deleting referenced entity invalidates cross-manager pointer and drops stale child from array proxy", async () => {
      // Step 1: Setup parent and child stores and managers.
      const childStore: Record<string, any> = {
        "child-001": { _id: "child-001", name: "AlphaChild" },
      };
      const parentStore: Record<string, any> = {
        "parent-001": {
          _id: "parent-001",
          title: "MainParent",
          child: "child-001",
          children: ["child-001"],
        },
      };

      const childModel = createMockModel(childStore);
      const parentModel = createMockModel(parentStore);
      const serverSocket = createMockSocket();

      const childManager = new AutoUpdateServerManager(
        MockServerChild,
        "MockServerChild",
        serverSocket,
        loggers,
        childModel,
        {} as any,
        emitter,
      );

      const parentManager = new AutoUpdateServerManager(
        MockServerParent,
        "MockServerParent",
        serverSocket,
        loggers,
        parentModel,
        {} as any,
        emitter,
      );

      const managersRegistry = {
        MockServerChild: childManager,
        MockServerParent: parentManager,
      };
      (childManager as any).managers = managersRegistry;
      (parentManager as any).managers = managersRegistry;

      // Step 2: Instantiate child and parent server entities.
      const childDoc = await childModel.findById("child-001");
      const childEntity = new MockServerChild(
        MockServerChild,
        serverSocket,
        { _id: "child-001", name: "AlphaChild" } as any,
        loggers,
        "MockServerChild",
        childManager,
        emitter,
      );
      (childEntity as any).loadFromDocument(childDoc);
      (childManager as any).objects_["child-001"] = childEntity;
      globalCache.objects["child-001"] = {
        className: "MockServerChild",
        object: childEntity,
      };

      const parentDoc = await parentModel.findById("parent-001");
      const parentEntity = new MockServerParent(
        MockServerParent,
        serverSocket,
        {
          _id: "parent-001",
          title: "MainParent",
          child: "child-001",
          children: ["child-001"],
        } as any,
        loggers,
        "MockServerParent",
        parentManager,
        emitter,
      );
      (parentEntity as any).loadFromDocument(parentDoc);
      (parentManager as any).objects_["parent-001"] = parentEntity;
      globalCache.objects["parent-001"] = {
        className: "MockServerParent",
        object: parentEntity,
      };

      // Step 3: Verify parent resolves child entity and array proxy.
      expect(parentEntity.child).toBeDefined();
      expect(parentEntity.child!.name).toBe("AlphaChild");
      expect(parentEntity.children).toBeDefined();
      expect(parentEntity.children!.length).toBe(1);
      expect(parentEntity.children![0].name).toBe("AlphaChild");

      // Step 4: Delete child entity via child manager.
      await childManager.deleteObject("child-001");

      // Step 5: Verify child removed from global cache and wiped.
      expect(globalCache.objects["child-001"]).toBeUndefined();
      expect((childEntity as any).data.Wiped).toBe(true);

      // Step 6: Verify parent reference is invalidated and array excludes stale child.
      expect(parentEntity.child).toBeUndefined();
      expect(parentEntity.children!.length).toBe(0);
    });
  });

  describe("Domain 3 Edge Cases & Invariants", () => {
    test("Socket listener whitelisting dynamic update channels via socket.eventNames()", async () => {
      // Step 1: Create mock server and socket instance.
      const mockServer: any = { use: jest.fn() };
      const socket = createMockSocket();
      const mockManager = {
        getObject: jest.fn((id: string) => ({ _id: id, name: "Found" })),
      };

      // Step 2: Register dynamic update channel prefix on socket.
      socket.on(`${EVENT_UPDATE}WhitelistedClass`, async () => {});

      // Step 3: Attach socket middleware with manager registry.
      setupSocketMiddleware(
        mockServer,
        loggers,
        { WhitelistedClass: mockManager as any },
      );

      const serverMiddleware = mockServer.use.mock.calls[0][0];
      let packetMiddleware: Function | undefined;
      socket.use = jest.fn((fn: Function) => {
        packetMiddleware = fn;
      });

      await serverMiddleware(socket, jest.fn());
      expect(packetMiddleware).toBeDefined();

      // Step 4: Dispatch whitelisted dynamic update channel (24-char MongoId suffix).
      const validEventId = "507f1f77bcf86cd799439011";
      const validEventName = `${EVENT_UPDATE}WhitelistedClass${validEventId}`;
      let nextCalled = false;
      const ackValid = jest.fn();

      await packetMiddleware!(
        [validEventName, { key: "name", value: "New" }, ackValid],
        () => {
          nextCalled = true;
        },
      );

      // Dynamic channel matched socket.eventNames() prefix and passed through.
      expect(ackValid).not.toHaveBeenCalledWith(
        expect.objectContaining({
          code: DEMErrorCode.UNDEFINED_EVENT,
        }),
      );

      // Step 5: Dispatch unregistered dynamic update channel.
      const invalidEventName = `${EVENT_UPDATE}UnknownClass${validEventId}`;
      const ackInvalid = jest.fn();

      await packetMiddleware!(
        [invalidEventName, {}, ackInvalid],
        jest.fn(),
      );

      // Unregistered channel was blocked with UNDEFINED_EVENT.
      expect(ackInvalid).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: DEMErrorCode.UNDEFINED_EVENT,
        }),
      );
    });

    test("Internal silent updates (setValue__ with silent: true) update in-memory values without socket broadcast", async () => {
      // Step 1: Create client entity with mock socket.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "silent-001", name: "BeforeSilent" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        callbacks,
        emitter,
      );

      // Step 2: Execute internal silent mutation.
      mockSocket.emit.mockClear();
      const res = await (entity as any).setValue__("name", "AfterSilent", true);

      // Step 3: Verify in-memory state updated and socket emit bypassed.
      expect(res.success).toBe(true);
      expect(entity.name).toBe("AfterSilent");
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    test("destroyImmediate synchronously tears down listeners, caches and wiped state", () => {
      // Step 1: Create entity with reference cache and properties.
      const mockSocket = createMockSocket();
      const mockManager = {
        managers: {},
        cache: { references: {} },
        deleteObject: jest.fn(async () => ({ success: true })),
        isLoaded: true,
      };

      const callbacks: DEMClientCallbacks<any> = {
        update: jest.fn(),
        delete: jest.fn(),
        new: jest.fn(),
        progress: jest.fn(),
      };

      const entity = new MockClientEntity(
        MockClientEntity,
        mockSocket,
        { _id: "destroy-imm-01", name: "LivingEntity" } as any,
        loggers,
        "MockClientEntity",
        mockManager as any,
        callbacks,
        emitter,
      );

      expect(entity.name).toBe("LivingEntity");

      // Step 2: Execute synchronous destroyImmediate.
      entity.destroyImmediate();

      // Step 3: Verify synchronous teardown outcome.
      expect((entity as any).data.Wiped).toBe(true);
      expect(entity.name).toBeUndefined();
    });
  });
});
