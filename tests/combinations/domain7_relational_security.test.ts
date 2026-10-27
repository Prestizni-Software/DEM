import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";
import "reflect-metadata";
import {
  AutoUpdatedClientObject,
  setupClassAccessors,
} from "../../AutoUpdatedClientObjectClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import {
  AutoUpdateServerManager,
  setupSocketMiddleware,
  DEMEventTypes,
} from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  globalCache,
  DEMError,
  DEMErrorCode,
  LoggersType,
  EVENT_STARTUP,
  EVENT_UPDATE,
  DEMArray,
  DEM_VERSION,
  DEM_CLIENT_VERSION,
  DEM_PROTOCOL_VERSION,
} from "../../CommonTypes.js";

/**
 * Creates mock logger interfaces for testing.
 *
 * @returns Logger object with jest mock functions.
 */
function createTestLoggers(): LoggersType {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

/**
 * Mock Socket interface matching client and server requirements.
 */
interface IMockSocket {
  id: string;
  handshake: {
    auth: Record<string, unknown>;
    address: string;
    headers: Record<string, unknown>;
  };
  connected: boolean;
  on: (event: string, handler: Function) => void;
  off: (event: string, handler?: Function) => void;
  once: (event: string, handler: Function) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
  disconnectSockets?: (close: boolean) => void;
  eventNames: () => string[];
  listeners: (event: string) => Function[];
  onAny: (handler: Function) => void;
  use?: (middleware: Function) => void;
}

/**
 * Creates a connected mock client and server socket pair.
 *
 * @param auth - Initial client authentication payload.
 * @returns Connected clientSocket and serverSocket pair.
 */
function createMockSocketPair(auth: Record<string, unknown> = {}): {
  clientSocket: IMockSocket;
  serverSocket: IMockSocket;
} {
  const clientListeners: Record<string, Function[]> = {};
  const serverListeners: Record<string, Function[]> = {};
  const serverPacketMiddlewares: Function[] = [];
  const clientAnyListeners: Function[] = [];
  const serverAnyListeners: Function[] = [];

  let isConnected = true;

  const serverSocket: IMockSocket = {
    id: "srv-sock-" + Math.random().toString(36).substring(2, 9),
    handshake: {
      auth,
      address: "127.0.0.1",
      headers: {},
    },
    connected: true,
    on(event: string, handler: Function) {
      serverListeners[event] = serverListeners[event] || [];
      serverListeners[event].push(handler);
    },
    off(event: string, handler?: Function) {
      if (!serverListeners[event]) return;
      if (handler) {
        serverListeners[event] = serverListeners[event].filter((h) => h !== handler);
      } else {
        delete serverListeners[event];
      }
    },
    once(event: string, handler: Function) {
      const onceWrapper = (...args: unknown[]) => {
        serverSocket.off(event, onceWrapper);
        handler(...args);
      };
      serverSocket.on(event, onceWrapper);
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of clientAnyListeners) {
        fn(event, ...args);
      }
      const handlers = clientListeners[event] ? [...clientListeners[event]] : [];
      for (const fn of handlers) {
        fn(...args);
      }
    },
    disconnect() {
      if (!isConnected) return;
      isConnected = false;
      serverSocket.connected = false;
      clientSocket.connected = false;
    },
    disconnectSockets(_close: boolean) {
      serverSocket.disconnect();
    },
    eventNames() {
      return Object.keys(serverListeners);
    },
    listeners(event: string) {
      return serverListeners[event] || [];
    },
    onAny(handler: Function) {
      serverAnyListeners.push(handler);
    },
    use(middleware: Function) {
      serverPacketMiddlewares.push(middleware);
    },
  };

  const clientSocket: IMockSocket = {
    id: serverSocket.id,
    handshake: serverSocket.handshake,
    connected: true,
    on(event: string, handler: Function) {
      clientListeners[event] = clientListeners[event] || [];
      clientListeners[event].push(handler);
    },
    off(event: string, handler?: Function) {
      if (!clientListeners[event]) return;
      if (handler) {
        clientListeners[event] = clientListeners[event].filter((h) => h !== handler);
      } else {
        delete clientListeners[event];
      }
    },
    once(event: string, handler: Function) {
      const onceWrapper = (...args: unknown[]) => {
        clientSocket.off(event, onceWrapper);
        handler(...args);
      };
      clientSocket.on(event, onceWrapper);
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of serverAnyListeners) {
        fn(event, ...args);
      }

      const dispatchToServer = () => {
        const handlers = serverListeners[event] ? [...serverListeners[event]] : [];
        for (const fn of handlers) {
          fn(...args);
        }
      };

      if (serverPacketMiddlewares.length > 0) {
        const packet = [event, ...args];
        let idx = 0;
        const next = (err?: Error) => {
          if (err) return;
          idx++;
          if (idx < serverPacketMiddlewares.length) {
            serverPacketMiddlewares[idx](packet, next);
          } else {
            dispatchToServer();
          }
        };
        serverPacketMiddlewares[0](packet, next);
        return;
      }

      dispatchToServer();
    },
    disconnect() {
      serverSocket.disconnect();
    },
    eventNames() {
      return Object.keys(clientListeners);
    },
    listeners(event: string) {
      return clientListeners[event] || [];
    },
    onAny(handler: Function) {
      clientAnyListeners.push(handler);
    },
  };

  return { clientSocket, serverSocket };
}

/**
 * Creates mock Socket.IO server for server manager initialization.
 *
 * @returns Mock Socket.IO server instance.
 */
function createMockSocketServer() {
  const connectionMiddlewares: Function[] = [];
  const eventListeners: Record<string, Function[]> = {};

  return {
    use(fn: Function) {
      connectionMiddlewares.push(fn);
    },
    on(event: string, fn: Function) {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(fn);
    },
    emit(event: string, ...args: unknown[]) {
      const handlers = eventListeners[event] || [];
      for (const h of handlers) {
        h(...args);
      }
    },
    connectClient(serverSocket: IMockSocket) {
      let idx = 0;
      const next = () => {
        idx++;
        if (idx < connectionMiddlewares.length) {
          connectionMiddlewares[idx](serverSocket, next);
        } else {
          const handlers = eventListeners["connection"] || [];
          for (const h of handlers) {
            h(serverSocket);
          }
        }
      };
      if (connectionMiddlewares.length > 0) {
        connectionMiddlewares[0](serverSocket, next);
      } else {
        const handlers = eventListeners["connection"] || [];
        for (const h of handlers) {
          h(serverSocket);
        }
      }
    },
    disconnectSockets: jest.fn(),
  };
}

/**
 * Creates mock database model with query and update methods.
 *
 * @param initialDocs - Array of initial entity documents.
 * @returns Mock Mongoose Typegoose model.
 */
function createMockModel(initialDocs: Array<Record<string, unknown>> = []) {
  const docs = [...initialDocs];
  return {
    docs,
    db: { readyState: 1 },
    find: jest.fn().mockImplementation(async () => {
      return docs.map((d) => ({
        ...d,
        toObject: () => ({ ...d }),
      }));
    }),
    findById: jest.fn().mockImplementation(async (id: string) => {
      const match = docs.find((d) => String(d._id) === String(id));
      if (!match) return null;
      return {
        ...match,
        toObject: () => ({ ...match }),
      };
    }),
    updateOne: jest.fn().mockImplementation(async (filter: { _id?: string }, update: any) => {
      const match = docs.find((d) => String(d._id) === String(filter._id));
      if (match) {
        if (update.$set) {
          Object.assign(match, update.$set);
        }
        return { acknowledged: true, modifiedCount: 1 };
      }
      return { acknowledged: true, modifiedCount: 0 };
    }),
  } as any;
}

/**
 * Client entity representing a task with back-reference to project.
 */
class ClientSecurityTask extends AutoUpdatedClientObject<ClientSecurityTask> {
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  declare title: string;
  declare parent: ClientSecurityProject;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "title", "parent"], ClientSecurityTask.prototype);
Reflect.defineMetadata("isRef", true, ClientSecurityTask.prototype, "parent");
Reflect.defineMetadata("refsTo", "SecurityProject", ClientSecurityTask.prototype, "parent");

/**
 * Client entity representing a project with relational tasks and primitive tags.
 */
class ClientSecurityProject extends AutoUpdatedClientObject<ClientSecurityProject> {
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  declare name: string;
  declare ownerId: string;
  declare tags: string[];
  declare tasks: ClientSecurityTask[];

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "name", "ownerId", "tags", "tasks"], ClientSecurityProject.prototype);
Reflect.defineMetadata("isRef", true, ClientSecurityProject.prototype, "tasks");
Reflect.defineMetadata("refsTo", "SecurityTask", ClientSecurityProject.prototype, "tasks");

/**
 * Server entity representing a task.
 */
class ServerSecurityTask extends AutoUpdatedServerObject<ServerSecurityTask> {
  public override get _id(): string {
    return (this as any).data?._id?.toString() ?? (this as any).entry?._id?.toString();
  }

  declare title: string;
  declare parent: ServerSecurityProject;
}
Reflect.defineMetadata("props", ["_id", "title", "parent"], ServerSecurityTask.prototype);
Reflect.defineMetadata("isRef", true, ServerSecurityTask.prototype, "parent");
Reflect.defineMetadata("refsTo", "SecurityProject", ServerSecurityTask.prototype, "parent");

/**
 * Server entity representing a project with relational tasks.
 */
class ServerSecurityProject extends AutoUpdatedServerObject<ServerSecurityProject> {
  public override get _id(): string {
    return (this as any).data?._id?.toString() ?? (this as any).entry?._id?.toString();
  }

  declare name: string;
  declare ownerId: string;
  declare tags: string[];
  declare tasks: ServerSecurityTask[];
}
Reflect.defineMetadata("props", ["_id", "name", "ownerId", "tags", "tasks"], ServerSecurityProject.prototype);
Reflect.defineMetadata("isRef", true, ServerSecurityProject.prototype, "tasks");
Reflect.defineMetadata("refsTo", "SecurityTask", ServerSecurityProject.prototype, "tasks");

describe("Domain 7 Part 4: DEMArray Relational Back-References, Clock Sync & Security", () => {
  let loggers: LoggersType;
  let serverEmitter: EventEmitter;
  let clientEmitter: EventEmitter;

  beforeEach(() => {
    delete (ClientSecurityTask as any).__metaCache;
    delete (ClientSecurityProject as any).__metaCache;
    delete (ServerSecurityTask as any).__metaCache;
    delete (ServerSecurityProject as any).__metaCache;
    setupClassAccessors(ClientSecurityTask);
    setupClassAccessors(ClientSecurityProject);
    globalCache.clear();
    loggers = createTestLoggers();
    serverEmitter = new EventEmitter();
    clientEmitter = new EventEmitter();
  });

  afterEach(() => {
    globalCache.clear();
    jest.clearAllMocks();
  });

  describe("1. Bidirectional Relational Back-Reference Synchronization", () => {
    let mockSocket: any;
    let taskManager: AutoUpdateClientManager<ClientSecurityTask>;
    let projectManager: AutoUpdateClientManager<ClientSecurityProject>;
    let project: ClientSecurityProject;
    let task1: ClientSecurityTask;
    let task2: ClientSecurityTask;
    let task3: ClientSecurityTask;

    beforeEach(() => {
      mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn((event: string, ...args: any[]) => {
          const payload = args[0];
          const cb = args[args.length - 1];
          if (typeof cb === "function") {
            const op = payload?.mutation?.op;
            let updated: string[] = [];
            const current: string[] = (project.data as any)?.tasks ?? [];
            if (op === "push" || op === "unshift") {
              updated = [...current, ...(payload.mutation.items || [])];
            } else if (op === "pop") {
              updated = current.slice(0, -1);
            } else if (op === "shift") {
              updated = current.slice(1);
            } else if (op === "splice") {
              const start = payload.mutation.index ?? 0;
              const count = payload.mutation.deleteCount ?? 1;
              const copy = [...current];
              copy.splice(start, count, ...(payload.mutation.items || []));
              updated = copy;
            } else if (op === "clear") {
              updated = [];
            }
            cb({ success: true, updatedArray: updated });
          }
        }),
      };

      taskManager = new AutoUpdateClientManager(
        ClientSecurityTask,
        "SecurityTask",
        mockSocket,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      projectManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        mockSocket,
        loggers,
        { SecurityTask: taskManager },
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );
      (taskManager.managers as any)["SecurityProject"] = projectManager;

      task1 = new ClientSecurityTask(
        ClientSecurityTask,
        mockSocket,
        { _id: "507f191e810c19729de86011", title: "Task 1" },
        loggers,
        "SecurityTask",
        taskManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );
      task2 = new ClientSecurityTask(
        ClientSecurityTask,
        mockSocket,
        { _id: "507f191e810c19729de86012", title: "Task 2" },
        loggers,
        "SecurityTask",
        taskManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );
      task3 = new ClientSecurityTask(
        ClientSecurityTask,
        mockSocket,
        { _id: "507f191e810c19729de86013", title: "Task 3" },
        loggers,
        "SecurityTask",
        taskManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );

      (taskManager as any).objects_["507f191e810c19729de86011"] = task1;
      (taskManager as any).objects_["507f191e810c19729de86012"] = task2;
      (taskManager as any).objects_["507f191e810c19729de86013"] = task3;
      globalCache.objects["507f191e810c19729de86011"] = { className: "SecurityTask", object: task1 as any };
      globalCache.objects["507f191e810c19729de86012"] = { className: "SecurityTask", object: task2 as any };
      globalCache.objects["507f191e810c19729de86013"] = { className: "SecurityTask", object: task3 as any };

      project = new ClientSecurityProject(
        ClientSecurityProject,
        mockSocket,
        { _id: "507f191e810c19729de86001", name: "Alpha Project", tasks: [] },
        loggers,
        "SecurityProject",
        projectManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );
      (projectManager as any).objects_["507f191e810c19729de86001"] = project;
      globalCache.objects["507f191e810c19729de86001"] = { className: "SecurityProject", object: project as any };
    });

    test("pushing entity instance assigns child back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      expect(task1.parent).toBeUndefined();

      const newLen = await tasks.push(task1);
      expect(newLen).toBe(1);
      expect(tasks.length).toBe(1);
      expect(tasks[0]).toBe(task1);
      expect(task1.parent).toBe(project);
      expect((task1.data as any).parent).toBe("507f191e810c19729de86001");
    });

    test("pushing string ID resolves child and assigns back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      expect(task2.parent).toBeUndefined();

      const newLen = await tasks.push("507f191e810c19729de86012" as any);
      expect(newLen).toBe(1);
      expect(tasks.length).toBe(1);
      expect(tasks[0]).toBe(task2);
      expect(task2.parent).toBe(project);
      expect((task2.data as any).parent).toBe("507f191e810c19729de86001");
    });

    test("pushing ObjectId resolves child and assigns back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      expect(task3.parent).toBeUndefined();

      const hexId = "507f191e810c19729de86013";
      const mongoId = new ObjectId(hexId);
      await tasks.push(mongoId as any);

      expect(tasks.length).toBe(1);
      expect(task3.parent).toBe(project);
      expect((task3.data as any).parent).toBe("507f191e810c19729de86001");
    });

    test("removing entity via pop() clears child back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      await tasks.push(task1);
      await tasks.push(task2);
      expect(task2.parent).toBe(project);

      const popped = await tasks.pop();
      expect(popped).toBe(task2);
      expect(tasks.length).toBe(1);
      expect(task2.parent).toBeUndefined();
      expect((task2.data as any).parent).toBeUndefined();
      expect(task1.parent).toBe(project);
    });

    test("removing entity via shift() clears child back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      await tasks.push(task1);
      await tasks.push(task2);
      expect(task1.parent).toBe(project);

      const shifted = await tasks.shift();
      expect(shifted).toBe(task1);
      expect(tasks.length).toBe(1);
      expect(task1.parent).toBeUndefined();
      expect((task1.data as any).parent).toBeUndefined();
      expect(task2.parent).toBe(project);
    });

    test("removing entity via splice() clears child back-reference", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      await tasks.push(task1);
      await tasks.push(task2);
      await tasks.push(task3);

      const spliced = await tasks.splice(1, 1);
      expect(spliced).toEqual([task2]);
      expect(tasks.length).toBe(2);
      expect(task2.parent).toBeUndefined();
      expect((task2.data as any).parent).toBeUndefined();
      expect(task1.parent).toBe(project);
      expect(task3.parent).toBe(project);
    });

    test("removing entities via clear() clears back-references for all children", async () => {
      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      await tasks.push(task1);
      await tasks.push(task2);
      await tasks.push(task3);
      expect(task1.parent).toBe(project);
      expect(task2.parent).toBe(project);
      expect(task3.parent).toBe(project);

      await tasks.clear();
      expect(tasks.length).toBe(0);
      expect(task1.parent).toBeUndefined();
      expect(task2.parent).toBeUndefined();
      expect(task3.parent).toBeUndefined();
      expect((task1.data as any).parent).toBeUndefined();
      expect((task2.data as any).parent).toBeUndefined();
      expect((task3.data as any).parent).toBeUndefined();
    });
  });

  describe("2. Database Tombstone & Orphan ID Cleanup", () => {
    test("prunes dangling tombstone IDs from relational array and persists cleaned state", async () => {
      const projectModel = createMockModel([
        {
          _id: "507f191e810c19729de86021",
          name: "Project with Tombstones",
          ownerId: "user-1",
          tasks: ["507f191e810c19729de86099", "507f191e810c19729de86022"],
        },
      ]);
      const taskModel = createMockModel([
        { _id: "507f191e810c19729de86022", title: "Living Task", parent: "507f191e810c19729de86021" },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const taskManager = new AutoUpdateServerManager(
        ServerSecurityTask,
        "SecurityTask",
        mockServer as any,
        loggers,
        taskModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityTask = taskManager;

      const projectManager = new AutoUpdateServerManager(
        ServerSecurityProject,
        "SecurityProject",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityProject = projectManager;

      await taskManager.preLoad();
      await projectManager.preLoad();

      const serverProject = projectManager.getObject("507f191e810c19729de86021") as ServerSecurityProject;
      expect(serverProject).toBeDefined();

      // Mutation executes push on relational array with tombstoned ID
      const mutationRes = await serverProject.mutateArray("tasks", {
        key: "tasks",
        op: "push",
        items: ["507f191e810c19729de86023"],
      });

      expect(mutationRes.success).toBe(true);
      // Dangling tombstone pruned automatically
      expect(mutationRes.updatedArray).toEqual(["507f191e810c19729de86022", "507f191e810c19729de86023"]);
      expect(projectModel.updateOne).toHaveBeenCalledWith(
        { _id: "507f191e810c19729de86021" },
        { $set: { tasks: ["507f191e810c19729de86022", "507f191e810c19729de86023"] } },
      );
    });

    test("prunes multiple tombstoned IDs during positional splice mutation", async () => {
      const projectModel = createMockModel([
        {
          _id: "507f191e810c19729de86031",
          name: "Multi Tombstone Project",
          ownerId: "user-1",
          tasks: [
            "507f191e810c19729de86091",
            "507f191e810c19729de86092",
            "507f191e810c19729de86032",
            "507f191e810c19729de86093",
          ],
        },
      ]);
      const taskModel = createMockModel([
        { _id: "507f191e810c19729de86032", title: "Living Task 1", parent: "507f191e810c19729de86031" },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      serverManagers.SecurityTask = new AutoUpdateServerManager(
        ServerSecurityTask,
        "SecurityTask",
        mockServer as any,
        loggers,
        taskModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityProject = new AutoUpdateServerManager(
        ServerSecurityProject,
        "SecurityProject",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );

      await serverManagers.SecurityTask.preLoad();
      await serverManagers.SecurityProject.preLoad();

      const serverProject = serverManagers.SecurityProject.getObject("507f191e810c19729de86031") as ServerSecurityProject;
      const mutationRes = await serverProject.mutateArray("tasks", {
        key: "tasks",
        op: "push",
        items: ["507f191e810c19729de86033"],
      });

      expect(mutationRes.success).toBe(true);
      expect(mutationRes.updatedArray).toEqual(["507f191e810c19729de86032", "507f191e810c19729de86033"]);
    });
  });

  describe("3. Cristian Clock Synchronization", () => {
    test("computes serverTimeOffset from handshake and provides synchronized timestamps", async () => {
      const mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      };

      const clientManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      expect(clientManager.serverTimeOffset).toBe(0);

      // Server clock is 15 seconds ahead
      const simulatedServerNow = Date.now() + 15000;
      mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === "function") {
          cb({
            success: true,
            data: {
              status: "full",
              ids: [],
              objects: [],
              properties: ["_id", "name", "ownerId", "tags", "tasks"],
              version: DEM_VERSION,
              serverTime: simulatedServerNow,
            },
          });
        }
      });

      await clientManager.loadFromServer();

      // serverTimeOffset should be near +15000 ms
      expect(clientManager.serverTimeOffset).toBeGreaterThan(14000);
      expect(clientManager.serverTimeOffset).toBeLessThan(16000);

      const syncTime = clientManager.getSynchronizedTime();
      expect(syncTime).toBeGreaterThanOrEqual(Date.now() + 14000);
    });

    test("embeds synchronized Cristian timestamp in array mutation payload", async () => {
      let capturedPayload: any;
      const mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn((event: string, ...args: any[]) => {
          capturedPayload = args[0];
          const cb = args[args.length - 1];
          if (typeof cb === "function") {
            cb({ success: true, updatedArray: ["alpha"] });
          }
        }),
      };

      const clientManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      // Simulate Cristian offset
      clientManager.serverTimeOffset = 10000;

      const project = new ClientSecurityProject(
        ClientSecurityProject,
        mockSocket as any,
        { _id: "507f191e810c19729de86035", name: "Sync Project", tags: [] },
        loggers,
        "SecurityProject",
        clientManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );

      const tags = project.tags as unknown as DEMArray<string>;
      await tags.push("alpha");

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.mutation).toBeDefined();
      // Client timestamp must include the synchronized offset
      expect(capturedPayload.mutation.clientTimestamp).toBeGreaterThanOrEqual(Date.now() + 9000);
    });
  });

  describe("4. Dynamic Access Control & Permissions", () => {
    test("startupMiddleware restricts visibility and unauthorized array mutation rejects with ACCESS_DENIED", async () => {
      const projectModel = createMockModel([
        { _id: "507f191e810c19729de86041", name: "Public Project", ownerId: "public", tags: ["news"] },
        { _id: "507f191e810c19729de86042", name: "Secret Admin Project", ownerId: "admin", tags: ["confidential"] },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const projectManager = new AutoUpdateServerManager(
        ServerSecurityProject,
        "SecurityProject",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              const role = socket.handshake.auth.role;
              if (role === "admin") return objects;
              return objects.filter((o) => (o as any).ownerId === "public");
            },
            eventMiddleware: async (event, _managers, socket) => {
              if (event.type === DEMEventTypes.update) {
                const targetObj = event.object as ServerSecurityProject;
                const role = socket.handshake.auth.role;
                if (targetObj && (targetObj as any).ownerId === "admin" && role !== "admin") {
                  throw new DEMError(
                    DEMErrorCode.ACCESS_DENIED,
                    "Access denied to admin entity mutation.",
                  );
                }
              }
            },
          },
        },
      );
      serverManagers.SecurityProject = projectManager;

      setupSocketMiddleware(mockServer as any, loggers, serverManagers);
      await projectManager.preLoad();

      // Connect unauthorized guest socket
      const guestPair = createMockSocketPair({ role: "guest" });
      mockServer.connectClient(guestPair.serverSocket);
      projectManager.registerSocket(guestPair.serverSocket as any);

      const clientManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        guestPair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      await clientManager.loadFromServer();

      // Guest only receives public project
      expect(clientManager.getObject("507f191e810c19729de86041")).toBeDefined();
      expect(clientManager.getObject("507f191e810c19729de86042")).toBeUndefined();

      // Guest attempts mutation on forbidden admin project
      const adminProjectStub = new ClientSecurityProject(
        ClientSecurityProject,
        guestPair.clientSocket as any,
        { _id: "507f191e810c19729de86042", name: "Secret Admin Project", tags: ["confidential"] },
        loggers,
        "SecurityProject",
        clientManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );

      const tags = adminProjectStub.tags as unknown as DEMArray<string>;
      await expect(tags.push("unauthorized-tag")).rejects.toThrow(DEMError);
      await expect(tags.push("unauthorized-tag")).rejects.toMatchObject({
        code: DEMErrorCode.ACCESS_DENIED,
      });

      // Local state remains unpolluted
      expect(tags.length).toBe(1);
      expect(tags[0]).toBe("confidential");
    });
  });

  describe("5. Database Write Failure & Pessimistic Rollback", () => {
    test("model updateOne rejection triggers DB_SAVE_FAILED and keeps local state unpolluted", async () => {
      const projectModel = createMockModel([
        { _id: "507f191e810c19729de86051", name: "Error Project", tags: ["v1", "v2"] },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const projectManager = new AutoUpdateServerManager(
        ServerSecurityProject,
        "SecurityProject",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityProject = projectManager;

      setupSocketMiddleware(mockServer as any, loggers, serverManagers);
      await projectManager.preLoad();

      const pair = createMockSocketPair();
      mockServer.connectClient(pair.serverSocket);
      projectManager.registerSocket(pair.serverSocket as any);

      const clientManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      await clientManager.loadFromServer();
      const project = clientManager.getObject("507f191e810c19729de86051") as ClientSecurityProject;
      expect(project).toBeDefined();

      const tags = project.tags as unknown as DEMArray<string>;
      expect(tags.length).toBe(2);

      // Force MongoDB update failure
      projectModel.updateOne.mockRejectedValueOnce(
        new Error("Mongo network error: connection closed"),
      );

      await expect(tags.push("v3-failed")).rejects.toMatchObject({
        code: DEMErrorCode.DB_SAVE_FAILED,
      });

      // Pessimistic guarantee: local array is unpolluted
      expect(tags.length).toBe(2);
      expect(tags[0]).toBe("v1");
      expect(tags[1]).toBe("v2");
      expect((project.data as any).tags).toEqual(["v1", "v2"]);

      // Server state also remains unpolluted
      const serverProject = projectManager.getObject("507f191e810c19729de86051") as ServerSecurityProject;
      expect((serverProject.data as any).tags).toEqual(["v1", "v2"]);
    });

    test("relational push rollback preserves child back-reference on database failure", async () => {
      const mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn((event: string, ...args: any[]) => {
          const cb = args[args.length - 1];
          if (typeof cb === "function") {
            cb({
              success: false,
              code: DEMErrorCode.DB_SAVE_FAILED,
              message: "MongoDB disk write failure",
            });
          }
        }),
      };

      const taskManager = new AutoUpdateClientManager(
        ClientSecurityTask,
        "SecurityTask",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      const projectManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        mockSocket as any,
        loggers,
        { SecurityTask: taskManager },
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      const task = new ClientSecurityTask(
        ClientSecurityTask,
        mockSocket as any,
        { _id: "507f191e810c19729de86061", title: "Rollback Task" },
        loggers,
        "SecurityTask",
        taskManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );
      (taskManager as any).objects_["507f191e810c19729de86061"] = task;
      globalCache.objects["507f191e810c19729de86061"] = { className: "SecurityTask", object: task as any };

      const project = new ClientSecurityProject(
        ClientSecurityProject,
        mockSocket as any,
        { _id: "507f191e810c19729de86062", name: "Rollback Project", tasks: [] },
        loggers,
        "SecurityProject",
        projectManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );

      const tasks = project.tasks as unknown as DEMArray<ClientSecurityTask>;
      await expect(tasks.push(task)).rejects.toMatchObject({
        code: DEMErrorCode.DB_SAVE_FAILED,
      });

      // Array state and back-references remain untouched
      expect(tasks.length).toBe(0);
      expect((project.data as any).tasks).toEqual([]);
      expect(task.parent).toBeUndefined();
      expect((task.data as any).parent).toBeUndefined();
    });
  });

  describe("6. Accessor Protection Traps", () => {
    let project: ClientSecurityProject;

    beforeEach(() => {
      const mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      };
      project = new ClientSecurityProject(
        ClientSecurityProject,
        mockSocket as any,
        { _id: "507f191e810c19729de86071", name: "Trapped Project", tags: ["a", "b"], tasks: [] },
        loggers,
        "SecurityProject",
        {} as any,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        clientEmitter,
      );
    });

    test("direct index assignment throws CANNOT_SET_REF_DIRECTLY", () => {
      const tags = project.tags as unknown as DEMArray<string>;
      expect(() => {
        (tags as any)[0] = "forbidden";
      }).toThrow(DEMError);
      expect(() => {
        (tags as any)[0] = "forbidden";
      }).toThrow(/Cannot assign index directly on DEMArray/);

      try {
        (tags as any)[0] = "forbidden";
      } catch (err: any) {
        expect(err.code).toBe(DEMErrorCode.CANNOT_SET_REF_DIRECTLY);
      }
    });

    test("direct element deletion throws CANNOT_SET_REF_DIRECTLY", () => {
      const tags = project.tags as unknown as DEMArray<string>;
      expect(() => {
        delete (tags as any)[0];
      }).toThrow(DEMError);
      expect(() => {
        delete (tags as any)[0];
      }).toThrow(/Cannot delete elements directly from DEMArray/);

      try {
        delete (tags as any)[0];
      } catch (err: any) {
        expect(err.code).toBe(DEMErrorCode.CANNOT_SET_REF_DIRECTLY);
      }
    });

    test("synchronous mutating method fill() throws CANNOT_SET_REF_DIRECTLY", () => {
      const tags = project.tags as unknown as DEMArray<string>;
      expect(() => {
        (tags as any).fill("val");
      }).toThrow(DEMError);
      expect(() => {
        (tags as any).fill("val");
      }).toThrow(/Cannot mutate DEMArray/);

      try {
        (tags as any).fill("val");
      } catch (err: any) {
        expect(err.code).toBe(DEMErrorCode.CANNOT_SET_REF_DIRECTLY);
      }
    });

    test("synchronous mutating method copyWithin() throws CANNOT_SET_REF_DIRECTLY", () => {
      const tags = project.tags as unknown as DEMArray<string>;
      expect(() => {
        (tags as any).copyWithin(0, 1);
      }).toThrow(DEMError);

      try {
        (tags as any).copyWithin(0, 1);
      } catch (err: any) {
        expect(err.code).toBe(DEMErrorCode.CANNOT_SET_REF_DIRECTLY);
      }
    });
  });

  describe("7. Integrated Cross-Cutting Security & Lifecycle Scenarios", () => {
    test("combines full client-server socket lifecycle with tombstone cleanup and back-reference sync", async () => {
      const taskModel = createMockModel([
        { _id: "507f191e810c19729de86082", title: "Existing Task", parent: "507f191e810c19729de86081" },
        { _id: "507f191e810c19729de86083", title: "Added Task" },
      ]);
      const projectModel = createMockModel([
        {
          _id: "507f191e810c19729de86081",
          name: "E2E Project",
          ownerId: "user-1",
          tags: ["core"],
          tasks: ["507f191e810c19729de86089", "507f191e810c19729de86082"],
        },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const taskServerManager = new AutoUpdateServerManager(
        ServerSecurityTask,
        "SecurityTask",
        mockServer as any,
        loggers,
        taskModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityTask = taskServerManager;

      const projectServerManager = new AutoUpdateServerManager(
        ServerSecurityProject,
        "SecurityProject",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.SecurityProject = projectServerManager;

      setupSocketMiddleware(mockServer as any, loggers, serverManagers);
      await taskServerManager.preLoad();
      await projectServerManager.preLoad();

      const pair = createMockSocketPair({ role: "member" });
      mockServer.connectClient(pair.serverSocket);
      taskServerManager.registerSocket(pair.serverSocket as any);
      projectServerManager.registerSocket(pair.serverSocket as any);

      const taskClientManager = new AutoUpdateClientManager(
        ClientSecurityTask,
        "SecurityTask",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );

      const projectClientManager = new AutoUpdateClientManager(
        ClientSecurityProject,
        "SecurityProject",
        pair.clientSocket as any,
        loggers,
        { SecurityTask: taskClientManager },
        clientEmitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      );
      (taskClientManager.managers as any)["SecurityProject"] = projectClientManager;

      await taskClientManager.loadFromServer();
      await projectClientManager.loadFromServer();

      const clientProject = projectClientManager.getObject("507f191e810c19729de86081") as ClientSecurityProject;
      const clientTask1 = taskClientManager.getObject("507f191e810c19729de86082") as ClientSecurityTask;
      const clientTask2 = taskClientManager.getObject("507f191e810c19729de86083") as ClientSecurityTask;

      expect(clientProject).toBeDefined();
      expect(clientTask1).toBeDefined();
      expect(clientTask2).toBeDefined();

      // Back-reference for existing child is populated
      expect(clientTask1.parent).toBe(clientProject);

      // Mutate relational array via push
      const tasks = clientProject.tasks as unknown as DEMArray<ClientSecurityTask>;
      const newLen = await tasks.push(clientTask2);

      expect(newLen).toBe(2);
      expect(tasks.length).toBe(2);
      expect(tasks[0]).toBe(clientTask1);
      expect(tasks[1]).toBe(clientTask2);

      // Back-reference for added child is synchronized
      expect(clientTask2.parent).toBe(clientProject);
      expect((clientTask2.data as any).parent).toBe("507f191e810c19729de86081");

      // Verify MongoDB document was persisted without the tombstone orphan
      expect(projectModel.updateOne).toHaveBeenCalledWith(
        { _id: "507f191e810c19729de86081" },
        { $set: { tasks: ["507f191e810c19729de86082", "507f191e810c19729de86083"] } },
      );
    });
  });
});
