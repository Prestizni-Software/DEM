import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../../AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  classProp,
  populatedRef,
  EntityDescriptor,
  globalCache,
  LoggersType,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";
import { ClientStateReconciler } from "../../sync/ClientStateReconciler.js";
import { ServerChangeTracker } from "../../sync/ServerChangeTracker.js";
import { MemoryStorageAdapter } from "../../sync/storage/MemoryStorageAdapter.js";
import {
  LocalStorageAdapter,
  LocalStorageAdapterOptions,
} from "../../sync/storage/LocalStorageAdapter.js";
import { StoredManagerState } from "../../sync/types.js";

// ============================================================================
// Test Models
// ============================================================================

/**
 * Client entity model for task management with snapshot metadata.
 */
class ConvergenceTaskClient extends AutoUpdatedClientObject<ConvergenceTaskClient> {
  @classProp
  public title!: string;

  @classProp
  public priority!: string;

  @classProp
  public completed!: boolean;

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  /**
   * Generates descriptor string for task entity.
   *
   * @param data - Partial entity attributes.
   * @returns Formatted task descriptor.
   */
  public static override getDescriptor(data: Partial<ConvergenceTaskClient>): string {
    return `Task: ${data.title ?? "Untitled"}`;
  }
}

/**
 * Client entity model with deep embedded subdocuments and audit log.
 */
class ConvergenceSnapshotClient extends AutoUpdatedClientObject<ConvergenceSnapshotClient> {
  @classProp
  public title!: string;

  @classProp
  public metadataSnapshot!: {
    audit: { signedBy: string; score: number };
    tags: string[];
    version: number;
  };

  @classProp
  public historyLog!: Array<{ action: string; timestamp: number }>;

  /**
   * Generates descriptor string for snapshot entity.
   *
   * @param data - Partial entity attributes.
   * @returns Formatted snapshot descriptor.
   */
  public static override getDescriptor(data: Partial<ConvergenceSnapshotClient>): string {
    return `Doc: ${data.title ?? "Untitled"} [v${data.metadataSnapshot?.version ?? 1}]`;
  }
}

/**
 * Client entity representing account profile with embedded limits.
 */
class OfflineAccountClient extends AutoUpdatedClientObject<OfflineAccountClient> {
  @classProp
  public username!: string;

  @classProp
  public profileSnapshot!: {
    tier: string;
    limits: { maxProjects: number };
  };

  /**
   * Generates descriptor string for account entity.
   *
   * @param data - Partial account attributes.
   * @returns Formatted account descriptor.
   */
  public static override getDescriptor(data: Partial<OfflineAccountClient>): string {
    return `Account: ${data.username ?? "Anonymous"}`;
  }
}

/**
 * Client entity representing project with reference and configuration.
 */
class OfflineProjectClient extends AutoUpdatedClientObject<OfflineProjectClient> {
  @classProp
  public projectName!: string;

  @populatedRef("OfflineAccountClient")
  public owner!: OfflineAccountClient;

  @classProp
  public configSnapshot!: {
    env: string;
    features: string[];
  };

  /**
   * Generates descriptor string for project entity.
   *
   * @param data - Partial project attributes.
   * @returns Formatted project descriptor.
   */
  public static override getDescriptor(data: Partial<OfflineProjectClient>): string {
    return `Project: ${data.projectName ?? "Untitled"}`;
  }
}

/**
 * Client entity representing document under dynamic clearance control.
 */
class SecuredDocClient extends AutoUpdatedClientObject<SecuredDocClient> {
  @classProp
  public title!: string;

  @classProp
  public classification!: "public" | "restricted";

  /**
   * Generates descriptor string for secured document.
   *
   * @param data - Partial document attributes.
   * @returns Formatted secured document descriptor.
   */
  public static override getDescriptor(data: Partial<SecuredDocClient>): string {
    return `Secured: ${data.title ?? "Untitled"} [${data.classification ?? "public"}]`;
  }
}

/**
 * Client entity representing resilient item for error recovery tests.
 */
class ResilientEntityClient extends AutoUpdatedClientObject<ResilientEntityClient> {
  @classProp
  public name!: string;

  @classProp
  public payload!: Record<string, unknown>;

  /**
   * Generates descriptor string for resilient entity.
   *
   * @param data - Partial entity attributes.
   * @returns Formatted resilient entity descriptor.
   */
  public static override getDescriptor(data: Partial<ResilientEntityClient>): string {
    return `Entity: ${data.name ?? "Unnamed"}`;
  }
}

/**
 * Server entity model for secured document access control tests.
 */
class SecuredDocServer extends AutoUpdatedServerObject<SecuredDocServer> {
  @classProp
  public _id!: any;

  @classProp
  public title!: string;

  @classProp
  public classification!: "public" | "restricted";

  /**
   * Generates descriptor string for server entity.
   *
   * @param data - Partial document attributes.
   * @returns Formatted document descriptor.
   */
  public static override getDescriptor(data: Partial<SecuredDocServer>): string {
    return `Secured: ${data.title ?? "Untitled"} [${data.classification ?? "public"}]`;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Linked mock socket pair for bidirectional communication tests.
 */
interface MockSocketPair {
  clientSocket: any;
  serverSocket: any;
}

/**
 * Creates linked pair of mock sockets for server and client communication.
 *
 * @param socketId - Socket identifier.
 * @returns Linked clientSocket and serverSocket bundle.
 */
function createBidirectionalSocketPair(socketId = "sock_test_pair"): MockSocketPair {
  const clientEmitter = new EventEmitter();
  const serverEmitter = new EventEmitter();
  const serverAnyListeners: Array<(event: string, ...args: any[]) => void> = [];

  const clientSocket: any = {
    id: socketId,
    connected: true,
    on: jest.fn((event: string, fn: (...args: any[]) => void) => {
      clientEmitter.on(event, fn);
      return clientSocket;
    }),
    off: jest.fn((event: string, fn: (...args: any[]) => void) => {
      clientEmitter.off(event, fn);
      return clientSocket;
    }),
    emit: jest.fn((event: string, ...args: any[]) => {
      for (const anyFn of serverAnyListeners) {
        anyFn(event, ...args);
      }
      serverEmitter.emit(event, ...args);
    }),
    _emitter: clientEmitter,
  };

  const serverSocket: any = {
    id: socketId,
    connected: true,
    data: {},
    eventNames: () => serverEmitter.eventNames(),
    on: jest.fn((event: string, fn: (...args: any[]) => void) => {
      serverEmitter.on(event, fn);
      return serverSocket;
    }),
    off: jest.fn((event: string, fn: (...args: any[]) => void) => {
      serverEmitter.off(event, fn);
      return serverSocket;
    }),
    onAny: jest.fn((fn: (event: string, ...args: any[]) => void) => {
      serverAnyListeners.push(fn);
    }),
    emit: jest.fn((event: string, ...args: any[]) => {
      clientEmitter.emit(event, ...args);
    }),
    disconnect: jest.fn(),
  };

  return { clientSocket, serverSocket };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a mock logger bundle with jest functions.
 *
 * @returns Logger bundle with no-op mock implementations.
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
 * Creates standard manager callbacks with jest mock functions.
 *
 * @returns Callbacks bundle.
 */
function createMockCallbacks() {
  return {
    new: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    progress: jest.fn(),
  };
}

/**
 * Creates a mock client socket with controllable events.
 *
 * @returns Mock socket object with emit and event methods.
 */
function createMockSocket() {
  const emitter = new EventEmitter();
  const mock = {
    id: "mock_client_socket",
    connected: true,
    on: jest.fn((event: string, fn: (...args: any[]) => void) => {
      emitter.on(event, fn);
      return mock;
    }),
    off: jest.fn((event: string, fn: (...args: any[]) => void) => {
      emitter.off(event, fn);
      return mock;
    }),
    emit: jest.fn(),
    _emitter: emitter,
  };
  return mock;
}

// ============================================================================
// Test Suite: Domain 6 Triplet Convergence & Edge Cases
// ============================================================================

describe("Domain 6: Triplet Convergence Edge-Case Tests", () => {
  let emitter: EventEmitter;
  let loggers: LoggersType;

  beforeEach(() => {
    // Clear global object cache before every test run.
    globalCache.clear();
    emitter = new EventEmitter();
    loggers = createMockLoggers();
  });

  // --------------------------------------------------------------------------
  // Triplet T03-01: F08 + F09 + F10 (Lazy + Delta + Persistent Storage)
  // --------------------------------------------------------------------------
  describe("T03-01: F08 + F09 + F10 (Lazy Loading + Delta Sync + Persistent Storage)", () => {
    it("restores cached lazy state and applies reconnect delta updating manifest and storage", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed persistent storage with cached snapshot at revision 10.
      await storageAdapter.saveManagerState("ConvergenceTaskClient", {
        className: "ConvergenceTaskClient",
        revision: 10,
        ids: ["task-1", "task-2", "task-3"],
        manifest: [
          { _id: "task-1", description: "Task: Task 1" },
          { _id: "task-2", description: "Task: Task 2" },
          { _id: "task-3", description: "Task: Task 3" },
        ],
        objects: [
          {
            _id: "task-1",
            title: "Task 1",
            priority: "high",
            completed: false,
            metadataSnapshot: { tags: ["initial"] },
          },
          {
            _id: "task-2",
            __isLazyStub: true,
            descriptor: "Task: Task 2",
          },
          {
            _id: "task-3",
            __isLazyStub: true,
            descriptor: "Task: Task 3",
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
        savedAt: Date.now(),
      });

      // Configure server delta response for reconnect.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceTaskClient") {
          callback({
            success: true,
            data: {
              status: "delta",
              revision: 13,
              changes: [
                {
                  revision: 11,
                  type: "delete",
                  id: "task-2",
                  timestamp: Date.now(),
                  estimatedBytes: 40,
                },
                {
                  revision: 12,
                  type: "update",
                  id: "task-1",
                  data: { completed: true, priority: "critical" },
                  timestamp: Date.now(),
                  estimatedBytes: 80,
                },
                {
                  revision: 13,
                  type: "create",
                  id: "task-4",
                  data: {
                    _id: "task-4",
                    title: "Task 4",
                    priority: "low",
                    completed: false,
                    metadataSnapshot: { tags: ["delta-created"] },
                  },
                  timestamp: Date.now(),
                  estimatedBytes: 120,
                },
              ],
              properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
            },
          });
        }
      });

      const clientManagers: Record<string, any> = {};
      const callbacks = createMockCallbacks();
      const taskManager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        clientManagers,
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      clientManagers["ConvergenceTaskClient"] = taskManager;

      // Execute startup with storage restoration and delta reconciliation.
      await taskManager.loadFromServer();

      // Verify that deleted entity was removed from memory.
      expect(taskManager.getObject("task-2")).toBeUndefined();

      // Verify that existing entity received delta update.
      const task1 = taskManager.getObject("task-1");
      expect(task1).toBeDefined();
      expect(task1?.completed).toBe(true);
      expect(task1?.priority).toBe("critical");
      expect(task1?.isLoaded).toBe(true);

      // Verify that new entity was added to memory.
      const task4 = taskManager.getObject("task-4");
      expect(task4).toBeDefined();
      expect(task4?.title).toBe("Task 4");

      // Verify that manifest reflects delta changes.
      expect(taskManager.manifest).toHaveLength(3);
      expect(taskManager.manifest.some((m) => m._id === "task-2")).toBe(false);
      expect(taskManager.manifest.some((m) => m._id === "task-4")).toBe(true);

      // Verify that storage adapter received reconciled state at revision 13.
      const stored = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(stored).not.toBeNull();
      expect(stored?.revision).toBe(13);
      expect(stored?.ids).toEqual(["task-1", "task-3", "task-4"]);
      expect(stored?.manifest?.some((m) => m._id === "task-2")).toBe(false);
      expect(stored?.manifest?.some((m) => m._id === "task-4")).toBe(true);

      // Verify offline restore from the newly persisted storage state.
      const freshManagers: Record<string, any> = {};
      const freshManager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        freshManagers,
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      const restoreRes = await ClientStateReconciler.restoreFromStorage(
        freshManager as any,
        storageAdapter,
      );

      expect(restoreRes.restored).toBe(true);
      expect(restoreRes.revision).toBe(13);
      expect(freshManager.getObject("task-1")?.completed).toBe(true);
      expect(freshManager.getObject("task-4")?.title).toBe("Task 4");
    });

    it("executes repeated delta sync cycles and persists accurate snapshots to storage", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed initial state at revision 1.
      await storageAdapter.saveManagerState("ConvergenceTaskClient", {
        className: "ConvergenceTaskClient",
        revision: 1,
        ids: ["item-a"],
        manifest: [{ _id: "item-a", description: "Task: Alpha" }],
        objects: [
          {
            _id: "item-a",
            title: "Alpha",
            priority: "low",
            completed: false,
            metadataSnapshot: { round: 1 },
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
        savedAt: Date.now(),
      });

      let currentDelta: any = null;
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceTaskClient") {
          callback({
            success: true,
            data: currentDelta,
          });
        }
      });

      const clientManagers: Record<string, any> = {};
      const manager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        clientManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      clientManagers["ConvergenceTaskClient"] = manager;

      // Cycle 1: delta creates item-b and item-c.
      currentDelta = {
        status: "delta",
        revision: 3,
        changes: [
          {
            revision: 2,
            type: "create",
            id: "item-b",
            data: { _id: "item-b", title: "Beta", priority: "medium", completed: false, metadataSnapshot: {} },
            timestamp: Date.now(),
            estimatedBytes: 80,
          },
          {
            revision: 3,
            type: "create",
            id: "item-c",
            data: { _id: "item-c", title: "Gamma", priority: "high", completed: false, metadataSnapshot: {} },
            timestamp: Date.now(),
            estimatedBytes: 80,
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
      };

      await manager.loadFromServer();
      expect(manager.lastRevision).toBe(3);
      expect(manager.manifest).toHaveLength(3);

      // Cycle 2: delta updates item-b and deletes item-a.
      const deltaPayload2 = {
        status: "delta" as const,
        revision: 5,
        changes: [
          {
            revision: 4,
            type: "update" as const,
            id: "item-b",
            data: { completed: true, priority: "critical" },
            timestamp: Date.now(),
            estimatedBytes: 60,
          },
          {
            revision: 5,
            type: "delete" as const,
            id: "item-a",
            timestamp: Date.now(),
            estimatedBytes: 40,
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
      };

      await ClientStateReconciler.applyDelta(manager as any, deltaPayload2, storageAdapter);
      expect(manager.getObject("item-a")).toBeUndefined();
      expect(manager.getObject("item-b")?.completed).toBe(true);
      expect(manager.manifest).toHaveLength(2);

      // Verify storage reflects final state.
      const stored = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(stored?.revision).toBe(5);
      expect(stored?.ids).toEqual(["item-b", "item-c"]);
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-02: F08 + F09 + F11 (Lazy + Delta + Self-Contained Entities)
  // --------------------------------------------------------------------------
  describe("T03-02: F08 + F09 + F11 (Lazy Loading + Delta Sync + Snapshot Entities)", () => {
    it("synchronizes complex embedded subdocuments through delta updates and auto-generates descriptors", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed storage with existing snapshot entity.
      await storageAdapter.saveManagerState("ConvergenceSnapshotClient", {
        className: "ConvergenceSnapshotClient",
        revision: 5,
        ids: ["snap-1"],
        manifest: [{ _id: "snap-1", description: "Doc: Initial Spec [v1]" }],
        objects: [
          {
            _id: "snap-1",
            title: "Initial Spec",
            metadataSnapshot: {
              audit: { signedBy: "reviewer", score: 80 },
              tags: ["draft"],
              version: 1,
            },
            historyLog: [{ action: "init", timestamp: 1000 }],
          },
        ],
        properties: ["title", "metadataSnapshot", "historyLog", "_id"],
        savedAt: Date.now(),
      });

      // Delta sync delivers deep subdocument update and new snapshot entity.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceSnapshotClient") {
          callback({
            success: true,
            data: {
              status: "delta",
              revision: 7,
              changes: [
                {
                  revision: 6,
                  type: "update",
                  id: "snap-1",
                  data: {
                    metadataSnapshot: {
                      audit: { signedBy: "compliance_lead", score: 98 },
                      tags: ["approved", "release"],
                      version: 2,
                    },
                    historyLog: [
                      { action: "init", timestamp: 1000 },
                      { action: "audit_passed", timestamp: 2000 },
                    ],
                  },
                  timestamp: Date.now(),
                  estimatedBytes: 200,
                },
                {
                  revision: 7,
                  type: "create",
                  id: "snap-2",
                  data: {
                    _id: "snap-2",
                    title: "Security Baseline",
                    metadataSnapshot: {
                      audit: { signedBy: "security_lead", score: 100 },
                      tags: ["baseline", "v1"],
                      version: 1,
                    },
                    historyLog: [{ action: "created", timestamp: 2500 }],
                  },
                  timestamp: Date.now(),
                  estimatedBytes: 220,
                },
              ],
              properties: ["title", "metadataSnapshot", "historyLog", "_id"],
            },
          });
        }
      });

      const callbacks = createMockCallbacks();
      const manager = new AutoUpdateClientManager(
        ConvergenceSnapshotClient as any,
        "ConvergenceSnapshotClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        callbacks,
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await manager.loadFromServer();

      // Verify that embedded subdocuments on existing entity were patched.
      const snap1 = manager.getObject("snap-1");
      expect(snap1).toBeDefined();
      expect(snap1?.metadataSnapshot.audit.score).toBe(98);
      expect(snap1?.metadataSnapshot.audit.signedBy).toBe("compliance_lead");
      expect(snap1?.metadataSnapshot.version).toBe(2);
      expect(snap1?.historyLog).toHaveLength(2);

      // Verify that newly created snapshot entity is populated.
      const snap2 = manager.getObject("snap-2");
      expect(snap2).toBeDefined();
      expect(snap2?.title).toBe("Security Baseline");
      expect(snap2?.metadataSnapshot.audit.score).toBe(100);

      // Verify that manifest contains auto-generated descriptor for new entity.
      const manifestEntry = manager.manifest.find((m) => m._id === "snap-2");
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry?.description).toBe("Doc: Security Baseline [v1]");

      // Verify that callbacks received update notification for nested fields.
      expect(callbacks.update).toHaveBeenCalledWith(snap1, "metadataSnapshot");
      expect(callbacks.new).toHaveBeenCalledWith(snap2);
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-03: F08 + F10 + F11 (Lazy + Storage + Offline Navigation)
  // --------------------------------------------------------------------------
  describe("T03-03: F08 + F10 + F11 (Lazy Loading + Persistent Storage + Offline Navigation)", () => {
    it("enables zero-network synchronous navigation across hydrated snapshot entities and references", async () => {
      const mockStorageBackend: Record<string, string> = {};
      const lsAdapter = new LocalStorageAdapter({
        storage: {
          getItem: (k: string) => mockStorageBackend[k] ?? null,
          setItem: (k: string, v: string) => {
            mockStorageBackend[k] = v;
          },
          removeItem: (k: string) => {
            delete mockStorageBackend[k];
          },
        },
      });

      // Save hydrated parent and child entities into LocalStorage.
      await lsAdapter.saveManagerState("OfflineAccountClient", {
        className: "OfflineAccountClient",
        revision: 4,
        ids: ["acc-100"],
        manifest: [{ _id: "acc-100", description: "Account: Alice" }],
        objects: [
          {
            _id: "acc-100",
            username: "Alice",
            profileSnapshot: { tier: "enterprise", limits: { maxProjects: 50 } },
          },
        ],
        properties: ["username", "profileSnapshot", "_id"],
        savedAt: Date.now(),
      });

      await lsAdapter.saveManagerState("OfflineProjectClient", {
        className: "OfflineProjectClient",
        revision: 4,
        ids: ["proj-200"],
        manifest: [{ _id: "proj-200", description: "Project: Alpha" }],
        objects: [
          {
            _id: "proj-200",
            projectName: "Alpha",
            owner: "acc-100",
            configSnapshot: { env: "production", features: ["telemetry", "audit"] },
          },
        ],
        properties: ["projectName", "owner", "configSnapshot", "_id"],
        savedAt: Date.now(),
      });

      // Construct a dead socket that throws if network transport is invoked.
      const deadSocket: any = {
        id: "offline_socket",
        connected: false,
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn().mockImplementation(() => {
          throw new Error("NETWORK_DISCONNECTED_FORBIDDEN");
        }),
      };

      const offlineManagers: Record<string, any> = {};
      const accountManager = new AutoUpdateClientManager(
        OfflineAccountClient as any,
        "OfflineAccountClient",
        deadSocket,
        loggers,
        offlineManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: lsAdapter },
        { lazyLoading: true },
      );

      const projectManager = new AutoUpdateClientManager(
        OfflineProjectClient as any,
        "OfflineProjectClient",
        deadSocket,
        loggers,
        offlineManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: lsAdapter },
        { lazyLoading: true },
      );

      offlineManagers["OfflineAccountClient"] = accountManager;
      offlineManagers["OfflineProjectClient"] = projectManager;

      // Restore both managers from local storage without network.
      await ClientStateReconciler.restoreFromStorage(accountManager as any, lsAdapter);
      await ClientStateReconciler.restoreFromStorage(projectManager as any, lsAdapter);

      const project = projectManager.getObject("proj-200");
      expect(project).toBeDefined();
      expect(project?.isLoaded).toBe(true);
      expect(project?.isLazyStub).toBe(false);
      expect(project?.configSnapshot.features).toContain("telemetry");

      // Verify that cross-manager reference resolves synchronously offline.
      const owner = project?.owner;
      expect(owner).toBeDefined();
      expect(owner?.username).toBe("Alice");
      expect(owner?.profileSnapshot.tier).toBe("enterprise");
      expect(owner?.profileSnapshot.limits.maxProjects).toBe(50);

      // Verify ensureLoaded resolves immediately without invoking dead socket.
      const ensuredProject = await project!.ensureLoaded();
      expect(ensuredProject).toBe(project);

      const ensuredOwner = await owner!.ensureLoaded();
      expect(ensuredOwner).toBe(owner);

      expect(deadSocket.emit).not.toHaveBeenCalled();
    });

    it("executes complete offline cycle with storage restore, navigation, error recovery, and reconnection", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      let isNetworkOnline = true;
      const mockSocket = createMockSocket();

      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (!isNetworkOnline) {
          callback({
            success: false,
            code: DEMErrorCode.SOCKET_NOT_CONNECTED,
            message: "Network offline.",
          });
          return;
        }

        if (event === "startupConvergenceTaskClient") {
          callback({
            success: true,
            data: {
              status: "lazy",
              revision: 1,
              ids: ["cycle-1", "cycle-2"],
              manifest: [
                { _id: "cycle-1", description: "Task: Cycle Item One" },
                { _id: "cycle-2", description: "Task: Cycle Item Two" },
              ],
              properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
            },
          });
        } else if (event === "getConvergenceTaskClientcycle-1") {
          callback({
            success: true,
            data: {
              _id: "cycle-1",
              title: "Cycle Item One",
              priority: "high",
              completed: false,
              metadataSnapshot: { hydratedAt: 1 },
            },
          });
        } else if (event === "getConvergenceTaskClientcycle-2") {
          callback({
            success: true,
            data: {
              _id: "cycle-2",
              title: "Cycle Item Two",
              priority: "medium",
              completed: true,
              metadataSnapshot: { hydratedAt: 2 },
            },
          });
        }
      });

      const clientManagers: Record<string, any> = {};
      const manager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        clientManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      clientManagers["ConvergenceTaskClient"] = manager;

      // Step 1: Initial online startup.
      await manager.loadFromServer();
      expect(manager.manifest).toHaveLength(2);

      // Step 2: Hydrate cycle-1 on demand online.
      await manager.loadObject("cycle-1");
      expect(manager.getObject("cycle-1")?.isLoaded).toBe(true);
      expect(manager.getObject("cycle-2")?.isLazyStub).toBe(true);

      // Step 3: Simulate device disconnect.
      isNetworkOnline = false;

      // Step 4: Restart client offline from storage.
      const offlineManagers: Record<string, any> = {};
      const offlineManager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        offlineManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      await ClientStateReconciler.restoreFromStorage(offlineManager as any, storageAdapter);

      // Step 5: Read hydrated entity offline.
      const offlineCycle1 = offlineManager.getObject("cycle-1");
      expect(offlineCycle1?.isLoaded).toBe(true);
      expect(offlineCycle1?.title).toBe("Cycle Item One");

      // Step 6: Verify offline stub hydration fails cleanly.
      const offlineCycle2 = offlineManager.getObject("cycle-2");
      expect(offlineCycle2?.isLazyStub).toBe(true);
      await expect(offlineCycle2!.ensureLoaded()).rejects.toThrow(DEMError);
      expect(offlineCycle2?.isLazyStub).toBe(true);

      // Step 7: Reconnect network and synchronize delta.
      isNetworkOnline = true;
      const deltaReconnect = {
        status: "delta" as const,
        revision: 3,
        changes: [
          {
            revision: 2,
            type: "update" as const,
            id: "cycle-1",
            data: { priority: "critical" },
            timestamp: Date.now(),
            estimatedBytes: 50,
          },
          {
            revision: 3,
            type: "create" as const,
            id: "cycle-3",
            data: {
              _id: "cycle-3",
              title: "Cycle Item Three",
              priority: "low",
              completed: false,
              metadataSnapshot: {},
            },
            timestamp: Date.now(),
            estimatedBytes: 70,
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
      };

      await ClientStateReconciler.applyDelta(offlineManager as any, deltaReconnect, storageAdapter);
      expect(offlineManager.getObject("cycle-1")?.priority).toBe("critical");
      expect(offlineManager.getObject("cycle-3")?.title).toBe("Cycle Item Three");
      expect(offlineManager.manifest).toHaveLength(3);

      // Step 8: Hydrate cycle-2 online now that network is restored.
      await offlineManager.loadObject("cycle-2");
      expect(offlineManager.getObject("cycle-2")?.isLoaded).toBe(true);
      expect(offlineManager.getObject("cycle-2")?.title).toBe("Cycle Item Two");

      const storedFinal = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(storedFinal?.ids).toEqual(["cycle-1", "cycle-2", "cycle-3"]);
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-04: F08 + F09 + F13 (Lazy + Delta + Dynamic Permissions)
  // --------------------------------------------------------------------------
  describe("T03-04: F08 + F09 + F13 (Lazy Loading + Delta Sync + Dynamic Permissions)", () => {
    it("filters manifest descriptors and delta change entries based on socket authorization", () => {
      const tracker = new ServerChangeTracker("SecuredDocClient");

      // Server records changes with mixed classification levels.
      tracker.recordChange("create", "doc-public-1", {
        title: "Public Guide",
        classification: "public",
      }); // rev 1
      tracker.recordChange("create", "doc-secret-2", {
        title: "Secret Key",
        classification: "restricted",
      }); // rev 2
      tracker.recordChange("update", "doc-public-1", {
        title: "Public Guide Revised",
      }); // rev 3
      tracker.recordChange("create", "doc-secret-3", {
        title: "Private Blueprint",
        classification: "restricted",
      }); // rev 4
      tracker.recordChange("create", "doc-public-2", {
        title: "Community Notes",
        classification: "public",
      }); // rev 5

      // Client with 'guest' clearance permitted to see only public entity IDs.
      const guestAllowedIds = new Set(["doc-public-1", "doc-public-2"]);

      // Request changes since revision 0 for guest client.
      const guestChanges = tracker.getChangesSince(0, guestAllowedIds);

      expect(guestChanges.isExpired).toBe(false);
      expect(guestChanges.changes).toHaveLength(3);

      // Verify restricted documents are omitted from delta payload.
      const deliveredIds = guestChanges.changes.map((c) => c.id);
      expect(deliveredIds).toEqual(["doc-public-1", "doc-public-1", "doc-public-2"]);
      expect(deliveredIds.includes("doc-secret-2")).toBe(false);
      expect(deliveredIds.includes("doc-secret-3")).toBe(false);

      // Admin clearance permitted to see all entity IDs.
      const adminChanges = tracker.getChangesSince(0);
      expect(adminChanges.changes).toHaveLength(5);
    });

    it("applies filtered delta to client manager without exposing unauthorized entities", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed storage with only authorized public document.
      await storageAdapter.saveManagerState("SecuredDocClient", {
        className: "SecuredDocClient",
        revision: 1,
        ids: ["doc-public-1"],
        manifest: [{ _id: "doc-public-1", description: "Secured: Public Guide [public]" }],
        objects: [
          {
            _id: "doc-public-1",
            title: "Public Guide",
            classification: "public",
          },
        ],
        properties: ["title", "classification", "_id"],
        savedAt: Date.now(),
      });

      // Server responds with filtered delta containing only permitted entities.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupSecuredDocClient") {
          callback({
            success: true,
            data: {
              status: "delta",
              revision: 5,
              changes: [
                {
                  revision: 3,
                  type: "update",
                  id: "doc-public-1",
                  data: { title: "Public Guide Revised" },
                  timestamp: Date.now(),
                  estimatedBytes: 60,
                },
                {
                  revision: 5,
                  type: "create",
                  id: "doc-public-2",
                  data: {
                    _id: "doc-public-2",
                    title: "Community Notes",
                    classification: "public",
                  },
                  timestamp: Date.now(),
                  estimatedBytes: 80,
                },
              ],
              properties: ["title", "classification", "_id"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        SecuredDocClient as any,
        "SecuredDocClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await clientManager.loadFromServer();

      // Verify client cache contains only authorized entities.
      expect(clientManager.getObject("doc-public-1")?.title).toBe("Public Guide Revised");
      expect(clientManager.getObject("doc-public-2")?.title).toBe("Community Notes");
      expect(clientManager.getObject("doc-secret-2")).toBeUndefined();
      expect(clientManager.manifest).toHaveLength(2);

      // Verify persistent storage contains only authorized entities.
      const stored = await storageAdapter.loadManagerState("SecuredDocClient");
      expect(stored?.ids).toEqual(["doc-public-1", "doc-public-2"]);
    });

    it("enforces dynamic access control end-to-end between AutoUpdateServerManager and AutoUpdateClientManager", async () => {
      const { clientSocket, serverSocket } = createBidirectionalSocketPair();
      const storageAdapter = new MemoryStorageAdapter();

      const mockModel: any = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        schema: { path: jest.fn().mockReturnValue(true) },
        db: { readyState: 1 },
      };

      const mockServerInstance: any = {
        use: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };

      const serverManagers: Record<string, any> = {};
      const serverManager = new AutoUpdateServerManager(
        SecuredDocServer as any,
        "SecuredDocClient",
        mockServerInstance,
        loggers,
        mockModel,
        serverManagers,
        emitter,
        {
          lazyLoading: true,
          deltaSync: true,
          accessDefinitions: {
            startupMiddleware: async (objects: any[], _managers: any, socket: any) => {
              if (socket.data?.role === "admin") {
                return objects;
              }
              return objects.filter((o) => o.classification === "public");
            },
          },
        },
      );
      serverManagers["SecuredDocClient"] = serverManager;

      // Populate server with public and restricted objects.
      const docPub = new SecuredDocServer(
        SecuredDocServer as any,
        serverSocket,
        { _id: "doc-1", title: "Public Report", classification: "public" } as any,
        loggers,
        "SecuredDocClient",
        serverManager,
        emitter,
      );
      const docPriv = new SecuredDocServer(
        SecuredDocServer as any,
        serverSocket,
        { _id: "doc-2", title: "Private Strategy", classification: "restricted" } as any,
        loggers,
        "SecuredDocClient",
        serverManager,
        emitter,
      );

      (serverManager as any).objects_["doc-1"] = docPub;
      (serverManager as any).objects_["doc-2"] = docPriv;

      // Register socket on server.
      serverManager.registerSocket(serverSocket);

      // Assign guest role to socket.
      serverSocket.data = { role: "guest" };

      const clientManagers: Record<string, any> = {};
      const clientManager = new AutoUpdateClientManager(
        SecuredDocClient as any,
        "SecuredDocClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );
      clientManagers["SecuredDocClient"] = clientManager;

      // Startup over bidirectional socket pair.
      await clientManager.loadFromServer();

      // Guest receives only public document in manifest.
      expect(clientManager.manifest).toHaveLength(1);
      expect(clientManager.manifest[0]._id).toBe("doc-1");
      expect(clientManager.getObject("doc-1")).toBeDefined();
      expect(clientManager.getObject("doc-2")).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-05: F08 + F10 + F14 (Lazy + Storage + Offline Error Recovery)
  // --------------------------------------------------------------------------
  describe("T03-05: F08 + F10 + F14 (Lazy Loading + Storage Adapter + Error Recovery)", () => {
    it("fails with structured DEMError when hydrating unhydrated stub while offline", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Save state containing one hydrated entity and one lazy stub.
      await storageAdapter.saveManagerState("ResilientEntityClient", {
        className: "ResilientEntityClient",
        revision: 2,
        ids: ["ent-hydrated", "ent-stub"],
        manifest: [
          { _id: "ent-hydrated", description: "Entity: Hydrated Active" },
          { _id: "ent-stub", description: "Entity: Lazy Stub" },
        ],
        objects: [
          {
            _id: "ent-hydrated",
            name: "Hydrated Active",
            payload: { active: true },
          },
          {
            _id: "ent-stub",
            __isLazyStub: true,
            descriptor: "Entity: Lazy Stub",
          },
        ],
        properties: ["name", "payload", "_id"],
        savedAt: Date.now(),
      });

      // Socket returns connection failure on fetch attempt.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event.startsWith("getResilientEntityClient")) {
          callback({
            success: false,
            code: DEMErrorCode.SOCKET_NOT_CONNECTED,
            message: "Cannot hydrate stub because socket transport is offline.",
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        ResilientEntityClient as any,
        "ResilientEntityClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await ClientStateReconciler.restoreFromStorage(manager as any, storageAdapter);

      const stub = manager.getObject("ent-stub");
      const hydrated = manager.getObject("ent-hydrated");

      expect(stub?.isLazyStub).toBe(true);
      expect(hydrated?.isLazyStub).toBe(false);

      // Attempt to hydrate stub while offline and assert structured DEMError.
      await expect(stub!.ensureLoaded()).rejects.toThrow(DEMError);

      try {
        await stub!.ensureLoaded();
      } catch (err: any) {
        expect(err instanceof DEMError).toBe(true);
        expect(err.code).toBe(DEMErrorCode.SOCKET_NOT_CONNECTED);
      }

      // Assert that stub state is uncorrupted and still flagged as lazy stub.
      expect(stub?.isLazyStub).toBe(true);
      expect(stub?.descriptor).toBe("Entity: Lazy Stub");

      // Assert that hydrated entity remains fully accessible and unaffected.
      expect(hydrated?.isLoaded).toBe(true);
      expect(hydrated?.name).toBe("Hydrated Active");
      expect(hydrated?.payload).toEqual({ active: true });

      // Now simulate network restoration.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event.startsWith("getResilientEntityClient")) {
          callback({
            success: true,
            data: {
              _id: "ent-stub",
              name: "Recovered On Demand",
              payload: { active: true, restoredAt: 12345 },
            },
          });
        }
      });

      // Re-attempt hydration after reconnection.
      await stub!.ensureLoaded();
      expect(stub?.isLazyStub).toBe(false);
      expect(stub?.isLoaded).toBe(true);
      expect(stub?.name).toBe("Recovered On Demand");

      // Verify that persistent storage recorded the hydrated entity.
      const stored = await storageAdapter.loadManagerState("ResilientEntityClient");
      const storedStub: any = stored?.objects.find((o: any) => o._id === "ent-stub");
      expect(storedStub.__isLazyStub).toBeFalsy();
      expect(storedStub.name).toBe("Recovered On Demand");
    });

    it("rejects with structured DEMError when entity hydration times out", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      await storageAdapter.saveManagerState("ResilientEntityClient", {
        className: "ResilientEntityClient",
        revision: 1,
        ids: ["ent-timeout"],
        manifest: [{ _id: "ent-timeout", description: "Entity: Timeout Test" }],
        objects: [
          {
            _id: "ent-timeout",
            __isLazyStub: true,
            descriptor: "Entity: Timeout Test",
          },
        ],
        properties: ["name", "payload", "_id"],
        savedAt: Date.now(),
      });

      // Socket returns timeout error response.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event.startsWith("getResilientEntityClient")) {
          callback({
            success: false,
            code: DEMErrorCode.TIMEOUT,
            message: "Hydration request timed out.",
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        ResilientEntityClient as any,
        "ResilientEntityClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await ClientStateReconciler.restoreFromStorage(manager as any, storageAdapter);
      const stub = manager.getObject("ent-timeout");

      await expect(stub!.ensureLoaded()).rejects.toThrow(DEMError);

      try {
        await stub!.ensureLoaded();
      } catch (err: any) {
        expect(err instanceof DEMError).toBe(true);
        expect(err.code).toBe(DEMErrorCode.TIMEOUT);
      }

      // Assert stub remains uncorrupted.
      expect(stub?.isLazyStub).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-06: F09 + F10 + F13 (Delta + Storage + Dynamic Permissions)
  // --------------------------------------------------------------------------
  describe("T03-06: F09 + F10 + F13 (Delta Sync + Storage + Mid-Session Permissions)", () => {
    it("prunes revoked entities from memory and persistent storage when permissions change", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed storage with reports from previous high-privilege session.
      await storageAdapter.saveManagerState("SecuredDocClient", {
        className: "SecuredDocClient",
        revision: 10,
        ids: ["rep-public", "rep-confidential-1", "rep-confidential-2"],
        manifest: [
          { _id: "rep-public", description: "Secured: Public Info [public]" },
          { _id: "rep-confidential-1", description: "Secured: Budget [restricted]" },
          { _id: "rep-confidential-2", description: "Secured: Strategy [restricted]" },
        ],
        objects: [
          { _id: "rep-public", title: "Public Info", classification: "public" },
          { _id: "rep-confidential-1", title: "Budget", classification: "restricted" },
          { _id: "rep-confidential-2", title: "Strategy", classification: "restricted" },
        ],
        properties: ["title", "classification", "_id"],
        savedAt: Date.now(),
      });

      // Role changed to viewer: server lazy response returns only public item.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupSecuredDocClient") {
          callback({
            success: true,
            data: {
              status: "lazy",
              revision: 11,
              ids: ["rep-public"],
              manifest: [{ _id: "rep-public", description: "Secured: Public Info [public]" }],
              properties: ["title", "classification", "_id"],
            },
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        SecuredDocClient as any,
        "SecuredDocClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await manager.loadFromServer();

      // Verify that revoked entities are purged from in-memory objects.
      expect(manager.getObject("rep-public")).toBeDefined();
      expect(manager.getObject("rep-confidential-1")).toBeUndefined();
      expect(manager.getObject("rep-confidential-2")).toBeUndefined();
      expect(manager.manifest).toHaveLength(1);

      // Verify that persistent storage adapter was pruned.
      const stored = await storageAdapter.loadManagerState("SecuredDocClient");
      expect(stored?.ids).toEqual(["rep-public"]);
      expect(stored?.manifest).toEqual([
        { _id: "rep-public", description: "Secured: Public Info [public]" },
      ]);
      expect(stored?.objects).toHaveLength(1);
      expect(stored?.objects[0]._id).toBe("rep-public");
    });
  });

  // --------------------------------------------------------------------------
  // Triplet T03-07: F08 + F09 + F14 (Lazy + Delta + Structured Error Fallback)
  // --------------------------------------------------------------------------
  describe("T03-07: F08 + F09 + F14 (Lazy Loading + Delta Sync + Expired Revision Fallback)", () => {
    it("preserves locally hydrated entity data when delta sync revision expires and falls back to lazy", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed storage with revision 2 where task-1 is hydrated and task-2 is a stub.
      await storageAdapter.saveManagerState("ConvergenceTaskClient", {
        className: "ConvergenceTaskClient",
        revision: 2,
        ids: ["task-1", "task-2"],
        manifest: [
          { _id: "task-1", description: "Task: Preserved Hydrated Task" },
          { _id: "task-2", description: "Task: Old Stub Task" },
        ],
        objects: [
          {
            _id: "task-1",
            title: "Preserved Hydrated Task",
            priority: "urgent",
            completed: false,
            metadataSnapshot: { localWork: "in-progress" },
          },
          {
            _id: "task-2",
            __isLazyStub: true,
            descriptor: "Task: Old Stub Task",
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
        savedAt: Date.now(),
      });

      // Server indicates delta expired and returns fallback status 'lazy' at revision 20.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceTaskClient") {
          callback({
            success: true,
            data: {
              status: "lazy",
              revision: 20,
              ids: ["task-1", "task-2", "task-3"],
              manifest: [
                { _id: "task-1", description: "Task: Preserved Hydrated Task" },
                { _id: "task-2", description: "Task: Old Stub Task" },
                { _id: "task-3", description: "Task: Brand New Remote Task" },
              ],
              properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
            },
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await manager.loadFromServer();

      // Verify that task-1 preserved its hydrated state rather than reverting to a stub.
      const task1 = manager.getObject("task-1");
      expect(task1).toBeDefined();
      expect(task1?.isLoaded).toBe(true);
      expect(task1?.isLazyStub).toBe(false);
      expect(task1?.title).toBe("Preserved Hydrated Task");
      expect(task1?.priority).toBe("urgent");
      expect(task1?.metadataSnapshot).toEqual({ localWork: "in-progress" });

      // Verify that task-2 remains a stub.
      const task2 = manager.getObject("task-2");
      expect(task2?.isLazyStub).toBe(true);

      // Verify that task-3 was added as a new stub.
      const task3 = manager.getObject("task-3");
      expect(task3?.isLazyStub).toBe(true);
      expect(task3?.descriptor).toBe("Task: Brand New Remote Task");

      // Verify that storage adapter was updated with revision 20.
      const stored = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(stored?.revision).toBe(20);
      expect(stored?.ids).toEqual(["task-1", "task-2", "task-3"]);

      const storedTask1: any = stored?.objects.find((o: any) => o._id === "task-1");
      expect(storedTask1.__isLazyStub).toBeFalsy();
      expect(storedTask1.title).toBe("Preserved Hydrated Task");
    });

    it("rejects with structured DEMError on server startup failure without corrupting cache", async () => {
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      // Seed storage with valid state.
      await storageAdapter.saveManagerState("ConvergenceTaskClient", {
        className: "ConvergenceTaskClient",
        revision: 5,
        ids: ["task-safe"],
        manifest: [{ _id: "task-safe", description: "Task: Safe" }],
        objects: [
          {
            _id: "task-safe",
            title: "Safe",
            priority: "low",
            completed: true,
            metadataSnapshot: {},
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
        savedAt: Date.now(),
      });

      // Server returns startup error with structured code.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceTaskClient") {
          callback({
            success: false,
            code: DEMErrorCode.STARTUP_FAILED,
            message: "Authentication token expired during startup handshake.",
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      // Load attempt should reject with typed DEMError.
      await expect(manager.loadFromServer()).rejects.toThrow(DEMError);

      try {
        await manager.loadFromServer();
      } catch (err: any) {
        expect(err instanceof DEMError).toBe(true);
        expect(err.code).toBe(DEMErrorCode.STARTUP_FAILED);
      }

      // Verify that persistent storage remained uncorrupted.
      const stored = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(stored?.ids).toEqual(["task-safe"]);
    });

    it("handles server changelog pruning with ServerChangeTracker forcing lazy fallback while preserving multiple hydrated items", async () => {
      const tracker = new ServerChangeTracker("ConvergenceTaskClient", {
        maxEntries: 2,
      });

      // Server records 5 changes, pruning earliest entries.
      tracker.recordChange("create", "task-1", { title: "T1" });
      tracker.recordChange("create", "task-2", { title: "T2" });
      tracker.recordChange("update", "task-1", { title: "T1 Updated" });
      tracker.recordChange("create", "task-3", { title: "T3" });
      tracker.recordChange("update", "task-3", { title: "T3 Updated" });

      // Client asking for revision 1 should be expired.
      const changesRes = tracker.getChangesSince(1);
      expect(changesRes.isExpired).toBe(true);

      // Client manager has revision 1 with both task-1 and task-2 hydrated.
      const storageAdapter = new MemoryStorageAdapter();
      const mockSocket = createMockSocket();

      await storageAdapter.saveManagerState("ConvergenceTaskClient", {
        className: "ConvergenceTaskClient",
        revision: 1,
        ids: ["task-1", "task-2"],
        manifest: [
          { _id: "task-1", description: "Task: T1" },
          { _id: "task-2", description: "Task: T2" },
        ],
        objects: [
          {
            _id: "task-1",
            title: "T1 Local Hydrated",
            priority: "urgent",
            completed: false,
            metadataSnapshot: { saved: true },
          },
          {
            _id: "task-2",
            title: "T2 Local Hydrated",
            priority: "medium",
            completed: true,
            metadataSnapshot: { saved: true },
          },
        ],
        properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
        savedAt: Date.now(),
      });

      // Server returns status 'lazy' because delta was expired.
      mockSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
        const callback = typeof ack === "function" ? ack : payload;
        if (event === "startupConvergenceTaskClient") {
          callback({
            success: true,
            data: {
              status: "lazy",
              revision: tracker.getCurrentRevision(),
              ids: ["task-1", "task-2", "task-3"],
              manifest: [
                { _id: "task-1", description: "Task: T1 Server Descriptor" },
                { _id: "task-2", description: "Task: T2 Server Descriptor" },
                { _id: "task-3", description: "Task: T3 New Stub" },
              ],
              properties: ["title", "priority", "completed", "metadataSnapshot", "_id"],
            },
          });
        }
      });

      const manager = new AutoUpdateClientManager(
        ConvergenceTaskClient as any,
        "ConvergenceTaskClient",
        mockSocket as any,
        loggers,
        {},
        emitter,
        createMockCallbacks(),
        undefined,
        { storage: storageAdapter },
        { lazyLoading: true },
      );

      await manager.loadFromServer();

      // Both local hydrated objects must be preserved.
      const task1 = manager.getObject("task-1");
      const task2 = manager.getObject("task-2");
      const task3 = manager.getObject("task-3");

      expect(task1?.isLoaded).toBe(true);
      expect(task1?.title).toBe("T1 Local Hydrated");

      expect(task2?.isLoaded).toBe(true);
      expect(task2?.title).toBe("T2 Local Hydrated");

      expect(task3?.isLazyStub).toBe(true);
      expect(task3?.descriptor).toBe("Task: T3 New Stub");

      // Verify persistent storage updated with revision 5.
      const stored = await storageAdapter.loadManagerState("ConvergenceTaskClient");
      expect(stored?.revision).toBe(5);
      expect(stored?.ids).toEqual(["task-1", "task-2", "task-3"]);
    });
  });

  // --------------------------------------------------------------------------
  // Storage Resilience & Quota Edge Cases
  // --------------------------------------------------------------------------
  describe("Storage Resilience: Quota Exceeded and Corrupted Payload Recovery", () => {
    it("handles LocalStorage quota exceeded gracefully during state persistence", async () => {
      const quotaStorageBackend = {
        getItem: jest.fn().mockReturnValue(null),
        setItem: jest.fn().mockImplementation(() => {
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        }),
        removeItem: jest.fn(),
      };

      const lsAdapter = new LocalStorageAdapter({ storage: quotaStorageBackend as any });

      const state: StoredManagerState<any> = {
        className: "ConvergenceTaskClient",
        revision: 10,
        ids: ["task-1"],
        objects: [{ _id: "task-1", title: "Quota Task" }],
        properties: ["title", "_id"],
        savedAt: Date.now(),
      };

      // saveManagerState should not throw when quota is exceeded.
      await expect(lsAdapter.saveManagerState("ConvergenceTaskClient", state)).resolves.not.toThrow();
      expect(quotaStorageBackend.setItem).toHaveBeenCalled();
    });

    it("recovers cleanly from corrupted JSON payload in LocalStorageAdapter", async () => {
      const corruptBackend = {
        getItem: jest.fn().mockReturnValue("INVALID_NON_JSON_PAYLOAD {{{"),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };

      const lsAdapter = new LocalStorageAdapter({ storage: corruptBackend as any });

      // loadManagerState should return null instead of throwing JSON parse error.
      const loaded = await lsAdapter.loadManagerState("ConvergenceTaskClient");
      expect(loaded).toBeNull();

      // ClientStateReconciler should handle null gracefully.
      const mockManager: any = {
        className: "ConvergenceTaskClient",
        objects_: {},
        loggers: createMockLoggers(),
      };

      const res = await ClientStateReconciler.restoreFromStorage(mockManager, lsAdapter);
      expect(res.restored).toBe(false);
      expect(res.count).toBe(0);
      expect(res.revision).toBe(0);
    });

    it("recovers cleanly from missing or invalid schema structure in storage payload", async () => {
      const malformedBackend = {
        getItem: jest.fn().mockReturnValue(JSON.stringify({ someKey: "no_revision_or_ids" })),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };

      const lsAdapter = new LocalStorageAdapter({ storage: malformedBackend as any });

      const loaded = await lsAdapter.loadManagerState("ConvergenceTaskClient");
      expect(loaded).toBeNull();
    });
  });
});
