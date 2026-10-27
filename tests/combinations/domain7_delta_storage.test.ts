import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import {
  AutoUpdatedClientObject,
  DEM_RAW_ARRAY,
} from "../../AutoUpdatedClientObjectClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  classProp,
  populatedRef,
  globalCache,
  DEM_CLIENT_VERSION,
  DEM_VERSION,
  DEM_PROTOCOL_VERSION,
  DEMArray,
  LoggersType,
  DEMClientCallbacks,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";
import { ClientStateReconciler } from "../../sync/ClientStateReconciler.js";
import { ServerChangeTracker } from "../../sync/ServerChangeTracker.js";
import { MemoryStorageAdapter } from "../../sync/storage/MemoryStorageAdapter.js";
import {
  LocalStorageAdapter,
  LocalStorageAdapterOptions,
} from "../../sync/storage/LocalStorageAdapter.js";
import {
  ChangeEntry,
  DeltaSyncPayload,
  StoredManagerState,
} from "../../sync/types.js";

// ============================================================================
// Entity Test Models
// ============================================================================

/**
 * Client entity model for task item with relational back-reference.
 */
class Domain7TaskClient extends AutoUpdatedClientObject<any> {
  declare title: string;
  declare status: string;
  declare project: any;

  get _id() {
    return (this as any).data?._id;
  }

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "title", "status", "project"], Domain7TaskClient.prototype);
Reflect.defineMetadata("isRef", true, Domain7TaskClient.prototype, "project");
Reflect.defineMetadata("refsTo", "Domain7ProjectClient:tasks", Domain7TaskClient.prototype, "project");

/**
 * Client entity model for project containing primitive and relational arrays.
 */
class Domain7ProjectClient extends AutoUpdatedClientObject<any> {
  declare name: string;
  declare tags: string[];
  declare tasks: Domain7TaskClient[];

  get _id() {
    return (this as any).data?._id;
  }

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "name", "tags", "tasks"], Domain7ProjectClient.prototype);
Reflect.defineMetadata("isRef", true, Domain7ProjectClient.prototype, "tasks");
Reflect.defineMetadata("refsTo", "Domain7TaskClient", Domain7ProjectClient.prototype, "tasks");

/**
 * Server entity model for project mutation and change tracking.
 */
class Domain7ProjectServer extends AutoUpdatedServerObject<any> {
  declare name: string;
  declare tags: string[];
  declare tasks: string[];

  get _id() {
    return (this as any).data?._id;
  }
}
Reflect.defineMetadata("props", ["_id", "name", "tags", "tasks"], Domain7ProjectServer.prototype);
Reflect.defineMetadata("isRef", true, Domain7ProjectServer.prototype, "tasks");
Reflect.defineMetadata("refsTo", "Domain7TaskClient", Domain7ProjectServer.prototype, "tasks");

// ============================================================================
// Helper Types & Mock Functions
// ============================================================================

/**
 * Controllable mock socket interface for tests.
 */
interface MockSocket {
  id: string;
  connected: boolean;
  on: jest.Mock;
  off: jest.Mock;
  emit: jest.Mock;
  trigger(event: string, ...args: unknown[]): void;
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
}

/**
 * Creates mock logger interface for testing.
 *
 * @returns Mock logger object with jest mock functions.
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
 * Creates mock manager callbacks for testing.
 *
 * @returns Mock callbacks bundle.
 */
function createMockCallbacks(): DEMClientCallbacks<any> {
  return {
    new: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    progress: jest.fn(),
  };
}

/**
 * Creates controllable mock socket for client tests.
 *
 * @param customEmitHandler - Optional emit interceptor function.
 * @returns MockSocket instance.
 */
function createMockSocket(
  customEmitHandler?: (
    event: string,
    payload: unknown,
    ack?: (response: unknown) => void,
  ) => void,
): MockSocket {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const mock: MockSocket = {
    id: "mock_client_socket",
    connected: true,
    handlers,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
      return mock;
    }),
    off: jest.fn((event: string, handler?: (...args: unknown[]) => void) => {
      if (!handler) {
        delete handlers[event];
      } else if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
      return mock;
    }),
    emit: jest.fn((event: string, ...args: unknown[]) => {
      const ack =
        typeof args[args.length - 1] === "function"
          ? (args[args.length - 1] as (response: unknown) => void)
          : undefined;
      const payload =
        args.length > 1 && typeof args[0] !== "function" ? args[0] : undefined;
      if (customEmitHandler) {
        customEmitHandler(event, payload, ack);
      } else if (ack) {
        ack({ success: true, message: "OK" });
      }
    }),
    trigger: (event: string, ...args: unknown[]) => {
      if (handlers[event]) {
        for (const h of handlers[event]) {
          h(...args);
        }
      }
    },
  };
  return mock;
}

/**
 * In-memory storage backend conforming to LocalStorage interface.
 */
interface MockStorageBackend {
  store: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  length: number;
}

/**
 * Creates in-memory mock storage backend for LocalStorageAdapter tests.
 *
 * @returns MockStorageBackend instance.
 */
function createMockStorageBackend(): MockStorageBackend {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: jest.fn((key: string): string | null => store[key] ?? null),
    setItem: jest.fn((key: string, value: string): void => {
      store[key] = String(value);
    }),
    removeItem: jest.fn((key: string): void => {
      delete store[key];
    }),
    clear: jest.fn((): void => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    }),
    key: jest.fn((index: number): string | null => {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    }),
    get length(): number {
      return Object.keys(store).length;
    },
  };
}

/**
 * Helper to build server project entity with change tracker and mock model.
 *
 * @param id - Entity identifier.
 * @param initialData - Initial entity state.
 * @param tracker - ServerChangeTracker instance.
 * @param emitter - Shared event emitter.
 * @param loggers - Logger instance.
 * @returns Server project object and mock model.
 */
function createServerProjectHelper(
  id: string,
  initialData: { name: string; tags: string[]; tasks?: string[] },
  tracker: ServerChangeTracker,
  emitter: EventEmitter,
  loggers: LoggersType,
) {
  const mockModel: any = {
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };
  const mockServerMgr: any = {
    className: "Domain7ProjectClient",
    model: mockModel,
    managers: {},
    changeTracker: tracker,
  };
  const serverSocket: any = {
    emit: jest.fn(),
  };
  const serverProject = new Domain7ProjectServer(
    Domain7ProjectServer,
    serverSocket,
    { _id: id, ...initialData },
    loggers,
    "Domain7ProjectClient",
    mockServerMgr,
    emitter,
  );
  return { serverProject, mockModel, serverSocket };
}

// ============================================================================
// Test Suite: Domain 7 DEMArray + Delta Sync & Persistent Storage
// ============================================================================

describe("Domain 7: DEMArray Reactive Arrays with Delta Sync & Storage Adapters", () => {
  let emitter: EventEmitter;
  let loggers: LoggersType;
  let callbacks: DEMClientCallbacks<any>;

  beforeEach(() => {
    delete (Domain7TaskClient as any).__metaCache;
    delete (Domain7ProjectClient as any).__metaCache;
    delete (Domain7ProjectServer as any).__metaCache;
    globalCache.clear();
    emitter = new EventEmitter();
    loggers = createMockLoggers();
    callbacks = createMockCallbacks();
  });

  // ==========================================================================
  // Section 1: Delta Sync Tracking & Reconnection Reconciliation
  // ==========================================================================
  describe("Section 1: Delta Sync Tracking & Reconnection Reconciliation", () => {
    it("records sequential revisions in ServerChangeTracker during server array mutations", async () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 50 });
      const { serverProject, mockModel } = createServerProjectHelper(
        "proj-1",
        { name: "Alpha Project", tags: ["v1.0"], tasks: [] },
        tracker,
        emitter,
        loggers,
      );

      // Execute push mutation
      const pushRes = await serverProject.mutateArray("tags", {
        key: "tags",
        op: "push",
        items: ["v2.0", "v3.0"],
      });
      expect(pushRes.success).toBe(true);
      expect(pushRes.updatedArray).toEqual(["v1.0", "v2.0", "v3.0"]);
      expect(pushRes.newRevision).toBe(1);
      expect(tracker.getCurrentRevision()).toBe(1);

      // Execute splice mutation
      const spliceRes = await serverProject.mutateArray("tags", {
        key: "tags",
        op: "splice",
        index: 1,
        deleteCount: 1,
        items: ["v2.5"],
      });
      expect(spliceRes.success).toBe(true);
      expect(spliceRes.updatedArray).toEqual(["v1.0", "v2.5", "v3.0"]);
      expect(spliceRes.newRevision).toBe(2);
      expect(tracker.getCurrentRevision()).toBe(2);

      // Execute set mutation
      const setRes = await serverProject.mutateArray("tags", {
        key: "tags",
        op: "set",
        index: 0,
        items: ["v1.1"],
      });
      expect(setRes.success).toBe(true);
      expect(setRes.updatedArray).toEqual(["v1.1", "v2.5", "v3.0"]);
      expect(setRes.newRevision).toBe(3);
      expect(tracker.getCurrentRevision()).toBe(3);

      // Verify recorded change entries
      const changesResult = tracker.getChangesSince(0);
      expect(changesResult.isExpired).toBe(false);
      expect(changesResult.changes.length).toBe(3);
      expect(changesResult.changes[0].revision).toBe(1);
      expect(changesResult.changes[0].data).toEqual({ tags: ["v1.0", "v2.0", "v3.0"] });
      expect(changesResult.changes[1].revision).toBe(2);
      expect(changesResult.changes[1].data).toEqual({ tags: ["v1.0", "v2.5", "v3.0"] });
      expect(changesResult.changes[2].revision).toBe(3);
      expect(changesResult.changes[2].data).toEqual({ tags: ["v1.1", "v2.5", "v3.0"] });
      expect(mockModel.updateOne).toHaveBeenCalledTimes(3);
    });

    it("reconciles primitive DEMArray on client reconnecting with lastRevision", async () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 50 });
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      const clientManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      // Initial state load
      const initialProject = new Domain7ProjectClient(
        Domain7ProjectClient,
        mockSocket,
        { _id: "proj-1", name: "Project One", tags: ["tag-alpha"], tasks: [] },
        loggers,
        "Domain7ProjectClient",
        clientManager,
        callbacks,
        emitter,
      );
      (clientManager as any).objects_["proj-1"] = initialProject;
      globalCache.objects["proj-1"] = {
        className: "Domain7ProjectClient",
        object: initialProject as any,
      };
      clientManager.totalObjects = 1;
      clientManager.loadedObjects = 1;
      clientManager.lastRevision = 1;

      // Persist snapshot to storage adapter
      await ClientStateReconciler.persistToStorage(clientManager as any, 1, storageAdapter);

      // Disconnect client and execute server mutations
      const { serverProject } = createServerProjectHelper(
        "proj-1",
        { name: "Project One", tags: ["tag-alpha"], tasks: [] },
        tracker,
        emitter,
        loggers,
      );

      // Advance tracker past initial revision
      tracker.recordChange("create", "proj-1", { tags: ["tag-alpha"] }); // rev 1
      await serverProject.mutateArray("tags", {
        key: "tags",
        op: "push",
        items: ["tag-beta"],
      }); // rev 2
      await serverProject.mutateArray("tags", {
        key: "tags",
        op: "push",
        items: ["tag-gamma"],
      }); // rev 3

      expect(tracker.getCurrentRevision()).toBe(3);
      const changesSinceRev1 = tracker.getChangesSince(1);
      expect(changesSinceRev1.changes.length).toBe(2);

      // Reconnect client with lastRevision: 1
      const deltaPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 3,
        changes: changesSinceRev1.changes,
        ids: [],
        properties: ["_id", "name", "tags", "tasks"],
      };

      await ClientStateReconciler.applyDelta(
        clientManager as any,
        deltaPayload,
        storageAdapter,
      );

      // Verify reconciled DEMArray on client
      const reconciledProject = clientManager.getObject("proj-1");
      expect(reconciledProject).toBeDefined();

      const tags = reconciledProject!.tags as unknown as DEMArray<string>;
      expect(tags.length).toBe(3);
      expect(tags[0]).toBe("tag-alpha");
      expect(tags[1]).toBe("tag-beta");
      expect(tags[2]).toBe("tag-gamma");
      expect(tags.includes("tag-beta")).toBe(true);
      expect(tags.map((t) => t.toUpperCase())).toEqual([
        "TAG-ALPHA",
        "TAG-BETA",
        "TAG-GAMMA",
      ]);
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual([
        "tag-alpha",
        "tag-beta",
        "tag-gamma",
      ]);

      // Verify updated storage snapshot
      const storedState = await storageAdapter.loadManagerState("Domain7ProjectClient");
      expect(storedState).toBeDefined();
      expect(storedState?.revision).toBe(3);
      expect(storedState?.objects[0].tags).toEqual([
        "tag-alpha",
        "tag-beta",
        "tag-gamma",
      ]);
    });

    it("reconciles relational DEMArray after server adds child entities and array references", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      const taskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      const projectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        { Domain7TaskClient: taskManager },
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );
      (taskManager.managers as any)["Domain7ProjectClient"] = projectManager;

      // Seed initial project with task-1
      const initialTask = new Domain7TaskClient(
        Domain7TaskClient,
        mockSocket,
        { _id: "task-1", title: "Task One", status: "open", project: "proj-1" },
        loggers,
        "Domain7TaskClient",
        taskManager,
        callbacks,
        emitter,
      );
      (taskManager as any).objects_["task-1"] = initialTask;
      globalCache.objects["task-1"] = {
        className: "Domain7TaskClient",
        object: initialTask as any,
      };

      const initialProject = new Domain7ProjectClient(
        Domain7ProjectClient,
        mockSocket,
        { _id: "proj-1", name: "Project One", tags: [], tasks: ["task-1"] },
        loggers,
        "Domain7ProjectClient",
        projectManager,
        callbacks,
        emitter,
      );
      (projectManager as any).objects_["proj-1"] = initialProject;
      globalCache.objects["proj-1"] = {
        className: "Domain7ProjectClient",
        object: initialProject as any,
      };

      // Disconnect client. Server creates task-2 and appends it to project.tasks
      const taskDelta: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 2,
        changes: [
          {
            revision: 2,
            type: "create",
            id: "task-2",
            data: {
              _id: "task-2",
              title: "Task Two",
              status: "pending",
              project: "proj-1",
            },
            timestamp: Date.now(),
            estimatedBytes: 120,
          },
        ],
      };

      const projectDelta: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 2,
        changes: [
          {
            revision: 2,
            type: "update",
            id: "proj-1",
            data: { tasks: ["task-1", "task-2"] },
            timestamp: Date.now(),
            estimatedBytes: 80,
          },
        ],
      };

      // Apply deltas to taskManager and projectManager
      await ClientStateReconciler.applyDelta(taskManager as any, taskDelta, storageAdapter);
      await ClientStateReconciler.applyDelta(projectManager as any, projectDelta, storageAdapter);

      // Verify relational DEMArray on project
      const tasks = initialProject.tasks as unknown as DEMArray<Domain7TaskClient>;
      expect(tasks.length).toBe(2);
      expect(tasks[0]._id).toBe("task-1");
      expect(tasks[1]._id).toBe("task-2");
      expect(tasks[1].title).toBe("Task Two");
      expect((tasks as any)[DEM_RAW_ARRAY]).toEqual(["task-1", "task-2"]);

      // Verify child back-reference
      const task2 = taskManager.getObject("task-2");
      expect(task2).toBeDefined();
      expect(task2!.project).toBe(initialProject);
    });

    it("preserves DEMArray without change when client reconnects up to date", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDomain7ProjectClient" && ack) {
          ack({
            success: true,
            data: {
              status: "up-to-date",
              revision: 5,
              ids: [],
              properties: ["_id", "name", "tags", "tasks"],
              version: DEM_VERSION,
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        mockSocket,
        { _id: "proj-1", name: "P1", tags: ["fixed-1", "fixed-2"], tasks: [] },
        loggers,
        "Domain7ProjectClient",
        clientManager,
        callbacks,
        emitter,
      );
      (clientManager as any).objects_["proj-1"] = project;
      globalCache.objects["proj-1"] = {
        className: "Domain7ProjectClient",
        object: project as any,
      };
      clientManager.lastRevision = 5;

      await clientManager.loadFromServer();

      expect(clientManager.lastRevision).toBe(5);
      const tags = project.tags as unknown as DEMArray<string>;
      expect(tags.length).toBe(2);
      expect(tags[0]).toBe("fixed-1");
      expect(tags[1]).toBe("fixed-2");
    });
  });

  // ==========================================================================
  // Section 2: Offline Snapshot Storage & Restoration
  // ==========================================================================
  describe("Section 2: Offline Snapshot Storage & Restoration", () => {
    it("persists and restores primitive and relational DEMArray with MemoryStorageAdapter", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      const taskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const projectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        { Domain7TaskClient: taskManager },
        emitter,
        callbacks,
      );
      (taskManager.managers as any)["Domain7ProjectClient"] = projectManager;

      // Seed data
      const task = new Domain7TaskClient(
        Domain7TaskClient,
        mockSocket,
        { _id: "task-mem-1", title: "Memory Task", status: "done", project: "proj-mem" },
        loggers,
        "Domain7TaskClient",
        taskManager,
        callbacks,
        emitter,
      );
      (taskManager as any).objects_["task-mem-1"] = task;
      globalCache.objects["task-mem-1"] = {
        className: "Domain7TaskClient",
        object: task as any,
      };

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        mockSocket,
        {
          _id: "proj-mem",
          name: "Memory Project",
          tags: ["urgent", "backend", "critical"],
          tasks: ["task-mem-1"],
        },
        loggers,
        "Domain7ProjectClient",
        projectManager,
        callbacks,
        emitter,
      );
      (projectManager as any).objects_["proj-mem"] = project;
      globalCache.objects["proj-mem"] = {
        className: "Domain7ProjectClient",
        object: project as any,
      };

      // Save snapshots to MemoryStorageAdapter
      await ClientStateReconciler.persistToStorage(taskManager as any, 10, storageAdapter);
      await ClientStateReconciler.persistToStorage(projectManager as any, 10, storageAdapter);

      // Simulate offline restart with empty caches
      globalCache.clear();
      const offlineSocket = createMockSocket();

      const offlineTaskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        offlineSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const offlineProjectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        offlineSocket as any,
        loggers,
        { Domain7TaskClient: offlineTaskManager },
        emitter,
        callbacks,
      );
      (offlineTaskManager.managers as any)["Domain7ProjectClient"] = offlineProjectManager;

      // Restore states from storage adapter
      const taskRestored = await ClientStateReconciler.restoreFromStorage(
        offlineTaskManager as any,
        storageAdapter,
      );
      const projectRestored = await ClientStateReconciler.restoreFromStorage(
        offlineProjectManager as any,
        storageAdapter,
      );

      expect(taskRestored.restored).toBe(true);
      expect(taskRestored.revision).toBe(10);
      expect(projectRestored.restored).toBe(true);
      expect(projectRestored.revision).toBe(10);

      // Verify restored project entity
      const restoredProject = offlineProjectManager.getObject("proj-mem");
      expect(restoredProject).toBeDefined();

      // Verify primitive DEMArray
      const tags = restoredProject!.tags as unknown as DEMArray<string>;
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(3);
      expect(tags[0]).toBe("urgent");
      expect(tags[1]).toBe("backend");
      expect(tags[2]).toBe("critical");
      expect(tags.map((t) => t.toUpperCase())).toEqual(["URGENT", "BACKEND", "CRITICAL"]);
      expect(tags.find((t) => t.startsWith("b"))).toBe("backend");
      expect(tags.filter((t) => t.length > 6)).toEqual(["backend", "critical"]);
      expect(tags.includes("urgent")).toBe(true);
      expect(tags.indexOf("critical")).toBe(2);
      expect(tags.slice(1, 3)).toEqual(["backend", "critical"]);

      // Verify blocked index assignment on primitive DEMArray
      expect(() => {
        (tags as any)[0] = "illegal-mutation";
      }).toThrow(DEMError);
      expect(() => {
        (tags as any)[0] = "illegal-mutation";
      }).toThrow(/Cannot assign index directly on DEMArray/);

      // Verify DEM_RAW_ARRAY exposes underlying raw array
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual(["urgent", "backend", "critical"]);

      // Verify relational DEMArray
      const tasks = restoredProject!.tasks as unknown as DEMArray<Domain7TaskClient>;
      expect(tasks.length).toBe(1);
      expect(tasks[0]._id).toBe("task-mem-1");
      expect(tasks[0].title).toBe("Memory Task");
      expect(tasks[0].status).toBe("done");

      // Verify blocked index assignment on relational DEMArray
      expect(() => {
        (tasks as any)[0] = {} as any;
      }).toThrow(DEMError);

      // Verify DEM_RAW_ARRAY exposes underlying raw relational IDs
      expect((tasks as any)[DEM_RAW_ARRAY]).toEqual(["task-mem-1"]);
    });

    it("persists and restores primitive and relational DEMArray with LocalStorageAdapter", async () => {
      const storageBackend = createMockStorageBackend();
      const storageAdapter = new LocalStorageAdapter({ storage: storageBackend });
      const mockSocket = createMockSocket();

      const taskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const projectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        { Domain7TaskClient: taskManager },
        emitter,
        callbacks,
      );
      (taskManager.managers as any)["Domain7ProjectClient"] = projectManager;

      // Seed entities
      const task = new Domain7TaskClient(
        Domain7TaskClient,
        mockSocket,
        { _id: "task-ls-1", title: "Storage Task", status: "open", project: "proj-ls" },
        loggers,
        "Domain7TaskClient",
        taskManager,
        callbacks,
        emitter,
      );
      (taskManager as any).objects_["task-ls-1"] = task;
      globalCache.objects["task-ls-1"] = {
        className: "Domain7TaskClient",
        object: task as any,
      };

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        mockSocket,
        {
          _id: "proj-ls",
          name: "Storage Project",
          tags: ["local", "persistent"],
          tasks: ["task-ls-1"],
        },
        loggers,
        "Domain7ProjectClient",
        projectManager,
        callbacks,
        emitter,
      );
      (projectManager as any).objects_["proj-ls"] = project;
      globalCache.objects["proj-ls"] = {
        className: "Domain7ProjectClient",
        object: project as any,
      };

      // Save snapshots to LocalStorageAdapter
      await ClientStateReconciler.persistToStorage(taskManager as any, 15, storageAdapter);
      await ClientStateReconciler.persistToStorage(projectManager as any, 15, storageAdapter);

      // Confirm serialization occurred in storage backend
      expect(storageBackend.setItem).toHaveBeenCalledWith(
        "dem_state_Domain7ProjectClient",
        expect.any(String),
      );

      // Simulate offline restart
      globalCache.clear();
      const offlineSocket = createMockSocket();

      const offlineTaskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        offlineSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const offlineProjectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        offlineSocket as any,
        loggers,
        { Domain7TaskClient: offlineTaskManager },
        emitter,
        callbacks,
      );
      (offlineTaskManager.managers as any)["Domain7ProjectClient"] = offlineProjectManager;

      // Restore states from LocalStorageAdapter
      await ClientStateReconciler.restoreFromStorage(offlineTaskManager as any, storageAdapter);
      await ClientStateReconciler.restoreFromStorage(offlineProjectManager as any, storageAdapter);

      const restoredProject = offlineProjectManager.getObject("proj-ls");
      expect(restoredProject).toBeDefined();

      const tags = restoredProject!.tags as unknown as DEMArray<string>;
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(2);
      expect(tags[0]).toBe("local");
      expect(tags[1]).toBe("persistent");
      expect(tags.includes("local")).toBe(true);
      expect(tags.map((t) => t.toUpperCase())).toEqual(["LOCAL", "PERSISTENT"]);
      expect(tags.find((t) => t === "persistent")).toBe("persistent");
      expect(tags.filter((t) => t.startsWith("p"))).toEqual(["persistent"]);
      expect(tags.indexOf("persistent")).toBe(1);
      expect(tags.slice(0, 1)).toEqual(["local"]);
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual(["local", "persistent"]);

      expect(() => {
        (tags as any)[1] = "hacked";
      }).toThrow(DEMError);
      expect(() => {
        (tags as any)[1] = "hacked";
      }).toThrow(/Cannot assign index directly on DEMArray/);

      const tasks = restoredProject!.tasks as unknown as DEMArray<Domain7TaskClient>;
      expect(tasks.length).toBe(1);
      expect(tasks[0]._id).toBe("task-ls-1");
      expect(tasks[0].title).toBe("Storage Task");
      expect((tasks as any)[DEM_RAW_ARRAY]).toEqual(["task-ls-1"]);

      expect(() => {
        (tasks as any)[0] = {} as any;
      }).toThrow(DEMError);
      expect(() => {
        (tasks as any)[0] = {} as any;
      }).toThrow(/Cannot assign index directly on DEMArray/);
    });

    it("returns gracefully without throwing when storage snapshot is absent or corrupted", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      const clientManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      // Case 1: Empty storage
      const resEmpty = await ClientStateReconciler.restoreFromStorage(
        clientManager as any,
        storageAdapter,
      );
      expect(resEmpty.restored).toBe(false);
      expect(resEmpty.count).toBe(0);

      // Case 2: Corrupted snapshot without ids
      await storageAdapter.saveManagerState("Domain7ProjectClient", {
        className: "Domain7ProjectClient",
        revision: 2,
        ids: [] as any,
        objects: [],
        properties: [],
        savedAt: Date.now(),
      });

      const resCorrupted = await ClientStateReconciler.restoreFromStorage(
        clientManager as any,
        storageAdapter,
      );
      expect(resCorrupted.restored).toBe(false);
      expect(resCorrupted.count).toBe(0);
    });
  });

  // ==========================================================================
  // Section 3: Offline Mutation Queueing / Rejection
  // ==========================================================================
  describe("Section 3: Offline Mutation Queueing / Rejection", () => {
    it("rejects primitive array mutations cleanly with DEMError when offline", async () => {
      // Simulate network disconnection returning socket rejection
      const offlineSocket = createMockSocket((_event, _payload, ack) => {
        if (ack) {
          ack({
            success: false,
            code: DEMErrorCode.NETWORK_ERROR,
            message: "Network connection lost",
          });
        }
      });

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        offlineSocket,
        {
          _id: "proj-offline-1",
          name: "Offline Project",
          tags: ["stable-alpha", "stable-beta"],
          tasks: [],
        },
        loggers,
        "Domain7ProjectClient",
        {} as any,
        callbacks,
        emitter,
      );

      const tags = project.tags as unknown as DEMArray<string>;

      // Attempt push
      await expect(tags.push("failed-push")).rejects.toThrow(DEMError);

      // Attempt splice
      await expect(tags.splice(0, 1)).rejects.toThrow(DEMError);

      // Attempt set
      await expect(tags.set(0, "failed-set")).rejects.toThrow(DEMError);

      // Attempt pop
      await expect(tags.pop()).rejects.toThrow(DEMError);

      // Attempt shift
      await expect(tags.shift()).rejects.toThrow(DEMError);

      // Attempt clear
      await expect(tags.clear()).rejects.toThrow(DEMError);
    });

    it("preserves offline state integrity without corruption after rejected mutations", async () => {
      const offlineSocket = createMockSocket((_event, _payload, ack) => {
        if (ack) {
          ack({
            success: false,
            code: DEMErrorCode.TIMEOUT,
            message: "Request timed out waiting for server",
          });
        }
      });

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        offlineSocket,
        {
          _id: "proj-offline-2",
          name: "Resilient Project",
          tags: ["pristine-1", "pristine-2"],
          tasks: [],
        },
        loggers,
        "Domain7ProjectClient",
        {} as any,
        callbacks,
        emitter,
      );

      const tags = project.tags as unknown as DEMArray<string>;

      // Execute failing mutations
      await expect(tags.push("corrupt-item")).rejects.toThrow(DEMError);
      await expect(tags.splice(0, 1)).rejects.toThrow(DEMError);

      // State remains completely identical to pre-mutation snapshot
      expect(tags.length).toBe(2);
      expect(tags[0]).toBe("pristine-1");
      expect(tags[1]).toBe("pristine-2");
      expect(tags.map((t) => t)).toEqual(["pristine-1", "pristine-2"]);
      expect(tags.find((t) => t === "pristine-2")).toBe("pristine-2");
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual(["pristine-1", "pristine-2"]);
      expect((project as any).data.tags).toEqual(["pristine-1", "pristine-2"]);
    });

    it("rejects relational DEMArray mutation cleanly without polluting back-references", async () => {
      const offlineSocket = createMockSocket((_event, _payload, ack) => {
        if (ack) {
          ack({
            success: false,
            code: DEMErrorCode.NETWORK_ERROR,
            message: "Cannot persist relational reference offline",
          });
        }
      });

      const taskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        offlineSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const projectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        offlineSocket as any,
        loggers,
        { Domain7TaskClient: taskManager },
        emitter,
        callbacks,
      );
      (taskManager.managers as any)["Domain7ProjectClient"] = projectManager;

      const task1 = new Domain7TaskClient(
        Domain7TaskClient,
        offlineSocket,
        { _id: "task-rel-1", title: "Existing Task", status: "open", project: "proj-rel-1" },
        loggers,
        "Domain7TaskClient",
        taskManager,
        callbacks,
        emitter,
      );
      (taskManager as any).objects_["task-rel-1"] = task1;
      globalCache.objects["task-rel-1"] = {
        className: "Domain7TaskClient",
        object: task1 as any,
      };

      const task2 = new Domain7TaskClient(
        Domain7TaskClient,
        offlineSocket,
        { _id: "task-rel-2", title: "Unattached Task", status: "draft" },
        loggers,
        "Domain7TaskClient",
        taskManager,
        callbacks,
        emitter,
      );
      (taskManager as any).objects_["task-rel-2"] = task2;
      globalCache.objects["task-rel-2"] = {
        className: "Domain7TaskClient",
        object: task2 as any,
      };

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        offlineSocket,
        { _id: "proj-rel-1", name: "Relational Offline", tags: [], tasks: ["task-rel-1"] },
        loggers,
        "Domain7ProjectClient",
        projectManager,
        callbacks,
        emitter,
      );
      (projectManager as any).objects_["proj-rel-1"] = project;
      globalCache.objects["proj-rel-1"] = {
        className: "Domain7ProjectClient",
        object: project as any,
      };

      const tasks = project.tasks as unknown as DEMArray<Domain7TaskClient>;

      // Attempt push while offline
      await expect(tasks.push(task2)).rejects.toThrow(DEMError);

      // Verify array remains length 1
      expect(tasks.length).toBe(1);
      expect(tasks[0]).toBe(task1);
      expect((project as any).data.tasks).toEqual(["task-rel-1"]);

      // Verify task2 back-reference was NOT modified
      expect(task2.project).toBeUndefined();
      expect(task1.project).toBe(project);
    });

    it("executes subsequent array mutations through writeQueue after restoring connectivity", async () => {
      let isOnline = false;

      const adaptableSocket = createMockSocket((_event, payload, ack) => {
        if (!ack) return;
        if (!isOnline) {
          ack({
            success: false,
            code: DEMErrorCode.NETWORK_ERROR,
            message: "Socket currently disconnected",
          });
        } else {
          const mutation = (payload as any)?.mutation;
          const currentArr = ["elem-1", "elem-2"];
          if (mutation?.op === "push") {
            currentArr.push(...(mutation.items || []));
          }
          ack({
            success: true,
            updatedArray: currentArr,
          });
        }
      });

      const project = new Domain7ProjectClient(
        Domain7ProjectClient,
        adaptableSocket,
        {
          _id: "proj-recover-1",
          name: "Recoverable Project",
          tags: ["elem-1", "elem-2"],
          tasks: [],
        },
        loggers,
        "Domain7ProjectClient",
        {} as any,
        callbacks,
        emitter,
      );

      const tags = project.tags as unknown as DEMArray<string>;

      // First mutation fails while offline
      await expect(tags.push("fail-elem")).rejects.toThrow(DEMError);
      expect(tags.length).toBe(2);

      // Re-establish online connectivity
      isOnline = true;

      // Second mutation succeeds through writeQueue without deadlock
      const newLen = await tags.push("elem-3");
      expect(newLen).toBe(3);
      expect(tags.length).toBe(3);
      expect(tags[2]).toBe("elem-3");
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual(["elem-1", "elem-2", "elem-3"]);
    });
  });

  // ==========================================================================
  // Section 4: Pruning & History Expiration
  // ==========================================================================
  describe("Section 4: Pruning & History Expiration", () => {
    it("prunes ServerChangeTracker entries beyond maxEntries limit", () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 2 });

      // Record 5 successive change entries
      tracker.recordChange("update", "p1", { tags: ["v1"] }); // rev 1
      tracker.recordChange("update", "p1", { tags: ["v1", "v2"] }); // rev 2
      tracker.recordChange("update", "p1", { tags: ["v1", "v2", "v3"] }); // rev 3
      tracker.recordChange("update", "p1", { tags: ["v1", "v2", "v3", "v4"] }); // rev 4
      tracker.recordChange("update", "p1", { tags: ["v1", "v2", "v3", "v4", "v5"] }); // rev 5

      expect(tracker.getEntryCount()).toBe(2);
      expect(tracker.getCurrentRevision()).toBe(5);
      expect(tracker.getLowestRetainedRevision()).toBe(4);

      // Querying with revision 1 detects expiration
      const expiredQuery = tracker.getChangesSince(1);
      expect(expiredQuery.isExpired).toBe(true);
      expect(expiredQuery.changes.length).toBe(0);

      // Querying with revision 2 detects expiration
      const expiredQuery2 = tracker.getChangesSince(2);
      expect(expiredQuery2.isExpired).toBe(true);

      // Querying with retained revision 3 succeeds because entries 4 and 5 satisfy it
      const validQuery3 = tracker.getChangesSince(3);
      expect(validQuery3.isExpired).toBe(false);
      expect(validQuery3.changes.length).toBe(2);

      // Querying with retained revision 4 succeeds
      const validQuery = tracker.getChangesSince(4);
      expect(validQuery.isExpired).toBe(false);
      expect(validQuery.changes.length).toBe(1);
      expect(validQuery.changes[0].revision).toBe(5);
    });

    it("falls back to full sync and re-establishes primitive DEMArray when revision is expired", async () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 2 });
      const storageAdapter = new MemoryStorageAdapter();

      // Server creates initial project at revision 1
      tracker.recordChange("create", "proj-exp-1", { tags: ["v0"] }); // rev 1

      // Server executes 4 array mutations overflowing tracker history
      const { serverProject } = createServerProjectHelper(
        "proj-exp-1",
        { name: "FullSync Project", tags: ["v0"], tasks: [] },
        tracker,
        emitter,
        loggers,
      );

      await serverProject.mutateArray("tags", { op: "push", items: ["v1"] }); // rev 2
      await serverProject.mutateArray("tags", { op: "push", items: ["v2"] }); // rev 3
      await serverProject.mutateArray("tags", { op: "push", items: ["v3"] }); // rev 4
      await serverProject.mutateArray("tags", { op: "push", items: ["v4"] }); // rev 5

      expect(tracker.getCurrentRevision()).toBe(5);
      expect(tracker.getLowestRetainedRevision()).toBe(4);

      // Verify that client revision 1 is expired
      const changeCheck = tracker.getChangesSince(1);
      expect(changeCheck.isExpired).toBe(true);

      // Client socket emulates server full sync response on expiration
      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDomain7ProjectClient" && ack) {
          const clientRev = (payload as any)?.lastRevision;
          const query = tracker.getChangesSince(clientRev ?? 0);

          if (query.isExpired || clientRev === undefined) {
            // Emulate server falling back to full sync
            ack({
              success: true,
              data: {
                status: "full",
                revision: tracker.getCurrentRevision(),
                ids: ["proj-exp-1"],
                objects: [
                  {
                    _id: "proj-exp-1",
                    name: "FullSync Project",
                    tags: ["v0", "v1", "v2", "v3", "v4"],
                    tasks: [],
                  },
                ],
                properties: ["_id", "name", "tags", "tasks"],
                version: DEM_VERSION,
                protocolVersion: DEM_PROTOCOL_VERSION,
              },
            });
          } else {
            ack({
              success: true,
              data: {
                status: "delta",
                revision: tracker.getCurrentRevision(),
                changes: query.changes,
                ids: [],
                properties: ["_id", "name", "tags", "tasks"],
                version: DEM_VERSION,
              },
            });
          }
        }
      });

      // Client initializes with stale snapshot at revision 1 in storage
      await storageAdapter.saveManagerState("Domain7ProjectClient", {
        className: "Domain7ProjectClient",
        revision: 1,
        ids: ["proj-exp-1"],
        objects: [
          {
            _id: "proj-exp-1",
            name: "FullSync Project",
            tags: ["v0"],
            tasks: [],
          },
        ],
        properties: ["_id", "name", "tags", "tasks"],
        savedAt: Date.now(),
      });

      const clientManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      // Trigger reconnection load
      await clientManager.loadFromServer();

      // Verify client updated to latest revision
      expect(clientManager.lastRevision).toBe(5);

      // Retrieve re-established entity
      const project = clientManager.getObject("proj-exp-1");
      expect(project).toBeDefined();

      // Verify re-established DEMArray
      const tags = project!.tags as unknown as DEMArray<string>;
      expect(tags.length).toBe(5);
      expect(tags[0]).toBe("v0");
      expect(tags[1]).toBe("v1");
      expect(tags[2]).toBe("v2");
      expect(tags[3]).toBe("v3");
      expect(tags[4]).toBe("v4");
      expect(tags.map((t) => t.toUpperCase())).toEqual(["V0", "V1", "V2", "V3", "V4"]);
      expect(tags.find((t) => t === "v3")).toBe("v3");
      expect(tags.includes("v4")).toBe(true);

      // Verify direct index assignment is blocked
      expect(() => {
        (tags as any)[0] = "illegal";
      }).toThrow(DEMError);

      // Verify DEM_RAW_ARRAY returns full array
      expect((tags as any)[DEM_RAW_ARRAY]).toEqual(["v0", "v1", "v2", "v3", "v4"]);
    });

    it("falls back to full sync and re-establishes relational DEMArray when revision is expired", async () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 2 });
      const storageAdapter = new MemoryStorageAdapter();

      // Tracker overflows
      for (let i = 1; i <= 6; i++) {
        tracker.recordChange("update", "proj-rel-exp", { tasks: [`task-${i}`] });
      }
      expect(tracker.getChangesSince(1).isExpired).toBe(true);

      const mockSocket = createMockSocket((event, _payload, ack) => {
        if (!ack) return;
        if (event === "startupDomain7TaskClient") {
          ack({
            success: true,
            data: {
              status: "full",
              revision: 6,
              ids: ["task-rel-a", "task-rel-b"],
              objects: [
                { _id: "task-rel-a", title: "Task Alpha", status: "open", project: "proj-rel-exp" },
                { _id: "task-rel-b", title: "Task Beta", status: "closed", project: "proj-rel-exp" },
              ],
              properties: ["_id", "title", "status", "project"],
              version: DEM_VERSION,
            },
          });
        } else if (event === "startupDomain7ProjectClient") {
          ack({
            success: true,
            data: {
              status: "full",
              revision: 6,
              ids: ["proj-rel-exp"],
              objects: [
                {
                  _id: "proj-rel-exp",
                  name: "Relational FullSync",
                  tags: [],
                  tasks: ["task-rel-a", "task-rel-b"],
                },
              ],
              properties: ["_id", "name", "tags", "tasks"],
              version: DEM_VERSION,
            },
          });
        }
      });

      // Seed stale storage snapshot at revision 1
      await storageAdapter.saveManagerState("Domain7ProjectClient", {
        className: "Domain7ProjectClient",
        revision: 1,
        ids: ["proj-rel-exp"],
        objects: [
          {
            _id: "proj-rel-exp",
            name: "Relational FullSync",
            tags: [],
            tasks: ["task-rel-a"],
          },
        ],
        properties: ["_id", "name", "tags", "tasks"],
        savedAt: Date.now(),
      });

      const taskManager = new AutoUpdateClientManager(
        Domain7TaskClient as any,
        "Domain7TaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      const projectManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        { Domain7TaskClient: taskManager },
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );
      (taskManager.managers as any)["Domain7ProjectClient"] = projectManager;

      // Load both managers
      await taskManager.loadFromServer();
      await projectManager.loadFromServer();

      expect(projectManager.lastRevision).toBe(6);
      const project = projectManager.getObject("proj-rel-exp");
      expect(project).toBeDefined();

      // Verify relational DEMArray properly resolved
      const tasks = project!.tasks as unknown as DEMArray<Domain7TaskClient>;
      expect(tasks.length).toBe(2);
      expect(tasks[0]._id).toBe("task-rel-a");
      expect(tasks[0].title).toBe("Task Alpha");
      expect(tasks[1]._id).toBe("task-rel-b");
      expect(tasks[1].title).toBe("Task Beta");
      expect((tasks as any)[DEM_RAW_ARRAY]).toEqual(["task-rel-a", "task-rel-b"]);

      // Verify index assignment blocked
      expect(() => {
        (tasks as any)[0] = {} as any;
      }).toThrow(DEMError);
    });

    it("updates persistent storage adapter with full snapshot and latest revision after full sync", async () => {
      const tracker = new ServerChangeTracker("Domain7ProjectClient", { maxEntries: 2 });
      const storageAdapter = new MemoryStorageAdapter();

      for (let i = 1; i <= 5; i++) {
        tracker.recordChange("update", "proj-store-1", { tags: [`item-${i}`] });
      }

      const mockSocket = createMockSocket((event, _payload, ack) => {
        if (event === "startupDomain7ProjectClient" && ack) {
          ack({
            success: true,
            data: {
              status: "full",
              revision: 5,
              ids: ["proj-store-1"],
              objects: [
                {
                  _id: "proj-store-1",
                  name: "Stored Project",
                  tags: ["item-1", "item-2", "item-3", "item-4", "item-5"],
                  tasks: [],
                },
              ],
              properties: ["_id", "name", "tags", "tasks"],
              version: DEM_VERSION,
            },
          });
        }
      });

      // Stale storage snapshot at revision 1
      await storageAdapter.saveManagerState("Domain7ProjectClient", {
        className: "Domain7ProjectClient",
        revision: 1,
        ids: ["proj-store-1"],
        objects: [
          {
            _id: "proj-store-1",
            name: "Stored Project",
            tags: ["item-1"],
            tasks: [],
          },
        ],
        properties: ["_id", "name", "tags", "tasks"],
        savedAt: Date.now(),
      });

      const clientManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
      );

      await clientManager.loadFromServer();

      // Verify storage adapter was updated with revision 5
      const stored = await storageAdapter.loadManagerState("Domain7ProjectClient");
      expect(stored).toBeDefined();
      expect(stored!.revision).toBe(5);
      expect(stored!.objects[0].tags).toEqual([
        "item-1",
        "item-2",
        "item-3",
        "item-4",
        "item-5",
      ]);

      // Verify next offline restoration loads revision 5 directly
      globalCache.clear();
      const offlineSocket = createMockSocket();
      const offlineManager = new AutoUpdateClientManager(
        Domain7ProjectClient as any,
        "Domain7ProjectClient",
        offlineSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
      );

      const restoreResult = await ClientStateReconciler.restoreFromStorage(
        offlineManager as any,
        storageAdapter,
      );
      expect(restoreResult.restored).toBe(true);
      expect(restoreResult.revision).toBe(5);

      const offlineProject = offlineManager.getObject("proj-store-1");
      expect(offlineProject).toBeDefined();
      const tags = offlineProject!.tags as unknown as DEMArray<string>;
      expect(tags.length).toBe(5);
      expect(tags[4]).toBe("item-5");
    });
  });
});
