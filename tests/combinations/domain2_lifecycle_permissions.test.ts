import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import {
  AutoUpdateServerManager,
  AUSManagerFactory,
  AUSDefinitions,
} from "../../AutoUpdateServerManagerClass.js";
import {
  AutoUpdateClientManager,
  AUCManagerFactory,
} from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import { AutoUpdatedClientObject } from "../../AutoUpdatedClientObjectClass.js";
import {
  classProp,
  globalCache,
  LoggersType,
  DEM_VERSION,
  DEM_CLIENT_VERSION,
  DEM_SERVER_VERSION,
  DEM_PROTOCOL_VERSION,
  EVENT_DEAUTHENTICATE,
  EVENT_STARTUP,
  DEMError,
  DEMErrorCode,
  DEMVersionOptions,
  ServerResponse,
} from "../../CommonTypes.js";
import "reflect-metadata";

/**
 * Creates mock logger callbacks for test inspection.
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
  triggerLocalEvent?: (event: string, ...args: unknown[]) => Promise<void>;
}

/**
 * Creates connected mock client and server socket pair.
 *
 * @param auth - Initial client authentication payload.
 * @returns Object containing connected clientSocket and serverSocket.
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
    id: "mock-server-socket-" + Math.random().toString(36).substring(2, 9),
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
      serverSocket.emit("disconnect");
      clientSocket.emit("disconnect");
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
    async triggerLocalEvent(event: string, ...args: unknown[]) {
      const handlers = clientListeners[event] ? [...clientListeners[event]] : [];
      for (const fn of handlers) {
        await fn(...args);
      }
    },
    emit(event: string, ...args: unknown[]) {
      if (event === "reconnect" || event === "connect") {
        const localHandlers = clientListeners[event] ? [...clientListeners[event]] : [];
        for (const fn of localHandlers) {
          fn(...args);
        }
        return;
      }

      for (const fn of serverAnyListeners) {
        fn(event, ...args);
      }

      // Execute socket packet middlewares if present
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

      function dispatchToServer() {
        const handlers = serverListeners[event] ? [...serverListeners[event]] : [];
        for (const fn of handlers) {
          fn(...args);
        }
      }
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
 * Creates mock Socket.IO server for AUSManagerFactory initialization.
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
 * Creates mock database model with query methods.
 *
 * @param initialDocs - Array of initial entity documents.
 * @param readyState - Database readyState (1 is connected).
 * @returns Mock Mongoose Typegoose model.
 */
function createMockModel(
  initialDocs: Array<Record<string, unknown>> = [],
  readyState: number = 1,
) {
  const docs = [...initialDocs];
  return {
    db: { readyState },
    find: jest.fn().mockImplementation(async () => {
      return docs.map((d) => ({
        ...d,
        toObject: () => ({ ...d }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      }));
    }),
    findById: jest.fn().mockImplementation(async (id: string) => {
      const match = docs.find((d) => String(d._id) === String(id));
      if (!match) return null;
      return {
        ...match,
        toObject: () => ({ ...match }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
    }),
    create: jest.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      const newDoc = {
        _id: "created-id-" + Math.random().toString(36).substring(2, 9),
        ...payload,
      };
      docs.push(newDoc);
      return {
        ...newDoc,
        toObject: () => ({ ...newDoc }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
    }),
    deleteOne: jest.fn().mockImplementation(async (filter: { _id?: string }) => {
      const idx = docs.findIndex((d) => String(d._id) === String(filter._id));
      if (idx !== -1) {
        docs.splice(idx, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    }),
  } as any;
}

// Server Entity Classes
class ServerUserEntity extends AutoUpdatedServerObject<ServerUserEntity> {
  get _id(): string {
    return (this as any).data?._id?.toString() ?? (this as any).entry?._id?.toString();
  }

  @classProp
  public name!: string;

  @classProp
  public role!: string;
}

class ServerProjectEntity extends AutoUpdatedServerObject<ServerProjectEntity> {
  get _id(): string {
    return (this as any).data?._id?.toString() ?? (this as any).entry?._id?.toString();
  }

  @classProp
  public title!: string;

  @classProp
  public status!: string;

  @classProp
  public ownerId!: string;
}

class ServerAuditEntity extends AutoUpdatedServerObject<ServerAuditEntity> {
  get _id(): string {
    return (this as any).data?._id?.toString() ?? (this as any).entry?._id?.toString();
  }

  @classProp
  public action!: string;
}

// Client Entity Classes
class ClientUserEntity extends AutoUpdatedClientObject<any> {
  @classProp
  public name!: string;

  @classProp
  public role!: string;

  get _id(): string {
    return (this as any).data?._id?.toString();
  }
}

class ClientProjectEntity extends AutoUpdatedClientObject<any> {
  @classProp
  public title!: string;

  @classProp
  public status!: string;

  @classProp
  public ownerId!: string;

  get _id(): string {
    return (this as any).data?._id?.toString();
  }
}

class ClientAuditEntity extends AutoUpdatedClientObject<any> {
  @classProp
  public action!: string;

  get _id(): string {
    return (this as any).data?._id?.toString();
  }
}

describe("Domain 2: Lifecycle, Versioning, Permissions & Handshakes", () => {
  let loggers: LoggersType;
  let serverEmitter: EventEmitter;
  let clientEmitter: EventEmitter;

  beforeEach(() => {
    globalCache.clear();
    loggers = createTestLoggers();
    serverEmitter = new EventEmitter();
    clientEmitter = new EventEmitter();
  });

  afterEach(() => {
    globalCache.clear();
    jest.clearAllMocks();
  });

  describe("F04 + F05: Server and Client Manager Lifecycle Handshake", () => {
    test("completes parallel multi-manager server preLoad and client startup handshake", async () => {
      // Initialize mock database records.
      const userModel = createMockModel([
        { _id: "user-1", name: "Alice", role: "admin" },
        { _id: "user-2", name: "Bob", role: "developer" },
      ]);
      const projectModel = createMockModel([
        { _id: "proj-1", title: "Project Alpha", status: "active", ownerId: "user-1" },
      ]);
      const auditModel = createMockModel([]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      serverManagers.User = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.Project = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.Audit = new AutoUpdateServerManager(
        ServerAuditEntity,
        "Audit",
        mockServer as any,
        loggers,
        auditModel,
        serverManagers,
        serverEmitter,
      );

      // Preload server managers in parallel.
      await Promise.all([
        serverManagers.User.preLoad(),
        serverManagers.Project.preLoad(),
        serverManagers.Audit.preLoad(),
      ]);

      // Resolve references across all server managers.
      await Promise.all([
        serverManagers.User.loadReferences(),
        serverManagers.Project.loadReferences(),
        serverManagers.Audit.loadReferences(),
      ]);

      expect(serverManagers.User.isLoaded).toBe(true);
      expect(serverManagers.Project.isLoaded).toBe(true);
      expect(serverManagers.Audit.isLoaded).toBe(true);

      // Connect client and server sockets.
      const pair = createMockSocketPair({ role: "admin" });
      serverManagers.User.registerSocket(pair.serverSocket as any);
      serverManagers.Project.registerSocket(pair.serverSocket as any);
      serverManagers.Audit.registerSocket(pair.serverSocket as any);

      // Initialize client managers via AUCManagerFactory.
      const progressUpdates: number[] = [];
      const clientManagers = await AUCManagerFactory(
        {
          User: ClientUserEntity,
          Project: ClientProjectEntity,
          Audit: ClientAuditEntity,
        },
        loggers,
        pair.clientSocket as any,
        false,
        clientEmitter,
        {
          progress: (p: number) => progressUpdates.push(p),
        },
      );

      // Verify client managers loaded data correctly.
      expect(clientManagers.User.isLoaded).toBe(true);
      expect(clientManagers.Project.isLoaded).toBe(true);
      expect(clientManagers.Audit.isLoaded).toBe(true);

      expect(clientManagers.User.objectIDs).toEqual(["user-1", "user-2"]);
      expect(clientManagers.Project.objectIDs).toEqual(["proj-1"]);
      expect(clientManagers.Audit.objectIDs).toEqual([]);

      // Verify progress aggregation started at 0 and reached 1.
      expect(progressUpdates[0]).toBe(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1);

      // Clean up client managers.
      clientManagers.User.close();
      clientManagers.Project.close();
      clientManagers.Audit.close();
    });

    test("handles empty manager collection immediately without hanging reference promises", async () => {
      // Initialize empty model.
      const emptyModel = createMockModel([]);
      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const emptyManager = new AutoUpdateServerManager(
        ServerAuditEntity,
        "Audit",
        mockServer as any,
        loggers,
        emptyModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.Audit = emptyManager;

      // Preload and load references on empty manager.
      await emptyManager.preLoad();
      await emptyManager.loadReferences();

      expect(emptyManager.isLoaded).toBe(true);
      expect(emptyManager.objectIDs.length).toBe(0);

      const pair = createMockSocketPair();
      emptyManager.registerSocket(pair.serverSocket as any);

      const clientAuditManager = new AutoUpdateClientManager(
        ClientAuditEntity,
        "Audit",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      await clientAuditManager.loadFromServer();

      expect(clientAuditManager.isLoaded).toBe(true);
      expect(clientAuditManager.objectIDs.length).toBe(0);

      clientAuditManager.close();
    });
  });

  describe("F04 + F12: Server Version Verification Handshake", () => {
    test("rejects client handshake with major version mismatch returning VERSION_MISMATCH", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();
      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      // Client sends incompatible major version.
      let response: ServerResponse<unknown> | null = null;
      await new Promise<void>((resolve) => {
        pair.clientSocket.emit(
          EVENT_STARTUP + "User",
          { clientVersion: "99.0.0" },
          (res: ServerResponse<unknown>) => {
            response = res;
            resolve();
          },
        );
      });

      expect(response).toBeDefined();
      expect(response!.success).toBe(false);
      expect((response as any).code).toBe(DEMErrorCode.VERSION_MISMATCH);
      expect(response!.message).toContain("Incompatible major DEM version");
    });

    test("rejects client handshake with minor version mismatch returning VERSION_MISMATCH", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();
      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      // Client sends incompatible minor version.
      let response: ServerResponse<unknown> | null = null;
      await new Promise<void>((resolve) => {
        pair.clientSocket.emit(
          EVENT_STARTUP + "User",
          { clientVersion: "0.1.0" },
          (res: ServerResponse<unknown>) => {
            response = res;
            resolve();
          },
        );
      });

      expect(response).toBeDefined();
      expect(response!.success).toBe(false);
      expect((response as any).code).toBe(DEMErrorCode.VERSION_MISMATCH);
      expect(response!.message).toContain("Incompatible minor DEM version");
    });

    test("accepts client handshake with compatible patch version difference", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();
      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      // Client sends compatible patch version.
      let response: ServerResponse<unknown> | null = null;
      await new Promise<void>((resolve) => {
        pair.clientSocket.emit(
          EVENT_STARTUP + "User",
          { clientVersion: "0.10.0" },
          (res: ServerResponse<unknown>) => {
            response = res;
            resolve();
          },
        );
      });

      expect(response).toBeDefined();
      expect(response!.success).toBe(true);
      expect((response as any).data.ids).toEqual(["u-1"]);
    });
  });

  describe("F04 + F13: Server Lifecycle and Dynamic Access Control", () => {
    test("populates knownObjectIdsBySocket for client socket via startupMiddleware", async () => {
      const projectModel = createMockModel([
        { _id: "p-1", title: "Public Project", status: "published", ownerId: "user-1" },
        { _id: "p-2", title: "Secret Project", status: "private", ownerId: "user-1" },
        { _id: "p-3", title: "Draft Project", status: "draft", ownerId: "user-2" },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const projectManager = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              const authRole = socket.handshake.auth.role;
              if (authRole === "admin") return objects;
              // Guest only sees published projects
              return objects.filter((o) => (o as any).status === "published");
            },
          },
        },
      );
      serverManagers.Project = projectManager;

      await projectManager.preLoad();

      // Connect guest socket.
      const guestPair = createMockSocketPair({ role: "guest" });
      projectManager.registerSocket(guestPair.serverSocket as any);

      let guestResponse: any = null;
      await new Promise<void>((resolve) => {
        guestPair.clientSocket.emit(
          EVENT_STARTUP + "Project",
          { clientVersion: DEM_CLIENT_VERSION },
          (res: any) => {
            guestResponse = res;
            resolve();
          },
        );
      });

      expect(guestResponse.success).toBe(true);
      expect(guestResponse.data.ids).toEqual(["p-1"]);

      // Verify knownObjectIdsBySocket tracks filtered ID.
      const known = (projectManager as any).knownObjectIdsBySocket.get(
        guestPair.serverSocket as any,
      );
      expect(known).toBeDefined();
      expect(known.has("p-1")).toBe(true);
      expect(known.has("p-2")).toBe(false);
      expect(known.has("p-3")).toBe(false);
    });

    test("updates socket visibility dynamically on permission boundary evaluation", async () => {
      const projectModel = createMockModel([
        { _id: "p-1", title: "Private Project", status: "private", ownerId: "user-1" },
      ]);

      const mockServer = createMockSocketServer();
      const projectManager = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        {},
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              const authRole = socket.handshake.auth.role;
              if (authRole === "admin") return objects;
              return objects.filter((o) => (o as any).status === "published");
            },
          },
        },
      );

      await projectManager.preLoad();

      const guestPair = createMockSocketPair({ role: "guest" });
      projectManager.registerSocket(guestPair.serverSocket as any);

      // Perform initial startup for guest.
      await new Promise<void>((resolve) => {
        guestPair.clientSocket.emit(
          EVENT_STARTUP + "Project",
          { clientVersion: DEM_CLIENT_VERSION },
          () => resolve(),
        );
      });

      const guestKnown = (projectManager as any).knownObjectIdsBySocket.get(
        guestPair.serverSocket as any,
      );
      expect(guestKnown.has("p-1")).toBe(false);

      // Listen for dynamic new and delete events on client.
      const newListener = jest.fn();
      const deleteListener = jest.fn();
      guestPair.clientSocket.on("newProject", newListener);
      guestPair.clientSocket.on("deleteProject", deleteListener);

      const serverObj = projectManager.getObject("p-1")!;
      expect(serverObj).toBeDefined();

      // Mutate project to published and evaluate permission boundaries.
      (serverObj as any).status = "published";
      (serverObj as any).data.status = "published";
      await projectManager.checkPermissionBoundaries(serverObj);

      expect(newListener).toHaveBeenCalled();
      expect(guestKnown.has("p-1")).toBe(true);

      // Revoke access by setting status back to private.
      (serverObj as any).status = "private";
      (serverObj as any).data.status = "private";
      await projectManager.checkPermissionBoundaries(serverObj);

      expect(deleteListener).toHaveBeenCalledWith("p-1");
      expect(guestKnown.has("p-1")).toBe(false);
    });

    test("clears socket registry and authorized identifiers on client disconnect", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();
      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      await new Promise<void>((resolve) => {
        pair.clientSocket.emit(
          EVENT_STARTUP + "User",
          { clientVersion: DEM_CLIENT_VERSION },
          () => resolve(),
        );
      });

      expect(serverManager.clientSockets.has(pair.serverSocket as any)).toBe(true);
      expect((serverManager as any).knownObjectIdsBySocket.has(pair.serverSocket as any)).toBe(
        true,
      );

      // Trigger socket disconnect.
      pair.clientSocket.disconnect();

      expect(serverManager.clientSockets.has(pair.serverSocket as any)).toBe(false);
      expect((serverManager as any).knownObjectIdsBySocket.has(pair.serverSocket as any)).toBe(
        false,
      );
    });
  });

  describe("F05 + F12: Client Version Verification System", () => {
    test("rejects startup when server returns incompatible minor version", async () => {
      const onMismatchSpy = jest.fn();
      const mockSocket = {
        emit: jest.fn((event: string, _data: unknown, cb: Function) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["name", "role"],
                version: "0.1.0",
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      };

      const clientManager = new AutoUpdateClientManager(
        ClientUserEntity,
        "User",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
        { onVersionMismatch: onMismatchSpy },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(
        /Incompatible minor DEM version/,
      );
      expect(onMismatchSpy).toHaveBeenCalled();
    });

    test("rejects startup when strict version match is required but server version is missing", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: unknown, cb: Function) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["name", "role"],
                version: undefined,
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      };

      const strictManager = new AutoUpdateClientManager(
        ClientUserEntity,
        "User",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
        { strictVersionMatch: true },
      );

      await expect(strictManager.loadFromServer()).rejects.toThrow(
        /Strict DEM version match required/,
      );
    });

    test("permits startup when loose version match allows missing server version", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: unknown, cb: Function) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["name", "role"],
                version: undefined,
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      };

      const looseManager = new AutoUpdateClientManager(
        ClientUserEntity,
        "User",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
        { strictVersionMatch: false },
      );

      await expect(looseManager.loadFromServer()).resolves.toBeUndefined();
      expect(looseManager.isLoaded).toBe(true);
    });
  });

  describe("F05 + F13: Client Progress Aggregation and Filtered Visibility", () => {
    test("aggregates progress smoothly across multiple managers with unequal counts and empty manager", async () => {
      const recordedProgress: number[] = [];
      const mockSocket = {
        emit: jest.fn((event: string, _data: unknown, cb: Function) => {
          if (event === "startupUser") {
            cb({
              success: true,
              data: {
                ids: ["u1", "u2", "u3", "u4", "u5"],
                objects: [
                  { _id: "u1", name: "User 1", role: "dev" },
                  { _id: "u2", name: "User 2", role: "dev" },
                  { _id: "u3", name: "User 3", role: "dev" },
                  { _id: "u4", name: "User 4", role: "dev" },
                  { _id: "u5", name: "User 5", role: "dev" },
                ],
                properties: ["name", "role"],
                version: DEM_VERSION,
              },
            });
          } else if (event === "startupProject") {
            cb({
              success: true,
              data: {
                ids: ["p1"],
                objects: [{ _id: "p1", title: "Single Project", status: "active", ownerId: "u1" }],
                properties: ["title", "status", "ownerId"],
                version: DEM_VERSION,
              },
            });
          } else if (event === "startupAudit") {
            cb({
              success: true,
              data: {
                ids: [],
                objects: [],
                properties: ["action"],
                version: DEM_VERSION,
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      };

      const managers = await AUCManagerFactory(
        {
          User: ClientUserEntity,
          Project: ClientProjectEntity,
          Audit: ClientAuditEntity,
        },
        loggers,
        mockSocket as any,
        false,
        clientEmitter,
        {
          progress: (p: number) => recordedProgress.push(p),
        },
      );

      expect(recordedProgress[0]).toBe(0);
      expect(recordedProgress[recordedProgress.length - 1]).toBe(1);

      // Verify progress monotonicity.
      for (let i = 1; i < recordedProgress.length; i++) {
        expect(recordedProgress[i]).toBeGreaterThanOrEqual(recordedProgress[i - 1]);
      }

      managers.User.close();
      managers.Project.close();
      managers.Audit.close();
    });

    test("populates only permitted entities into client manager and global cache", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: unknown, cb: Function) => {
          if (event === "startupProject") {
            cb({
              success: true,
              data: {
                ids: ["p-public"],
                objects: [
                  { _id: "p-public", title: "Public", status: "published", ownerId: "u1" },
                ],
                properties: ["title", "status", "ownerId"],
                version: DEM_VERSION,
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      };

      const clientManager = new AutoUpdateClientManager(
        ClientProjectEntity,
        "Project",
        mockSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      await clientManager.loadFromServer();

      expect(clientManager.objectIDs).toEqual(["p-public"]);
      expect(globalCache.objects["p-public"]).toBeDefined();
      expect(globalCache.objects["p-private"]).toBeUndefined();

      clientManager.close();
    });
  });

  describe("F12 + F13: Version Negotiation and Access Control Precedence", () => {
    test("rejects client version mismatch before executing socket authorization middleware", async () => {
      const middlewareSpy = jest.fn(async (objects: any) => objects);
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();

      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: middlewareSpy,
          },
        },
      );

      await serverManager.preLoad();

      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      let response: any = null;
      await new Promise<void>((resolve) => {
        pair.clientSocket.emit(
          EVENT_STARTUP + "User",
          { clientVersion: "0.2.0" }, // Incompatible minor version
          (res: any) => {
            response = res;
            resolve();
          },
        );
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe(DEMErrorCode.VERSION_MISMATCH);
      // Verify middleware was bypassed completely.
      expect(middlewareSpy).not.toHaveBeenCalled();
    });

    test("rejects unwhitelisted dynamic event with UNDEFINED_EVENT code", async () => {
      const userModel = createMockModel();
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      // Attach packet middleware checking whitelisted event names.
      pair.serverSocket.use!((packet: unknown[], next: Function) => {
        const eventName = packet[0] as string;
        const ack = packet[2] as Function;
        if (!pair.serverSocket.eventNames().includes(eventName)) {
          if (typeof ack === "function") {
            ack({
              success: false,
              code: DEMErrorCode.UNDEFINED_EVENT,
              message: "Undefined event: " + eventName,
            });
          }
          return;
        }
        next();
      });

      let response: any = null;
      await new Promise<void>((resolve) => {
        pair.clientSocket.emit("nonExistentCustomEvent", {}, (res: any) => {
          response = res;
          resolve();
        });
      });

      expect(response).toBeDefined();
      expect(response.success).toBe(false);
      expect(response.code).toBe(DEMErrorCode.UNDEFINED_EVENT);
    });
  });

  describe("F04 + F05 + F12 Triplet: Server, Client, and Version Verification Handshake", () => {
    test("coordinates multi-manager startup and verifies semver agreement end-to-end", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const projectModel = createMockModel([
        { _id: "p-1", title: "Project Alpha", status: "active", ownerId: "u-1" },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      serverManagers.User = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.Project = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
      );

      await serverManagers.User.preLoad();
      await serverManagers.Project.preLoad();
      await serverManagers.User.loadReferences();
      await serverManagers.Project.loadReferences();

      const pair = createMockSocketPair();
      serverManagers.User.registerSocket(pair.serverSocket as any);
      serverManagers.Project.registerSocket(pair.serverSocket as any);

      const clientManagers = await AUCManagerFactory(
        { User: ClientUserEntity, Project: ClientProjectEntity },
        loggers,
        pair.clientSocket as any,
        false,
        clientEmitter,
      );

      expect(clientManagers.User.isLoaded).toBe(true);
      expect(clientManagers.Project.isLoaded).toBe(true);
      expect(clientManagers.User.getObject("u-1")).toBeDefined();
      expect(clientManagers.Project.getObject("p-1")).toBeDefined();

      clientManagers.User.close();
      clientManagers.Project.close();
    });

    test("cleans client resources when server rejects version during factory initialization", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();
      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      // Override client emit to send incompatible version
      const originalEmit = pair.clientSocket.emit;
      pair.clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        if (event === "startupUser" && typeof args[0] === "object") {
          args[0].clientVersion = "99.0.0";
        }
        originalEmit(event, ...args);
      }) as any;

      const clientManager = new AutoUpdateClientManager(
        ClientUserEntity,
        "User",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(
        /Incompatible major DEM version/,
      );

      // Verify no dangling entities created on client
      expect(clientManager.objectIDs.length).toBe(0);
      expect(clientManager.getObject("u-1")).toBeUndefined();
    });
  });

  describe("F04 + F05 + F13 Triplet: Multi-Manager Lifecycle and Dynamic Access Control", () => {
    test("isolates multiple client sockets with distinct permissions across multiple managers", async () => {
      const userModel = createMockModel([
        { _id: "u-admin", name: "Admin User", role: "admin" },
        { _id: "u-dev", name: "Dev User", role: "developer" },
      ]);
      const projectModel = createMockModel([
        { _id: "p-all", title: "General Project", status: "published", ownerId: "u-admin" },
        { _id: "p-confidential", title: "Secret Project", status: "secret", ownerId: "u-admin" },
      ]);

      const mockServer = createMockSocketServer();
      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      serverManagers.User = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        serverManagers,
        serverEmitter,
      );
      serverManagers.Project = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        serverManagers,
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              if (socket.handshake.auth.role === "admin") return objects;
              return objects.filter((p) => (p as any).status !== "secret");
            },
          },
        },
      );

      await serverManagers.User.preLoad();
      await serverManagers.Project.preLoad();

      // Pair 1: Admin socket
      const adminPair = createMockSocketPair({ role: "admin" });
      serverManagers.User.registerSocket(adminPair.serverSocket as any);
      serverManagers.Project.registerSocket(adminPair.serverSocket as any);

      // Pair 2: Developer socket
      const devPair = createMockSocketPair({ role: "developer" });
      serverManagers.User.registerSocket(devPair.serverSocket as any);
      serverManagers.Project.registerSocket(devPair.serverSocket as any);

      // Initialize both clients
      const adminClients = await AUCManagerFactory(
        { User: ClientUserEntity, Project: ClientProjectEntity },
        loggers,
        adminPair.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const devClients = await AUCManagerFactory(
        { User: ClientUserEntity, Project: ClientProjectEntity },
        loggers,
        devPair.clientSocket as any,
        false,
        new EventEmitter(),
      );

      expect(adminClients.Project.objectIDs).toContain("p-confidential");
      expect(adminClients.Project.objectIDs).toContain("p-all");

      expect(devClients.Project.objectIDs).toContain("p-all");
      expect(devClients.Project.objectIDs).not.toContain("p-confidential");

      adminClients.User.close();
      adminClients.Project.close();
      devClients.User.close();
      devClients.Project.close();
    });

    test("purges memory cache and socket listeners on client deauthentication", async () => {
      const userModel = createMockModel([{ _id: "u-1", name: "Alice", role: "admin" }]);
      const mockServer = createMockSocketServer();
      const serverManager = new AutoUpdateServerManager(
        ServerUserEntity,
        "User",
        mockServer as any,
        loggers,
        userModel,
        {},
        serverEmitter,
      );

      await serverManager.preLoad();

      const pair = createMockSocketPair({ role: "admin" });
      serverManager.registerSocket(pair.serverSocket as any);

      const deauthSpy = jest.fn();
      clientEmitter.on(EVENT_DEAUTHENTICATE, deauthSpy);

      const clientManager = new AutoUpdateClientManager(
        ClientUserEntity,
        "User",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      await clientManager.loadFromServer();
      expect(clientManager.objectIDs).toContain("u-1");
      expect(globalCache.objects["u-1"]).toBeDefined();

      // Trigger deauthentication from server
      serverManager.deauthenticate(pair.serverSocket as any, "Token expired");

      expect(deauthSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "Token expired" }),
      );

      // Assert memory and cache purged
      expect(clientManager.objectIDs.length).toBe(0);
      expect(globalCache.objects["u-1"]).toBeUndefined();
    });
  });

  describe("F05 + F12 + F13 Triplet: Client Startup, Versioning, and Access Control", () => {
    test("aborts client startup when authorization middleware throws ACCESS_DENIED error", async () => {
      const projectModel = createMockModel([{ _id: "p-1", title: "Secret", status: "locked" }]);
      const mockServer = createMockSocketServer();

      const serverManager = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        {},
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (_objects, _managers, socket) => {
              if (socket.handshake.auth.role !== "admin") {
                throw new DEMError(
                  DEMErrorCode.ACCESS_DENIED,
                  "Access denied to restricted collection",
                );
              }
              return _objects;
            },
          },
        },
      );

      await serverManager.preLoad();

      const guestPair = createMockSocketPair({ role: "guest" });
      serverManager.registerSocket(guestPair.serverSocket as any);

      const clientManager = new AutoUpdateClientManager(
        ClientProjectEntity,
        "Project",
        guestPair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(
        /Access denied to restricted collection/,
      );

      expect(clientManager.isLoaded).toBe(false);
      expect(clientManager.objectIDs.length).toBe(0);

      clientManager.close();
    });

    test("re-authenticates and re-evaluates permissions on socket reconnect", async () => {
      const projectModel = createMockModel([
        { _id: "p-1", title: "Public", status: "published", ownerId: "u1" },
      ]);
      const mockServer = createMockSocketServer();

      let isAllowed = false;
      const serverManager = new AutoUpdateServerManager(
        ServerProjectEntity,
        "Project",
        mockServer as any,
        loggers,
        projectModel,
        {},
        serverEmitter,
        {
          accessDefinitions: {
            startupMiddleware: async (objects) => {
              return isAllowed ? objects : [];
            },
          },
        },
      );

      await serverManager.preLoad();

      const pair = createMockSocketPair();
      serverManager.registerSocket(pair.serverSocket as any);

      const clientManager = new AutoUpdateClientManager(
        ClientProjectEntity,
        "Project",
        pair.clientSocket as any,
        loggers,
        {},
        clientEmitter,
        { progress: jest.fn() },
      );

      // First load: not allowed
      await clientManager.loadFromServer();
      expect(clientManager.objectIDs.length).toBe(0);

      // Update permissions and trigger reconnect
      isAllowed = true;
      await (pair.clientSocket as any).triggerLocalEvent("reconnect");

      expect(clientManager.objectIDs).toContain("p-1");

      clientManager.close();
    });
  });
});
