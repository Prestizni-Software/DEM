import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import _ from "lodash";
import { AutoUpdateServerManager } from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  AutoUpdatedClientObject,
  DEM_RAW_ARRAY,
} from "../../AutoUpdatedClientObjectClass.js";
import {
  classProp,
  populatedRef,
  globalCache,
  EntityDescriptor,
  LoggersType,
  LazyLoadingOptions,
  DEMArray,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";

/**
 * Creates silent mock loggers for testing.
 *
 * @returns Complete logger mock object.
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
 * Options for mock socket pair creation.
 */
interface MockSocketPairOptions {
  handshakeAuth?: Record<string, unknown>;
  socketId?: string;
}

/**
 * Linked client and server socket interfaces.
 */
interface MockSocketPair {
  clientSocket: {
    id: string;
    connected: boolean;
    on: (event: string, fn: Function) => any;
    off: (event: string, fn?: Function) => any;
    emit: (event: string, ...args: unknown[]) => void;
  };
  serverSocket: {
    id: string;
    handshake: {
      auth: Record<string, unknown>;
      address: string;
    };
    on: (event: string, fn: Function) => any;
    off: (event: string, fn?: Function) => any;
    onAny: (fn: (event: string, data: unknown, ack?: Function) => void) => any;
    eventNames: () => string[];
    emit: (event: string, ...args: unknown[]) => void;
  };
}

/**
 * Constructs linked client and server mock socket pair.
 *
 * @param options - Socket configuration options.
 * @returns Linked mock socket pair.
 */
function createMockSocketPair(options: MockSocketPairOptions = {}): MockSocketPair {
  const clientListeners = new Map<string, Set<Function>>();
  const serverListeners = new Map<string, Set<Function>>();
  const serverAnyListeners = new Set<(event: string, data: unknown, ack?: Function) => void>();

  const clientSocket = {
    id: options.socketId ?? "client_socket_d7",
    connected: true,
    on(event: string, fn: Function) {
      if (!clientListeners.has(event)) clientListeners.set(event, new Set());
      clientListeners.get(event)!.add(fn);
      return clientSocket;
    },
    off(event: string, fn?: Function) {
      if (!fn) {
        clientListeners.delete(event);
      } else {
        clientListeners.get(event)?.delete(fn);
      }
      return clientSocket;
    },
    emit(event: string, ...args: unknown[]) {
      const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as Function) : undefined;
      const data = args.length > (ack ? 2 : 1) ? args.slice(0, ack ? -1 : undefined) : args[0];

      for (const anyFn of serverAnyListeners) {
        anyFn(event, data, ack);
      }

      const listeners = serverListeners.get(event);
      if (listeners) {
        for (const fn of listeners) {
          fn(data, ack);
        }
      }
    },
  };

  const serverSocket = {
    id: options.socketId ?? "server_socket_d7",
    handshake: {
      auth: options.handshakeAuth ?? {},
      address: "127.0.0.1",
    },
    on(event: string, fn: Function) {
      if (!serverListeners.has(event)) serverListeners.set(event, new Set());
      serverListeners.get(event)!.add(fn);
      return serverSocket;
    },
    off(event: string, fn?: Function) {
      if (!fn) {
        serverListeners.delete(event);
      } else {
        serverListeners.get(event)?.delete(fn);
      }
      return serverSocket;
    },
    onAny(fn: (event: string, data: unknown, ack?: Function) => void) {
      serverAnyListeners.add(fn);
      return serverSocket;
    },
    eventNames() {
      return Array.from(serverListeners.keys());
    },
    emit(event: string, ...args: unknown[]) {
      const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as Function) : undefined;
      const data = args.length > (ack ? 2 : 1) ? args.slice(0, ack ? -1 : undefined) : args[0];
      const listeners = clientListeners.get(event);
      if (listeners) {
        for (const fn of listeners) {
          fn(data, ack);
        }
      }
    },
  };

  return { clientSocket, serverSocket };
}

/**
 * Creates in-memory mock Mongoose model.
 *
 * @param initialData - Optional initial document records.
 * @returns Mock Mongoose model object.
 */
function createMockModel(initialData: Record<string, unknown>[] = []): any {
  const store = new Map<string, Record<string, unknown>>();
  for (const item of initialData) {
    store.set(String(item._id), _.cloneDeep(item));
  }
  return {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockImplementation(async () => Array.from(store.values())),
    }),
    findById: jest.fn().mockImplementation(async (id: unknown) => {
      const idStr = String((id as { _id?: unknown })?._id ?? id);
      const doc = store.get(idStr);
      if (!doc) return null;
      return {
        ...doc,
        save: jest.fn().mockResolvedValue(doc),
        schema: { path: jest.fn().mockReturnValue(true) },
      };
    }),
    create: jest.fn().mockImplementation(async (data: Record<string, unknown>) => {
      store.set(String(data._id), data);
      return data;
    }),
    updateOne: jest.fn().mockImplementation(
      async (
        filter: { _id: unknown },
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        const idStr = String(filter._id);
        const doc = store.get(idStr);
        if (doc) {
          if (update.$set) Object.assign(doc, update.$set);
          if (update.$unset) {
            for (const k of Object.keys(update.$unset)) {
              delete doc[k];
            }
          }
        }
        return { modifiedCount: 1 };
      },
    ),
    schema: { path: jest.fn().mockReturnValue(true) },
  };
}

// ---------------------------------------------------------------------------
// Entity Models for Part 1: Hierarchical Batch Hydration
// ---------------------------------------------------------------------------

/**
 * Server model representing lowest depth subtask detail entity.
 */
class SubtaskDetailServer extends AutoUpdatedServerObject<SubtaskDetailServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public notes!: string;

  public static override getDescriptor(data: Partial<SubtaskDetailServer>): string {
    return `Detail: ${data.notes ?? "Empty"}`;
  }
}

/**
 * Client model representing lowest depth subtask detail entity.
 */
class SubtaskDetailClient extends AutoUpdatedClientObject<SubtaskDetailClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public notes!: string;

  public static override getDescriptor(data: Partial<SubtaskDetailClient>): string {
    return `Detail: ${data.notes ?? "Empty"}`;
  }
}

/**
 * Server model representing subtask entity with relational detail reference.
 */
class SubtaskServer extends AutoUpdatedServerObject<SubtaskServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public label!: string;

  @populatedRef("SubtaskDetailClient")
  public detail!: any;

  public static override getDescriptor(data: Partial<SubtaskServer>): string {
    return `Subtask: ${data.label ?? "Untitled"}`;
  }
}

/**
 * Client model representing subtask entity with relational detail reference.
 */
class SubtaskClient extends AutoUpdatedClientObject<SubtaskClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public label!: string;

  @populatedRef("SubtaskDetailClient")
  public detail!: SubtaskDetailClient;

  public static override getDescriptor(data: Partial<SubtaskClient>): string {
    return `Subtask: ${data.label ?? "Untitled"}`;
  }
}

/**
 * Server model representing task entity with relational subtasks array.
 */
class TaskServer extends AutoUpdatedServerObject<TaskServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("SubtaskClient")
  public subtasks!: any[];

  public static override getDescriptor(data: Partial<TaskServer>): string {
    return `Task: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Client model representing task entity with relational subtasks DEMArray.
 */
class TaskClient extends AutoUpdatedClientObject<TaskClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("SubtaskClient")
  public subtasks!: SubtaskClient[];

  public static override getDescriptor(data: Partial<TaskClient>): string {
    return `Task: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Server model representing top-level project container entity.
 */
class ProjectServer extends AutoUpdatedServerObject<ProjectServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("TaskClient")
  public tasks!: any[];

  public static override getDescriptor(data: Partial<ProjectServer>): string {
    return `Project: ${data.name ?? "Untitled"}`;
  }
}

/**
 * Client model representing top-level project container entity.
 */
class ProjectClient extends AutoUpdatedClientObject<ProjectClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("TaskClient")
  public tasks!: TaskClient[];

  public static override getDescriptor(data: Partial<ProjectClient>): string {
    return `Project: ${data.name ?? "Untitled"}`;
  }
}

// ---------------------------------------------------------------------------
// Entity Models for Part 2: Mutations on Lazy Entities & Arrays
// ---------------------------------------------------------------------------

/**
 * Server model for testing mutations on lazy entities.
 */
class MutableContainerServer extends AutoUpdatedServerObject<MutableContainerServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @classProp
  public tags!: string[];

  @populatedRef("MutableItemClient")
  public items!: any[];

  public static override getDescriptor(data: Partial<MutableContainerServer>): string {
    return `Container: ${data.name ?? "Untitled"}`;
  }
}

/**
 * Client model for testing mutations on lazy entities.
 */
class MutableContainerClient extends AutoUpdatedClientObject<MutableContainerClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @classProp
  public tags!: string[];

  @populatedRef("MutableItemClient")
  public items!: any[];

  public static override getDescriptor(data: Partial<MutableContainerClient>): string {
    return `Container: ${data.name ?? "Untitled"}`;
  }
}

/**
 * Server model representing item within mutable container.
 */
class MutableItemServer extends AutoUpdatedServerObject<MutableItemServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  public static override getDescriptor(data: Partial<MutableItemServer>): string {
    return `Item: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Client model representing item within mutable container.
 */
class MutableItemClient extends AutoUpdatedClientObject<MutableItemClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  public static override getDescriptor(data: Partial<MutableItemClient>): string {
    return `Item: ${data.title ?? "Untitled"}`;
  }
}

// ---------------------------------------------------------------------------
// Entity Models for Part 3: Circular Entity Graphs
// ---------------------------------------------------------------------------

/**
 * Server model representing circular project entity.
 */
class CircularProjectServer extends AutoUpdatedServerObject<CircularProjectServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("CircularTaskClient")
  public tasks!: any[];

  public static override getDescriptor(data: Partial<CircularProjectServer>): string {
    return `CircularProject: ${data.name ?? "Unnamed"}`;
  }
}

/**
 * Client model representing circular project entity.
 */
class CircularProjectClient extends AutoUpdatedClientObject<CircularProjectClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("CircularTaskClient")
  public tasks!: CircularTaskClient[];

  public static override getDescriptor(data: Partial<CircularProjectClient>): string {
    return `CircularProject: ${data.name ?? "Unnamed"}`;
  }
}

/**
 * Server model representing circular task entity referencing back to project.
 */
class CircularTaskServer extends AutoUpdatedServerObject<CircularTaskServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("CircularProjectClient")
  public project!: any;

  public static override getDescriptor(data: Partial<CircularTaskServer>): string {
    return `CircularTask: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Client model representing circular task entity referencing back to project.
 */
class CircularTaskClient extends AutoUpdatedClientObject<CircularTaskClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("CircularProjectClient")
  public project!: CircularProjectClient;

  public static override getDescriptor(data: Partial<CircularTaskClient>): string {
    return `CircularTask: ${data.title ?? "Untitled"}`;
  }
}

// ---------------------------------------------------------------------------
// Entity Models for Part 4: Missing Entity & Dangling Pointer Handling
// ---------------------------------------------------------------------------

/**
 * Server model representing entity with dangling task references.
 */
class GhostHostServer extends AutoUpdatedServerObject<GhostHostServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("GhostTaskClient")
  public tasks!: any[];

  public static override getDescriptor(data: Partial<GhostHostServer>): string {
    return `Host: ${data.name ?? "Unknown"}`;
  }
}

/**
 * Client model representing entity with dangling task references.
 */
class GhostHostClient extends AutoUpdatedClientObject<GhostHostClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  @populatedRef("GhostTaskClient")
  public tasks!: GhostTaskClient[];

  public static override getDescriptor(data: Partial<GhostHostClient>): string {
    return `Host: ${data.name ?? "Unknown"}`;
  }
}

/**
 * Server model representing existing ghost task.
 */
class GhostTaskServer extends AutoUpdatedServerObject<GhostTaskServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  public static override getDescriptor(data: Partial<GhostTaskServer>): string {
    return `GhostTask: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Client model representing existing ghost task.
 */
class GhostTaskClient extends AutoUpdatedClientObject<GhostTaskClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  public static override getDescriptor(data: Partial<GhostTaskClient>): string {
    return `GhostTask: ${data.title ?? "Untitled"}`;
  }
}

// ---------------------------------------------------------------------------
// Test Suite: Domain 7 Part 2
// ---------------------------------------------------------------------------

describe("Domain 7 Part 2: DEMArray Smart Lazy Loading & Hydration Test Suite", () => {
  let emitter: EventEmitter;
  let loggers: LoggersType;

  beforeEach(() => {
    globalCache.clear();
    emitter = new EventEmitter();
    loggers = createMockLoggers();
  });

  // =========================================================================
  // Section 1: Batch Hydration via ensureLoaded({ depth }) on DEMArray
  // =========================================================================

  describe("Section 1: Batch Hydration via ensureLoaded({ depth }) on DEMArray", () => {
    it("hydrates all lazy stub items in parallel up to requested depth and preserves DEMArray reference", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const detailServerMgr = new AutoUpdateServerManager(
        SubtaskDetailServer as any,
        "SubtaskDetailClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const subtaskServerMgr = new AutoUpdateServerManager(
        SubtaskServer as any,
        "SubtaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const taskServerMgr = new AutoUpdateServerManager(
        TaskServer as any,
        "TaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const projectServerMgr = new AutoUpdateServerManager(
        ProjectServer as any,
        "ProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["SubtaskDetailClient"] = detailServerMgr;
      serverManagers["SubtaskClient"] = subtaskServerMgr;
      serverManagers["TaskClient"] = taskServerMgr;
      serverManagers["ProjectClient"] = projectServerMgr;

      // Populate server memory documents
      const detailObj1: any = {
        _id: "det-1",
        notes: "Detail notes 1",
        extractedData: { _id: "det-1", notes: "Detail notes 1" },
        data: { _id: "det-1", notes: "Detail notes 1" },
      };
      const detailObj2: any = {
        _id: "det-2",
        notes: "Detail notes 2",
        extractedData: { _id: "det-2", notes: "Detail notes 2" },
        data: { _id: "det-2", notes: "Detail notes 2" },
      };
      const subtaskObj1: any = {
        _id: "sub-1",
        label: "Subtask Alpha",
        detail: "det-1",
        extractedData: { _id: "sub-1", label: "Subtask Alpha", detail: "det-1" },
        data: { _id: "sub-1", label: "Subtask Alpha", detail: "det-1" },
      };
      const subtaskObj2: any = {
        _id: "sub-2",
        label: "Subtask Beta",
        detail: "det-2",
        extractedData: { _id: "sub-2", label: "Subtask Beta", detail: "det-2" },
        data: { _id: "sub-2", label: "Subtask Beta", detail: "det-2" },
      };
      const taskObj1: any = {
        _id: "task-1",
        title: "Task One",
        subtasks: ["sub-1"],
        extractedData: { _id: "task-1", title: "Task One", subtasks: ["sub-1"] },
        data: { _id: "task-1", title: "Task One", subtasks: ["sub-1"] },
      };
      const taskObj2: any = {
        _id: "task-2",
        title: "Task Two",
        subtasks: ["sub-2"],
        extractedData: { _id: "task-2", title: "Task Two", subtasks: ["sub-2"] },
        data: { _id: "task-2", title: "Task Two", subtasks: ["sub-2"] },
      };
      const projObj: any = {
        _id: "proj-1",
        name: "Enterprise Architecture",
        tasks: ["task-1", "task-2"],
        extractedData: { _id: "proj-1", name: "Enterprise Architecture", tasks: ["task-1", "task-2"] },
        data: { _id: "proj-1", name: "Enterprise Architecture", tasks: ["task-1", "task-2"] },
      };

      (detailServerMgr as any).objects_["det-1"] = detailObj1;
      (detailServerMgr as any).objects_["det-2"] = detailObj2;
      (subtaskServerMgr as any).objects_["sub-1"] = subtaskObj1;
      (subtaskServerMgr as any).objects_["sub-2"] = subtaskObj2;
      (taskServerMgr as any).objects_["task-1"] = taskObj1;
      (taskServerMgr as any).objects_["task-2"] = taskObj2;
      (projectServerMgr as any).objects_["proj-1"] = projObj;

      detailServerMgr.registerSocket(serverSocket as any);
      subtaskServerMgr.registerSocket(serverSocket as any);
      taskServerMgr.registerSocket(serverSocket as any);
      projectServerMgr.registerSocket(serverSocket as any);

      // Create client managers with lazy loading enabled
      const detailClientMgr = new AutoUpdateClientManager(
        SubtaskDetailClient as any,
        "SubtaskDetailClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const subtaskClientMgr = new AutoUpdateClientManager(
        SubtaskClient as any,
        "SubtaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const taskClientMgr = new AutoUpdateClientManager(
        TaskClient as any,
        "TaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const projectClientMgr = new AutoUpdateClientManager(
        ProjectClient as any,
        "ProjectClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["SubtaskDetailClient"] = detailClientMgr;
      clientManagers["SubtaskClient"] = subtaskClientMgr;
      clientManagers["TaskClient"] = taskClientMgr;
      clientManagers["ProjectClient"] = projectClientMgr;

      await detailClientMgr.loadFromServer();
      await subtaskClientMgr.loadFromServer();
      await taskClientMgr.loadFromServer();
      await projectClientMgr.loadFromServer();

      // Hydrate root project
      const project = await projectClientMgr.loadObject("proj-1", { depth: 0 });
      expect(project.isLazyStub).toBe(false);
      expect(project.isLoaded).toBe(true);

      const tasks = project.tasks as unknown as DEMArray<TaskClient>;
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(2);

      // Verify that tasks are initially unhydrated lazy stubs
      expect(tasks[0].isLazyStub).toBe(true);
      expect(tasks[0].isLoaded).toBe(false);
      expect(tasks[1].isLazyStub).toBe(true);
      expect(tasks[1].isLoaded).toBe(false);

      // Verify parallel invocation of loadObject during ensureLoaded
      const loadObjectSpy = jest.spyOn(taskClientMgr, "loadObject");

      // Batch hydrate depth: 1 on DEMArray
      const loadedRef = await tasks.ensureLoaded({ depth: 1 });

      // Verify referential identity
      expect(loadedRef).toBe(tasks);

      // Verify parallel execution across all stub items
      expect(loadObjectSpy).toHaveBeenCalledTimes(2);
      expect(loadObjectSpy).toHaveBeenCalledWith("task-1", { depth: 1 });
      expect(loadObjectSpy).toHaveBeenCalledWith("task-2", { depth: 1 });

      // Verify tasks are now fully hydrated
      expect(tasks[0].isLazyStub).toBe(false);
      expect(tasks[0].isLoaded).toBe(true);
      expect(tasks[0].title).toBe("Task One");
      expect(tasks[1].isLazyStub).toBe(false);
      expect(tasks[1].isLoaded).toBe(true);
      expect(tasks[1].title).toBe("Task Two");

      // Depth limiting: items at depth 1 (subtasks) are hydrated
      const subtask1 = tasks[0].subtasks[0];
      const subtask2 = tasks[1].subtasks[0];
      expect(subtask1).toBeDefined();
      expect(subtask1.isLazyStub).toBe(false);
      expect(subtask1.label).toBe("Subtask Alpha");
      expect(subtask2.isLazyStub).toBe(false);
      expect(subtask2.label).toBe("Subtask Beta");

      // Depth limiting: items at depth 2 (detail) remain lazy stubs
      const detail1 = subtask1.detail;
      const detail2 = subtask2.detail;
      expect(detail1).toBeDefined();
      expect(detail1.isLazyStub).toBe(true);
      expect(detail1.isLoaded).toBe(false);
      expect(detail2.isLazyStub).toBe(true);
      expect(detail2.isLoaded).toBe(false);
    });

    it("hydrates deeper entities when called with depth: 2", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const detailServerMgr = new AutoUpdateServerManager(
        SubtaskDetailServer as any,
        "SubtaskDetailClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const subtaskServerMgr = new AutoUpdateServerManager(
        SubtaskServer as any,
        "SubtaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const taskServerMgr = new AutoUpdateServerManager(
        TaskServer as any,
        "TaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const projectServerMgr = new AutoUpdateServerManager(
        ProjectServer as any,
        "ProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["SubtaskDetailClient"] = detailServerMgr;
      serverManagers["SubtaskClient"] = subtaskServerMgr;
      serverManagers["TaskClient"] = taskServerMgr;
      serverManagers["ProjectClient"] = projectServerMgr;

      // Populate server records
      (detailServerMgr as any).objects_["det-10"] = {
        _id: "det-10",
        notes: "Deep notes",
        extractedData: { _id: "det-10", notes: "Deep notes" },
        data: { _id: "det-10", notes: "Deep notes" },
      };
      (subtaskServerMgr as any).objects_["sub-10"] = {
        _id: "sub-10",
        label: "Subtask Ten",
        detail: "det-10",
        extractedData: { _id: "sub-10", label: "Subtask Ten", detail: "det-10" },
        data: { _id: "sub-10", label: "Subtask Ten", detail: "det-10" },
      };
      (taskServerMgr as any).objects_["task-10"] = {
        _id: "task-10",
        title: "Task Ten",
        subtasks: ["sub-10"],
        extractedData: { _id: "task-10", title: "Task Ten", subtasks: ["sub-10"] },
        data: { _id: "task-10", title: "Task Ten", subtasks: ["sub-10"] },
      };
      (projectServerMgr as any).objects_["proj-10"] = {
        _id: "proj-10",
        name: "Deep Project",
        tasks: ["task-10"],
        extractedData: { _id: "proj-10", name: "Deep Project", tasks: ["task-10"] },
        data: { _id: "proj-10", name: "Deep Project", tasks: ["task-10"] },
      };

      detailServerMgr.registerSocket(serverSocket as any);
      subtaskServerMgr.registerSocket(serverSocket as any);
      taskServerMgr.registerSocket(serverSocket as any);
      projectServerMgr.registerSocket(serverSocket as any);

      const detailClientMgr = new AutoUpdateClientManager(
        SubtaskDetailClient as any,
        "SubtaskDetailClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const subtaskClientMgr = new AutoUpdateClientManager(
        SubtaskClient as any,
        "SubtaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const taskClientMgr = new AutoUpdateClientManager(
        TaskClient as any,
        "TaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const projectClientMgr = new AutoUpdateClientManager(
        ProjectClient as any,
        "ProjectClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["SubtaskDetailClient"] = detailClientMgr;
      clientManagers["SubtaskClient"] = subtaskClientMgr;
      clientManagers["TaskClient"] = taskClientMgr;
      clientManagers["ProjectClient"] = projectClientMgr;

      await detailClientMgr.loadFromServer();
      await subtaskClientMgr.loadFromServer();
      await taskClientMgr.loadFromServer();
      await projectClientMgr.loadFromServer();

      const project = await projectClientMgr.loadObject("proj-10", { depth: 0 });
      const tasks = project.tasks as unknown as DEMArray<TaskClient>;

      // Hydrate depth: 2 on DEMArray
      await tasks.ensureLoaded({ depth: 2 });

      expect(tasks[0].isLoaded).toBe(true);
      const subtask = tasks[0].subtasks[0];
      expect(subtask.isLoaded).toBe(true);

      // Depth 2 hydrates grandchildren
      const detail = subtask.detail;
      expect(detail).toBeDefined();
      expect(detail.isLazyStub).toBe(false);
      expect(detail.isLoaded).toBe(true);
      expect(detail.notes).toBe("Deep notes");
    });

    it("returns immediately without socket emissions when DEMArray elements are already hydrated", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const taskServerMgr = new AutoUpdateServerManager(
        TaskServer as any,
        "TaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const projectServerMgr = new AutoUpdateServerManager(
        ProjectServer as any,
        "ProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["TaskClient"] = taskServerMgr;
      serverManagers["ProjectClient"] = projectServerMgr;

      (taskServerMgr as any).objects_["task-fast"] = {
        _id: "task-fast",
        title: "Fast Task",
        subtasks: [],
        extractedData: { _id: "task-fast", title: "Fast Task", subtasks: [] },
        data: { _id: "task-fast", title: "Fast Task", subtasks: [] },
      };
      (projectServerMgr as any).objects_["proj-fast"] = {
        _id: "proj-fast",
        name: "Fast Project",
        tasks: ["task-fast"],
        extractedData: { _id: "proj-fast", name: "Fast Project", tasks: ["task-fast"] },
        data: { _id: "proj-fast", name: "Fast Project", tasks: ["task-fast"] },
      };

      taskServerMgr.registerSocket(serverSocket as any);
      projectServerMgr.registerSocket(serverSocket as any);

      const taskClientMgr = new AutoUpdateClientManager(
        TaskClient as any,
        "TaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const projectClientMgr = new AutoUpdateClientManager(
        ProjectClient as any,
        "ProjectClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["TaskClient"] = taskClientMgr;
      clientManagers["ProjectClient"] = projectClientMgr;

      await taskClientMgr.loadFromServer();
      await projectClientMgr.loadFromServer();

      const project = await projectClientMgr.loadObject("proj-fast", { depth: 1 });
      const tasks = project.tasks as unknown as DEMArray<TaskClient>;
      expect(tasks[0].isLoaded).toBe(true);

      const emitSpy = jest.spyOn(clientSocket, "emit");
      const result = await tasks.ensureLoaded({ depth: 1 });

      expect(result).toBe(tasks);
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Section 2: Mutations on Lazy Entities & Lazy Arrays
  // =========================================================================

  describe("Section 2: Mutations on Lazy Entities & Lazy Arrays", () => {
    it("executes push, splice, and set mutations on unhydrated lazy entity and updates stub without full hydration", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const mockModel = createMockModel([
        { _id: "cont-1", name: "Box Alpha", tags: ["initial"], items: [] },
      ]);

      const containerServerMgr = new AutoUpdateServerManager(
        MutableContainerServer as any,
        "MutableContainerClient",
        mockServer,
        loggers,
        mockModel,
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["MutableContainerClient"] = containerServerMgr;

      const serverContainerObj = new MutableContainerServer(
        MutableContainerServer,
        mockServer,
        { _id: "cont-1", name: "Box Alpha", tags: ["initial"], items: [] },
        loggers,
        "MutableContainerClient",
        containerServerMgr,
        {} as any,
        emitter,
      );
      (containerServerMgr as any).objects_["cont-1"] = serverContainerObj;

      containerServerMgr.registerSocket(serverSocket as any);

      const containerClientMgr = new AutoUpdateClientManager(
        MutableContainerClient as any,
        "MutableContainerClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["MutableContainerClient"] = containerClientMgr;
      await containerClientMgr.loadFromServer();

      const stub = containerClientMgr.getObject("cont-1")!;
      expect(stub).toBeDefined();
      expect(stub.isLazyStub).toBe(true);
      expect(stub.isLoaded).toBe(false);

      // Perform push mutation on unhydrated lazy stub
      await stub.mutateArrayQueue("tags", { op: "push", items: ["tag-first", "tag-second"] }, false);

      // Verify server persisted change
      expect(serverContainerObj.data.tags).toEqual(["initial", "tag-first", "tag-second"]);

      // Verify local stub state updated while remaining a lazy stub
      expect((stub.data as any).tags).toEqual(["initial", "tag-first", "tag-second"]);
      expect(stub.isLazyStub).toBe(true);
      expect(stub.isLoaded).toBe(false);

      // Now reactive DEMArray proxy is accessible on the stub
      const tags = (stub as any).tags as DEMArray<string>;
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(3);

      // Perform splice mutation directly on DEMArray proxy of lazy stub
      await tags.splice(1, 1, "tag-replaced");

      // Verify server updated
      expect(serverContainerObj.data.tags).toEqual(["initial", "tag-replaced", "tag-second"]);
      expect(tags.length).toBe(3);
      expect(tags[1]).toBe("tag-replaced");
      expect(stub.isLazyStub).toBe(true);

      // Perform set mutation directly on DEMArray proxy of lazy stub
      await tags.set(0, "tag-zero");

      // Verify server updated
      expect(serverContainerObj.data.tags).toEqual(["tag-zero", "tag-replaced", "tag-second"]);
      expect(tags[0]).toBe("tag-zero");
      expect(stub.isLazyStub).toBe(true);
      expect(stub.isLoaded).toBe(false);
    });

    it("preserves mutated array state upon subsequent full hydration", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const mockModel = createMockModel([
        { _id: "cont-2", name: "Box Beta", tags: ["start"], items: [] },
      ]);

      const containerServerMgr = new AutoUpdateServerManager(
        MutableContainerServer as any,
        "MutableContainerClient",
        mockServer,
        loggers,
        mockModel,
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["MutableContainerClient"] = containerServerMgr;

      const serverContainerObj = new MutableContainerServer(
        MutableContainerServer,
        mockServer,
        { _id: "cont-2", name: "Box Beta", tags: ["start"], items: [] },
        loggers,
        "MutableContainerClient",
        containerServerMgr,
        {} as any,
        emitter,
      );
      (containerServerMgr as any).objects_["cont-2"] = serverContainerObj;

      containerServerMgr.registerSocket(serverSocket as any);

      const containerClientMgr = new AutoUpdateClientManager(
        MutableContainerClient as any,
        "MutableContainerClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["MutableContainerClient"] = containerClientMgr;
      await containerClientMgr.loadFromServer();

      const stub = containerClientMgr.getObject("cont-2")!;
      expect(stub.isLazyStub).toBe(true);

      // Perform mutation on lazy stub
      await stub.mutateArrayQueue("tags", { op: "push", items: ["mutated-1", "mutated-2"] }, false);

      expect(serverContainerObj.data.tags).toEqual(["start", "mutated-1", "mutated-2"]);
      expect((stub.data as any).tags).toEqual(["start", "mutated-1", "mutated-2"]);
      expect(stub.isLazyStub).toBe(true);

      // Subsequent full hydration
      const hydrated = await stub.ensureLoaded();

      // Verify entity is now fully hydrated
      expect(hydrated).toBe(stub);
      expect(stub.isLazyStub).toBe(false);
      expect(stub.isLoaded).toBe(true);
      expect(stub.name).toBe("Box Beta");

      // Verify mutated array state was preserved
      const tags = (stub as any).tags as DEMArray<string>;
      expect(tags.length).toBe(3);
      expect(tags[0]).toBe("start");
      expect(tags[1]).toBe("mutated-1");
      expect(tags[2]).toBe("mutated-2");
    });
  });

  // =========================================================================
  // Section 3: Circular Entity Graphs & Manifest Generation
  // =========================================================================

  describe("Section 3: Circular Entity Graphs & Manifest Generation", () => {
    it("generates manifests safely without stack overflow or cycle recursion", () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      const projectServerMgr = new AutoUpdateServerManager(
        CircularProjectServer as any,
        "CircularProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const taskServerMgr = new AutoUpdateServerManager(
        CircularTaskServer as any,
        "CircularTaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["CircularProjectClient"] = projectServerMgr;
      serverManagers["CircularTaskClient"] = taskServerMgr;

      // Circular link: Project points to Task, Task points back to Project
      const cProjectObj: any = {
        _id: "cproj-1",
        name: "Cycle Project Alpha",
        tasks: ["ctask-1"],
        extractedData: { _id: "cproj-1", name: "Cycle Project Alpha", tasks: ["ctask-1"] },
        data: { _id: "cproj-1", name: "Cycle Project Alpha", tasks: ["ctask-1"] },
      };
      const cTaskObj: any = {
        _id: "ctask-1",
        title: "Cycle Task Alpha",
        project: "cproj-1",
        extractedData: { _id: "ctask-1", title: "Cycle Task Alpha", project: "cproj-1" },
        data: { _id: "ctask-1", title: "Cycle Task Alpha", project: "cproj-1" },
      };

      (projectServerMgr as any).objects_["cproj-1"] = cProjectObj;
      (taskServerMgr as any).objects_["ctask-1"] = cTaskObj;

      // Generate manifests
      const projectManifest: EntityDescriptor[] = projectServerMgr.generateManifest([cProjectObj]);
      const taskManifest: EntityDescriptor[] = taskServerMgr.generateManifest([cTaskObj]);

      expect(projectManifest).toHaveLength(1);
      expect(projectManifest[0]._id).toBe("cproj-1");
      expect(projectManifest[0].description).toBe("CircularProject: Cycle Project Alpha");

      expect(taskManifest).toHaveLength(1);
      expect(taskManifest[0]._id).toBe("ctask-1");
      expect(taskManifest[0].description).toBe("CircularTask: Cycle Task Alpha");
    });

    it("terminates collectEntityGraphAsync cleanly on circular graphs", async () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      const projectServerMgr = new AutoUpdateServerManager(
        CircularProjectServer as any,
        "CircularProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const taskServerMgr = new AutoUpdateServerManager(
        CircularTaskServer as any,
        "CircularTaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["CircularProjectClient"] = projectServerMgr;
      serverManagers["CircularTaskClient"] = taskServerMgr;

      const cProjectObj: any = {
        _id: "cproj-2",
        name: "Cycle Project Beta",
        tasks: ["ctask-2"],
        extractedData: { _id: "cproj-2", name: "Cycle Project Beta", tasks: ["ctask-2"] },
        data: { _id: "cproj-2", name: "Cycle Project Beta", tasks: ["ctask-2"] },
      };
      const cTaskObj: any = {
        _id: "ctask-2",
        title: "Cycle Task Beta",
        project: "cproj-2",
        extractedData: { _id: "ctask-2", title: "Cycle Task Beta", project: "cproj-2" },
        data: { _id: "ctask-2", title: "Cycle Task Beta", project: "cproj-2" },
      };

      (projectServerMgr as any).objects_["cproj-2"] = cProjectObj;
      (taskServerMgr as any).objects_["ctask-2"] = cTaskObj;

      // Collect graph at depth 1, 2, and 5
      const graphDepth1 = await projectServerMgr.collectEntityGraphAsync(cProjectObj, 1);
      expect(graphDepth1["CircularTaskClient"]).toHaveLength(1);
      expect(graphDepth1["CircularTaskClient"][0]._id).toBe("ctask-2");

      const graphDepth5 = await projectServerMgr.collectEntityGraphAsync(cProjectObj, 5);
      expect(graphDepth5["CircularTaskClient"]).toHaveLength(1);
    });

    it("initializes client stubs from circular manifests without infinite loops", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const projectServerMgr = new AutoUpdateServerManager(
        CircularProjectServer as any,
        "CircularProjectClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const taskServerMgr = new AutoUpdateServerManager(
        CircularTaskServer as any,
        "CircularTaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["CircularProjectClient"] = projectServerMgr;
      serverManagers["CircularTaskClient"] = taskServerMgr;

      const cProjectObj: any = {
        _id: "cproj-3",
        name: "Cycle Gamma",
        tasks: ["ctask-3"],
        extractedData: { _id: "cproj-3", name: "Cycle Gamma", tasks: ["ctask-3"] },
        data: { _id: "cproj-3", name: "Cycle Gamma", tasks: ["ctask-3"] },
      };
      const cTaskObj: any = {
        _id: "ctask-3",
        title: "Task Gamma",
        project: "cproj-3",
        extractedData: { _id: "ctask-3", title: "Task Gamma", project: "cproj-3" },
        data: { _id: "ctask-3", title: "Task Gamma", project: "cproj-3" },
      };

      (projectServerMgr as any).objects_["cproj-3"] = cProjectObj;
      (taskServerMgr as any).objects_["ctask-3"] = cTaskObj;

      projectServerMgr.registerSocket(serverSocket as any);
      taskServerMgr.registerSocket(serverSocket as any);

      const projectClientMgr = new AutoUpdateClientManager(
        CircularProjectClient as any,
        "CircularProjectClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const taskClientMgr = new AutoUpdateClientManager(
        CircularTaskClient as any,
        "CircularTaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["CircularProjectClient"] = projectClientMgr;
      clientManagers["CircularTaskClient"] = taskClientMgr;

      await projectClientMgr.loadFromServer();
      await taskClientMgr.loadFromServer();

      const projStub = projectClientMgr.getObject("cproj-3");
      const taskStub = taskClientMgr.getObject("ctask-3");

      expect(projStub).toBeDefined();
      expect(projStub?.isLazyStub).toBe(true);
      expect(projStub?.descriptor).toBe("CircularProject: Cycle Gamma");

      expect(taskStub).toBeDefined();
      expect(taskStub?.isLazyStub).toBe(true);
      expect(taskStub?.descriptor).toBe("CircularTask: Task Gamma");
    });
  });

  // =========================================================================
  // Section 4: Missing Entity Handling during Lazy Array Hydration
  // =========================================================================

  describe("Section 4: Missing Entity Handling during Lazy Array Hydration", () => {
    it("rejects ensureLoaded with OBJECT_LOAD_FAILED when a referenced lazy item is missing on the server", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const taskServerMgr = new AutoUpdateServerManager(
        GhostTaskServer as any,
        "GhostTaskClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const hostServerMgr = new AutoUpdateServerManager(
        GhostHostServer as any,
        "GhostHostClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["GhostTaskClient"] = taskServerMgr;
      serverManagers["GhostHostClient"] = hostServerMgr;

      // task-valid exists on server, but task-ghost is missing from objects_
      (taskServerMgr as any).objects_["task-valid"] = {
        _id: "task-valid",
        title: "Valid Task",
        extractedData: { _id: "task-valid", title: "Valid Task" },
        data: { _id: "task-valid", title: "Valid Task" },
      };

      (hostServerMgr as any).objects_["host-1"] = {
        _id: "host-1",
        name: "Host Alpha",
        tasks: ["task-valid", "task-ghost"],
        extractedData: { _id: "host-1", name: "Host Alpha", tasks: ["task-valid", "task-ghost"] },
        data: { _id: "host-1", name: "Host Alpha", tasks: ["task-valid", "task-ghost"] },
      };

      taskServerMgr.registerSocket(serverSocket as any);
      hostServerMgr.registerSocket(serverSocket as any);

      const taskClientMgr = new AutoUpdateClientManager(
        GhostTaskClient as any,
        "GhostTaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const hostClientMgr = new AutoUpdateClientManager(
        GhostHostClient as any,
        "GhostHostClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["GhostTaskClient"] = taskClientMgr;
      clientManagers["GhostHostClient"] = hostClientMgr;

      await taskClientMgr.loadFromServer();
      await hostClientMgr.loadFromServer();

      // Register unhydrated lazy stub for task-ghost so it is present in the DEMArray
      const ghostStub = new GhostTaskClient(
        GhostTaskClient,
        clientSocket as any,
        { _id: "task-ghost", __isLazyStub: true, descriptor: "GhostTask: Ghost" } as any,
        loggers,
        "GhostTaskClient",
        taskClientMgr,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        emitter,
      );
      ghostStub.generateSettersAndGetters();
      (taskClientMgr as any).objects_["task-ghost"] = ghostStub;
      globalCache.objects["task-ghost"] = {
        className: "GhostTaskClient",
        object: ghostStub as any,
      };

      // Hydrate root host
      const host = await hostClientMgr.loadObject("host-1", { depth: 0 });
      expect(host.isLoaded).toBe(true);

      const tasks = host.tasks as unknown as DEMArray<GhostTaskClient>;
      expect(tasks.length).toBe(2);

      // Attempting to batch hydrate array containing missing item triggers error
      await expect(tasks.ensureLoaded({ depth: 1 })).rejects.toMatchObject({
        code: DEMErrorCode.DOCUMENT_NOT_FOUND,
      });

      // Verify that the valid task is loaded despite missing sibling
      const validTask = taskClientMgr.getObject("task-valid");
      expect(validTask).toBeDefined();
    });

    it("rejects ensureLoaded with OBJECT_LOAD_FAILED when server returns load failure code", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const taskClientMgr = new AutoUpdateClientManager(
        GhostTaskClient as any,
        "GhostTaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const hostClientMgr = new AutoUpdateClientManager(
        GhostHostClient as any,
        "GhostHostClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["GhostTaskClient"] = taskClientMgr;
      clientManagers["GhostHostClient"] = hostClientMgr;

      // Mock server returning OBJECT_LOAD_FAILED for failing task
      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (typeof ack === "function") {
          if (event.startsWith("getGhostTaskClienttask-failed")) {
            ack({
              success: false,
              code: DEMErrorCode.OBJECT_LOAD_FAILED,
              message: "Object load failed on server",
            });
          }
        }
      });

      const failingStub = new GhostTaskClient(
        GhostTaskClient,
        clientSocket as any,
        { _id: "task-failed", __isLazyStub: true, descriptor: "GhostTask: Failed" } as any,
        loggers,
        "GhostTaskClient",
        taskClientMgr,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        emitter,
      );
      failingStub.generateSettersAndGetters();
      (taskClientMgr as any).objects_["task-failed"] = failingStub;
      globalCache.objects["task-failed"] = {
        className: "GhostTaskClient",
        object: failingStub as any,
      };

      const host = new GhostHostClient(
        GhostHostClient,
        clientSocket as any,
        { _id: "host-fail", name: "Host Fail", tasks: ["task-failed"] },
        loggers,
        "GhostHostClient",
        hostClientMgr,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        emitter,
      );
      host.generateSettersAndGetters();

      const tasks = host.tasks as unknown as DEMArray<GhostTaskClient>;
      await expect(tasks.ensureLoaded({ depth: 1 })).rejects.toMatchObject({
        code: DEMErrorCode.OBJECT_LOAD_FAILED,
      });
    });

    it("filters dangling pointers out during synchronous DEMArray access when item is absent from cache", () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const taskClientMgr = new AutoUpdateClientManager(
        GhostTaskClient as any,
        "GhostTaskClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      );
      const hostClientMgr = new AutoUpdateClientManager(
        GhostHostClient as any,
        "GhostHostClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      );

      clientManagers["GhostTaskClient"] = taskClientMgr;
      clientManagers["GhostHostClient"] = hostClientMgr;

      // Create valid cached item
      const validTaskObj = new GhostTaskClient(
        GhostTaskClient,
        clientSocket as any,
        { _id: "task-good", title: "Good Task" },
        loggers,
        "GhostTaskClient",
        taskClientMgr,
        {} as any,
        emitter,
      );
      validTaskObj.generateSettersAndGetters();
      (taskClientMgr as any).objects_["task-good"] = validTaskObj;
      globalCache.objects["task-good"] = {
        className: "GhostTaskClient",
        object: validTaskObj as any,
      };

      // Create host referencing one valid ID and one dangling nonexistent ID
      const host = new GhostHostClient(
        GhostHostClient,
        clientSocket as any,
        { _id: "host-dangling", name: "Dangling Host", tasks: ["task-good", "task-nonexistent"] },
        loggers,
        "GhostHostClient",
        hostClientMgr,
        {} as any,
        emitter,
      );
      host.generateSettersAndGetters();

      const tasks = host.tasks as unknown as DEMArray<GhostTaskClient>;
      expect(Array.isArray(tasks)).toBe(true);

      // Verify that dangling reference is safely omitted from resolved items
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe("Good Task");

      // Verify raw array retains original reference pointers
      expect((tasks as any)[DEM_RAW_ARRAY]).toEqual(["task-good", "task-nonexistent"]);
    });
  });
});
