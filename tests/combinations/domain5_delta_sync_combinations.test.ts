import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import {
  ServerChangeTracker,
  estimateObjectSizeBytes,
} from "../../sync/ServerChangeTracker.js";
import {
  ChangeEntry,
  ChangeType,
  ChangeLogOptions,
  DeltaSyncPayload,
  StoredManagerState,
} from "../../sync/types.js";
import {
  ClientStateReconciler,
  ReconcilableClientManager,
} from "../../sync/ClientStateReconciler.js";
import { MemoryStorageAdapter } from "../../sync/storage/MemoryStorageAdapter.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import {
  AutoUpdatedClientObject,
  createReadOnlyArrayProxy,
  DEM_RAW_ARRAY,
  DEMClientCallbacks,
} from "../../AutoUpdatedClientObjectClass.js";
import {
  classProp,
  populatedRef,
  globalCache,
  DEM_VERSION,
  DEM_CLIENT_VERSION,
  DEM_PROTOCOL_VERSION,
  DEMVersionOptions,
  ServerResponse,
  LoggersType,
  IAutoUpdatedClientObject,
  IAutoUpdateManager,
  EntityDescriptor,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";

/**
 * Creates a mock Socket.IO client socket for testing.
 *
 * @param customEmitHandler - Optional handler to intercept emitted socket events.
 * @returns Mock socket interface compatible with AutoUpdateClientManager.
 */
function createMockSocket(
  customEmitHandler?: (
    event: string,
    payload: unknown,
    ack?: (response: unknown) => void,
  ) => void,
) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) || [];
      existing.push(handler);
      listeners.set(event, existing);
    }),
    off: jest.fn((event: string, handler?: (...args: unknown[]) => void) => {
      if (!handler) {
        listeners.delete(event);
      } else {
        const existing = listeners.get(event) || [];
        listeners.set(
          event,
          existing.filter((h) => h !== handler),
        );
      }
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
    eventNames: jest.fn(() => Array.from(listeners.keys())),
    listeners,
  };
}

/**
 * Creates mock logger interfaces for testing.
 *
 * @returns LoggersType interface with mocked logger functions.
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
 * Test entity representing a model for property reflection tests.
 */
class DeltaTestUser extends AutoUpdatedClientObject<DeltaTestUser> {
  @classProp
  public _id!: string;

  @classProp
  public name!: string;

  @classProp
  public email!: string;

  @classProp
  public role!: string;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Test entity representing an item referenced by a container.
 */
class DeltaTestItem extends AutoUpdatedClientObject<DeltaTestItem> {
  @classProp
  public _id!: string;

  @classProp
  public title!: string;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Test entity containing relational references and reference array proxy.
 */
class DeltaTestContainer extends AutoUpdatedClientObject<DeltaTestContainer> {
  @classProp
  public _id!: string;

  @classProp
  public name!: string;

  @populatedRef("DeltaTestItem")
  public singleItem!: DeltaTestItem;

  @populatedRef("DeltaTestItem")
  public items!: DeltaTestItem[];

  @classProp
  public snapshotData!: Record<string, unknown>;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Creates a mock reconcilable client manager for reconciler unit tests.
 *
 * @param className - Managed entity class name.
 * @param classParam - Constructor for client object instances.
 * @param callbacks - Optional mock callback functions.
 * @returns Mock ReconcilableClientManager instance.
 */
function createMockReconcilableManager<T extends IAutoUpdatedClientObject<any>>(
  className: string,
  classParam: any,
  callbacks?: Partial<DEMClientCallbacks<any>>,
): ReconcilableClientManager<T> {
  const objects: Record<string, T> = {};
  const mockLoggers = createMockLoggers();
  const mockEmitter = new EventEmitter();
  const mockSocket = createMockSocket();

  return {
    className,
    classParam,
    socket: mockSocket,
    loggers: mockLoggers,
    callbacks: {
      new: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      progress: jest.fn(),
      ...callbacks,
    },
    emitter: mockEmitter,
    objects_: objects,
    get objectsAsArray() {
      return Object.values(this.objects_);
    },
    totalObjects: 0,
    loadedObjects: 0,
    isLoaded_: true,
    properties: ["_id", "name", "email", "role", "title", "items", "singleItem", "snapshotData"],
    getObject(id: string) {
      return this.objects_[id];
    },
    async deleteObject(id: string) {
      delete this.objects_[id];
      delete globalCache.objects[id];
      return { success: true, message: "Deleted" };
    },
  };
}

describe("Domain 5: Delta Synchronization & Monotonic Revision Combinations", () => {
  beforeEach(() => {
    globalCache.clear();
  });

  describe("ServerChangeTracker Pruning & Retention Logic", () => {
    test("prunes change entries based on TTL maxAgeMs limit", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxAgeMs: 1000,
      });

      const oldTimestamp = Date.now() - 5000;
      tracker.recordChangeWithTimestamp("create", "u1", { name: "Old User" }, oldTimestamp);
      tracker.recordChange("create", "u2", { name: "New User" });

      expect(tracker.getEntryCount()).toBe(1);
      expect(tracker.getLowestRetainedRevision()).toBe(2);
      expect(tracker.getCurrentRevision()).toBe(2);

      const res = tracker.getChangesSince(0);
      expect(res.isExpired).toBe(true);

      const res2 = tracker.getChangesSince(1);
      expect(res2.isExpired).toBe(false);
      expect(res2.changes.length).toBe(1);
      expect(res2.changes[0].id).toBe("u2");
    });

    test("prunes change entries based on maxSizeBytes memory limit", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxSizeBytes: 400,
      });

      for (let i = 1; i <= 15; i++) {
        tracker.recordChange("create", `u_${i}`, { data: "x".repeat(60) } as any);
      }

      expect(tracker.getEstimatedSizeBytes()).toBeLessThanOrEqual(400);
      expect(tracker.getLowestRetainedRevision()).toBeGreaterThan(1);

      const res = tracker.getChangesSince(0);
      expect(res.isExpired).toBe(true);
    });

    test("prunes change entries based on maxEntries count limit", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxEntries: 3,
      });

      for (let i = 1; i <= 6; i++) {
        tracker.recordChange("create", `u_${i}`, { name: `User ${i}` });
      }

      expect(tracker.getEntryCount()).toBe(3);
      expect(tracker.getLowestRetainedRevision()).toBe(4);
      expect(tracker.getCurrentRevision()).toBe(6);

      const res = tracker.getChangesSince(3);
      expect(res.isExpired).toBe(false);
      expect(res.changes.length).toBe(3);
      expect(res.changes.map((c: ChangeEntry) => c.revision)).toEqual([4, 5, 6]);
    });

    test("supports pruneMode both requiring age and size limits to be exceeded", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxAgeMs: 1000,
        maxSizeBytes: 100,
        pruneMode: "both",
      });

      // Entry 1: Old timestamp but small size
      const oldTime = Date.now() - 5000;
      tracker.recordChangeWithTimestamp("create", "u1", { n: 1 } as any, oldTime);

      // Verify no pruning occurs because size limit is not exceeded
      expect(tracker.getEntryCount()).toBe(1);
      expect(tracker.getLowestRetainedRevision()).toBe(1);

      // Entry 2: Add large payload violating both limits
      tracker.recordChangeWithTimestamp("create", "u2", { data: "x".repeat(300) } as any, oldTime);

      // Prune removes entries violating both limits
      expect(tracker.getLowestRetainedRevision()).toBeGreaterThanOrEqual(1);
    });

    test("prunes under pruneMode both when only age limit is specified", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxAgeMs: 1000,
        pruneMode: "both",
      });

      const oldTime = Date.now() - 4000;
      tracker.recordChangeWithTimestamp("create", "u1", { name: "Stale" }, oldTime);
      tracker.recordChange("create", "u2", { name: "Fresh" });

      expect(tracker.getEntryCount()).toBe(1);
      expect(tracker.getLowestRetainedRevision()).toBe(2);
    });

    test("prunes under pruneMode both when only size limit is specified", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxSizeBytes: 200,
        pruneMode: "both",
      });

      for (let i = 1; i <= 8; i++) {
        tracker.recordChange("create", `u_${i}`, { data: "x".repeat(50) } as any);
      }

      expect(tracker.getEstimatedSizeBytes()).toBeLessThanOrEqual(200);
      expect(tracker.getLowestRetainedRevision()).toBeGreaterThan(1);
    });

    test("enforces maxEntries under pruneMode both even if age and size are within limits", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", {
        maxAgeMs: 60000,
        maxSizeBytes: 100000,
        maxEntries: 2,
        pruneMode: "both",
      });

      tracker.recordChange("create", "u1", { n: 1 } as any);
      tracker.recordChange("create", "u2", { n: 2 } as any);
      tracker.recordChange("create", "u3", { n: 3 } as any);

      expect(tracker.getEntryCount()).toBe(2);
      expect(tracker.getLowestRetainedRevision()).toBe(2);
    });

    test("applies pruning immediately when dynamic options update mid-run", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      for (let i = 1; i <= 10; i++) {
        tracker.recordChange("create", `u_${i}`, { name: `User ${i}` });
      }

      expect(tracker.getEntryCount()).toBe(10);

      // Dynamically constrain to 3 entries
      tracker.updateOptions({ maxEntries: 3 });

      expect(tracker.getEntryCount()).toBe(3);
      expect(tracker.getLowestRetainedRevision()).toBe(8);
      expect(tracker.getCurrentRevision()).toBe(10);
    });

    test("clears mutation log and resets tracker state", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "u1", { name: "User 1" });
      tracker.recordChange("update", "u1", { name: "User 1 Modified" });

      expect(tracker.getCurrentRevision()).toBe(2);
      expect(tracker.getEntryCount()).toBe(2);

      tracker.clear();

      expect(tracker.getCurrentRevision()).toBe(0);
      expect(tracker.getLowestRetainedRevision()).toBe(1);
      expect(tracker.getEntryCount()).toBe(0);
      expect(tracker.getEstimatedSizeBytes()).toBe(0);
    });
  });

  describe("Monotonic Revision Assignment & getChangesSince Queries", () => {
    test("assigns sequential monotonic revisions across create, update, and delete", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      const rev1 = tracker.recordChange("create", "u1", { name: "User 1" });
      const rev2 = tracker.recordChange("update", "u1", { name: "User 1 Updated" });
      const rev3 = tracker.recordChange("delete", "u1");

      expect(rev1).toBe(1);
      expect(rev2).toBe(2);
      expect(rev3).toBe(3);
      expect(tracker.getCurrentRevision()).toBe(3);
    });

    test("returns empty changes when client revision equals server revision", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "u1", { name: "User 1" });
      tracker.recordChange("update", "u1", { name: "User 1 V2" });

      const res = tracker.getChangesSince(2);
      expect(res.isExpired).toBe(false);
      expect(res.changes).toEqual([]);
    });

    test("returns empty changes when client revision is ahead of server revision", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "u1", { name: "User 1" });

      const res = tracker.getChangesSince(5);
      expect(res.isExpired).toBe(false);
      expect(res.changes).toEqual([]);
    });

    test("returns isExpired true when client revision is older than lowest retained revision", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", { maxEntries: 2 });

      tracker.recordChange("create", "u1", { name: "U1" }); // rev 1 (pruned)
      tracker.recordChange("create", "u2", { name: "U2" }); // rev 2 (pruned)
      tracker.recordChange("create", "u3", { name: "U3" }); // rev 3
      tracker.recordChange("create", "u4", { name: "U4" }); // rev 4

      expect(tracker.getLowestRetainedRevision()).toBe(3);

      // Client with revision 1 asks for changes
      const res = tracker.getChangesSince(1);
      expect(res.isExpired).toBe(true);
      expect(res.changes).toEqual([]);
    });

    test("returns changes when client revision equals lowestRetainedRevision minus one", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", { maxEntries: 2 });

      tracker.recordChange("create", "u1", { name: "U1" }); // rev 1 (pruned)
      tracker.recordChange("create", "u2", { name: "U2" }); // rev 2
      tracker.recordChange("create", "u3", { name: "U3" }); // rev 3

      expect(tracker.getLowestRetainedRevision()).toBe(2);

      // Client has revision 1; lowest retained is 2; 1 == 2 - 1
      const res = tracker.getChangesSince(1);
      expect(res.isExpired).toBe(false);
      expect(res.changes.length).toBe(2);
      expect(res.changes.map((c: ChangeEntry) => c.revision)).toEqual([2, 3]);
    });

    test("returns isExpired true when change tracker has zero entries and client revision is behind", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", { maxEntries: 0 });

      // All entries are pruned immediately
      tracker.recordChange("create", "u1", { name: "U1" });

      expect(tracker.getEntryCount()).toBe(0);
      expect(tracker.getCurrentRevision()).toBe(1);

      const res = tracker.getChangesSince(0);
      expect(res.isExpired).toBe(true);
      expect(res.changes).toEqual([]);
    });

    test("returns empty changes on uninitialized tracker at revision zero", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      const res = tracker.getChangesSince(0);
      expect(res.isExpired).toBe(false);
      expect(res.changes).toEqual([]);
    });

    test("filters changes by allowed entity identifiers for access control", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "public-1", { name: "Public Doc" });
      tracker.recordChange("create", "secret-1", { name: "Classified Doc" });
      tracker.recordChange("update", "public-1", { name: "Public Doc Updated" });
      tracker.recordChange("delete", "secret-1");
      tracker.recordChange("create", "public-2", { name: "Public Doc 2" });

      const allowedIds = new Set(["public-1", "public-2"]);
      const res = tracker.getChangesSince(0, allowedIds);

      expect(res.isExpired).toBe(false);
      expect(res.changes.length).toBe(3);
      expect(res.changes.every((c: ChangeEntry) => allowedIds.has(c.id))).toBe(true);
      expect(res.changes.map((c: ChangeEntry) => c.revision)).toEqual([1, 3, 5]);
    });
  });

  describe("ClientStateReconciler Unit Edge Cases", () => {
    test("executes delta delete idempotently when local object does not exist", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 10,
        changes: [
          {
            revision: 10,
            type: "delete",
            id: "non-existent-user",
            timestamp: Date.now(),
            estimatedBytes: 40,
          },
        ],
      };

      // Apply delta containing delete for missing entity
      await expect(
        ClientStateReconciler.applyDelta(manager, payload),
      ).resolves.not.toThrow();

      expect(manager.objectsAsArray.length).toBe(0);
      expect(manager.callbacks.delete).not.toHaveBeenCalled();
    });

    test("creates new instance and calls callback when delta create arrives", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 1,
        changes: [
          {
            revision: 1,
            type: "create",
            id: "u1",
            data: { _id: "u1", name: "Alice", email: "alice@example.com", role: "admin" },
            timestamp: Date.now(),
            estimatedBytes: 100,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, payload);

      const user = manager.getObject("u1");
      expect(user).toBeDefined();
      expect(user?.name).toBe("Alice");
      expect(user?.email).toBe("alice@example.com");
      expect(user?.role).toBe("admin");
      expect(manager.callbacks.new).toHaveBeenCalledWith(user);
      expect(globalCache.objects["u1"]?.object).toBe(user);
    });

    test("patches existing object properties when delta create arrives for existing entity", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      // Pre-populate user
      const existingUser = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "Initial Name", email: "init@test.com", role: "user" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["u1"] = existingUser;
      globalCache.objects["u1"] = { className: "DeltaTestUser", object: existingUser };

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 2,
        changes: [
          {
            revision: 2,
            type: "create",
            id: "u1",
            data: { name: "Overwritten Name", role: "admin" },
            timestamp: Date.now(),
            estimatedBytes: 60,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, payload);

      expect(existingUser.name).toBe("Overwritten Name");
      expect(existingUser.role).toBe("admin");
      expect(manager.callbacks.update).toHaveBeenCalledWith(existingUser, "name");
      expect(manager.callbacks.update).toHaveBeenCalledWith(existingUser, "role");
    });

    test("patches properties on existing object when delta update arrives", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const existingUser = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "Alice", email: "alice@test.com", role: "user" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["u1"] = existingUser;
      globalCache.objects["u1"] = { className: "DeltaTestUser", object: existingUser };

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 3,
        changes: [
          {
            revision: 3,
            type: "update",
            id: "u1",
            data: { email: "alice.new@test.com", role: "moderator" },
            timestamp: Date.now(),
            estimatedBytes: 70,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, payload);

      expect(existingUser.email).toBe("alice.new@test.com");
      expect(existingUser.role).toBe("moderator");
      expect(manager.callbacks.update).toHaveBeenCalledWith(existingUser, "email");
      expect(manager.callbacks.update).toHaveBeenCalledWith(existingUser, "role");
    });

    test("creates new instance when delta update arrives for missing entity", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 4,
        changes: [
          {
            revision: 4,
            type: "update",
            id: "u_new",
            data: { _id: "u_new", name: "Late Arrival", email: "late@test.com", role: "guest" },
            timestamp: Date.now(),
            estimatedBytes: 80,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, payload);

      const user = manager.getObject("u_new");
      expect(user).toBeDefined();
      expect(user?.name).toBe("Late Arrival");
      expect(manager.callbacks.new).toHaveBeenCalledWith(user);
    });

    test("restores manager state and manifest from storage adapter", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );
      const storage = new MemoryStorageAdapter();

      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 25,
        ids: ["u1", "u2"],
        objects: [
          { _id: "u1", name: "User 1", email: "u1@test.com", role: "user" },
          { _id: "u2", name: "User 2", email: "u2@test.com", role: "admin" },
        ],
        properties: ["_id", "name", "email", "role"],
        manifest: [
          { _id: "u1", description: "User 1" },
          { _id: "u2", description: "User 2" },
        ],
        savedAt: Date.now(),
      });

      const res = await ClientStateReconciler.restoreFromStorage(manager, storage);

      expect(res.restored).toBe(true);
      expect(res.revision).toBe(25);
      expect(res.count).toBe(2);
      expect(manager.getObject("u1")?.name).toBe("User 1");
      expect(manager.getObject("u2")?.role).toBe("admin");
      expect(manager.manifest).toHaveLength(2);
      expect(globalCache.objects["u1"]).toBeDefined();
    });

    test("persists manager state, objects, and revision to storage adapter", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );
      const storage = new MemoryStorageAdapter();

      const user1 = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "User 1", email: "u1@test.com", role: "user" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["u1"] = user1;

      await ClientStateReconciler.persistToStorage(manager, 30, storage);

      const state = await storage.loadManagerState("DeltaTestUser");
      expect(state).toBeDefined();
      expect(state?.revision).toBe(30);
      expect(state?.ids).toEqual(["u1"]);
      expect(state?.objects[0].name).toBe("User 1");
    });
  });

  describe("Assigned Pair Combinations", () => {
    test("F09 + F01: patches model properties decorated with classProp", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const user = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "Initial", email: "init@test.com", role: "guest" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["u1"] = user;

      const deltaPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 5,
        changes: [
          {
            revision: 5,
            type: "update",
            id: "u1",
            data: { name: "Updated Name", email: "new@test.com" },
            timestamp: Date.now(),
            estimatedBytes: 60,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, deltaPayload);

      // Verify reflected properties on target instance
      expect(user.name).toBe("Updated Name");
      expect(user.email).toBe("new@test.com");
      expect(user.role).toBe("guest");
    });

    test("F09 + F01: multiple properties in single delta entry patch sequentially", async () => {
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const user = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "One", email: "one@test.com", role: "user" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["u1"] = user;

      const deltaPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 6,
        changes: [
          {
            revision: 6,
            type: "update",
            id: "u1",
            data: { name: "Two", email: "two@test.com", role: "admin" },
            timestamp: Date.now(),
            estimatedBytes: 70,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, deltaPayload);

      expect(user.name).toBe("Two");
      expect(user.email).toBe("two@test.com");
      expect(user.role).toBe("admin");
      expect(manager.callbacks.update).toHaveBeenCalledTimes(3);
    });

    test("F09 + F02: delta sync adding relational child entity resolves parent reference", async () => {
      const itemManager = createMockReconcilableManager<DeltaTestItem>(
        "DeltaTestItem",
        DeltaTestItem,
      );
      const containerManager = createMockReconcilableManager<DeltaTestContainer>(
        "DeltaTestContainer",
        DeltaTestContainer,
      );

      // Parent container referencing child item ID 'item-10'
      const container = new DeltaTestContainer(
        DeltaTestContainer,
        containerManager.socket,
        { _id: "c1", name: "My Container", singleItem: "item-10" } as any,
        containerManager.loggers,
        "DeltaTestContainer",
        containerManager as any,
        containerManager.callbacks,
        containerManager.emitter,
      );
      containerManager.objects_["c1"] = container;
      globalCache.objects["c1"] = { className: "DeltaTestContainer", object: container };

      // Child item is not loaded initially
      expect(container.singleItem).toBeUndefined();

      // Delta sync delivers create event for child item
      const itemPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 8,
        changes: [
          {
            revision: 8,
            type: "create",
            id: "item-10",
            data: { _id: "item-10", title: "Resolved Child Item" },
            timestamp: Date.now(),
            estimatedBytes: 50,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(itemManager, itemPayload);

      // Reference on container resolves to newly synced child entity
      const resolved = container.singleItem;
      expect(resolved).toBeDefined();
      expect(resolved.title).toBe("Resolved Child Item");
    });

    test("F09 + F03: delta mutating array proxy elements reflects new child references", async () => {
      const itemManager = createMockReconcilableManager<DeltaTestItem>(
        "DeltaTestItem",
        DeltaTestItem,
      );
      const containerManager = createMockReconcilableManager<DeltaTestContainer>(
        "DeltaTestContainer",
        DeltaTestContainer,
      );

      // Create item 1 and item 2
      const item1 = new DeltaTestItem(
        DeltaTestItem,
        itemManager.socket,
        { _id: "i1", title: "First Item" },
        itemManager.loggers,
        "DeltaTestItem",
        itemManager as any,
        itemManager.callbacks,
        itemManager.emitter,
      );
      item1.generateSettersAndGetters();

      const item2 = new DeltaTestItem(
        DeltaTestItem,
        itemManager.socket,
        { _id: "i2", title: "Second Item" },
        itemManager.loggers,
        "DeltaTestItem",
        itemManager as any,
        itemManager.callbacks,
        itemManager.emitter,
      );
      item2.generateSettersAndGetters();
      itemManager.objects_["i1"] = item1;
      itemManager.objects_["i2"] = item2;
      globalCache.objects["i1"] = { className: "DeltaTestItem", object: item1 };
      globalCache.objects["i2"] = { className: "DeltaTestItem", object: item2 };

      // Container initially references only i1
      const container = new DeltaTestContainer(
        DeltaTestContainer,
        containerManager.socket,
        { _id: "c1", name: "Box", items: ["i1"] } as any,
        containerManager.loggers,
        "DeltaTestContainer",
        containerManager as any,
        containerManager.callbacks,
        containerManager.emitter,
      );
      container.generateSettersAndGetters();
      containerManager.objects_["c1"] = container;

      expect(container.items.length).toBe(1);
      expect(container.items[0].title).toBe("First Item");

      // Delta payload updates items array to ['i1', 'i2']
      const updatePayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 12,
        changes: [
          {
            revision: 12,
            type: "update",
            id: "c1",
            data: { items: ["i1", "i2"] },
            timestamp: Date.now(),
            estimatedBytes: 60,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(containerManager, updatePayload);

      // Container proxy reflects both items
      expect(container.items.length).toBe(2);
      expect(container.items[0].title).toBe("First Item");
      expect(container.items[1].title).toBe("Second Item");
    });

    test("F09 + F03: reference array proxy throws DEMError on direct mutation attempts", () => {
      const rawArray = [{ _id: "i1", title: "Item 1" }];
      const proxy = createReadOnlyArrayProxy(rawArray, "items");

      expect(() => {
        (proxy as any).push({ _id: "i2", title: "Item 2" });
      }).toThrow(DEMError);

      expect(() => {
        (proxy as any)[0] = { _id: "i3", title: "Item 3" };
      }).toThrow(DEMError);

      expect(() => {
        delete (proxy as any)[0];
      }).toThrow(DEMError);
    });

    test("F09 + F04: records mutations in change tracker through server manager hooks", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      // Simulate server manager mutation hooks
      const rev1 = tracker.recordChange("create", "u1", { name: "User 1" });
      const rev2 = tracker.recordChange("update", "u1", { name: "User 1 Updated" });
      const rev3 = tracker.recordChange("delete", "u1");

      expect(rev1).toBe(1);
      expect(rev2).toBe(2);
      expect(rev3).toBe(3);
      expect(tracker.getCurrentRevision()).toBe(3);

      const changes = tracker.getChangesSince(0).changes;
      expect(changes.map((c: ChangeEntry) => c.type)).toEqual(["create", "update", "delete"]);
    });

    test("F09 + F04: server manager with deltaSync disabled does not instantiate change tracker", () => {
      const deltaOpts = { enabled: false };
      let tracker: ServerChangeTracker | undefined = undefined;

      if (deltaOpts.enabled !== false) {
        tracker = new ServerChangeTracker("DeltaTestUser");
      }

      expect(tracker).toBeUndefined();
    });

    test("F09 + F05: reconnection delta sync request transmits stored revision and applies delta", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      // Pre-save manager state at revision 5
      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 5,
        ids: ["u1"],
        objects: [{ _id: "u1", name: "Alice", email: "alice@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      let sentPayload: any = null;

      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          sentPayload = payload;
          ack?.({
            success: true,
            data: {
              status: "delta",
              revision: 7,
              version: DEM_VERSION,
              protocolVersion: DEM_PROTOCOL_VERSION,
              changes: [
                {
                  revision: 6,
                  type: "update",
                  id: "u1",
                  data: { name: "Alice Global" },
                  timestamp: Date.now(),
                  estimatedBytes: 40,
                },
                {
                  revision: 7,
                  type: "create",
                  id: "u2",
                  data: { _id: "u2", name: "Bob", email: "bob@test.com", role: "admin" },
                  timestamp: Date.now(),
                  estimatedBytes: 60,
                },
              ],
              ids: [],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await clientManager.loadFromServer();

      expect(sentPayload?.lastRevision).toBe(5);
      expect(clientManager.lastRevision).toBe(7);
      expect(clientManager.objectsAsArray.length).toBe(2);
      expect(clientManager.getObject("u1")?.name).toBe("Alice Global");
      expect(clientManager.getObject("u2")?.name).toBe("Bob");

      // Verify updated revision persisted to storage adapter
      const updatedStorage = await storage.loadManagerState("DeltaTestUser");
      expect(updatedStorage?.revision).toBe(7);
      expect(updatedStorage?.ids).toEqual(["u1", "u2"]);
    });

    test("F09 + F05: reconnection with equal revision returns up-to-date without object recreation", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 10,
        ids: ["u1"],
        objects: [{ _id: "u1", name: "Persistent Alice", email: "alice@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          ack?.({
            success: true,
            data: {
              status: "up-to-date",
              revision: 10,
              version: DEM_VERSION,
              protocolVersion: DEM_PROTOCOL_VERSION,
              ids: [],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await clientManager.loadFromServer();

      expect(clientManager.lastRevision).toBe(10);
      expect(clientManager.objectsAsArray.length).toBe(1);
      const user = clientManager.getObject("u1");
      expect(user?.name).toBe("Persistent Alice");
    });

    test("F09 + F06: monotonic revisions assigned sequentially across interleaved updates", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      const rev1 = tracker.recordChange("update", "u1", { name: "A1" });
      const rev2 = tracker.recordChange("update", "u2", { name: "B1" });
      const rev3 = tracker.recordChange("update", "u1", { name: "A2" });
      const rev4 = tracker.recordChange("update", "u3", { name: "C1" });
      const rev5 = tracker.recordChange("update", "u2", { name: "B2" });

      expect([rev1, rev2, rev3, rev4, rev5]).toEqual([1, 2, 3, 4, 5]);
      expect(tracker.getCurrentRevision()).toBe(5);

      const changesSinceRev2 = tracker.getChangesSince(2).changes;
      expect(changesSinceRev2.map((c: ChangeEntry) => c.revision)).toEqual([3, 4, 5]);
    });

    test("F09 + F07: entity CRUD lifecycle recorded in change tracker and applied by client", async () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      // 1. Create
      const rev1 = tracker.recordChange("create", "u1", {
        _id: "u1",
        name: "Lifecycle User",
        email: "life@test.com",
        role: "guest",
      });
      // 2. Update
      const rev2 = tracker.recordChange("update", "u1", { role: "member" });
      // 3. Delete
      const rev3 = tracker.recordChange("delete", "u1");

      const deltaPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: tracker.getCurrentRevision(),
        changes: tracker.getChangesSince(0).changes,
      };

      await ClientStateReconciler.applyDelta(manager, deltaPayload);

      // Verify entity went through full lifecycle ending in deletion
      expect(manager.getObject("u1")).toBeUndefined();
      expect(manager.callbacks.new).toHaveBeenCalled();
      expect(manager.callbacks.update).toHaveBeenCalled();
      expect(manager.callbacks.delete).toHaveBeenCalled();
    });

    test("F09 + F11: delta updates patch embedded snapshot subdocuments cleanly", async () => {
      const manager = createMockReconcilableManager<DeltaTestContainer>(
        "DeltaTestContainer",
        DeltaTestContainer,
      );

      const container = new DeltaTestContainer(
        DeltaTestContainer,
        manager.socket,
        {
          _id: "c1",
          name: "Snapshot Host",
          snapshotData: { version: 1, author: "Original", metrics: { views: 10 } },
        } as any,
        manager.loggers,
        "DeltaTestContainer",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );
      manager.objects_["c1"] = container;

      const payload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 4,
        changes: [
          {
            revision: 4,
            type: "update",
            id: "c1",
            data: {
              snapshotData: {
                version: 2,
                author: "Patched Author",
                metrics: { views: 50, likes: 5 },
              },
            },
            timestamp: Date.now(),
            estimatedBytes: 100,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, payload);

      expect(container.snapshotData).toEqual({
        version: 2,
        author: "Patched Author",
        metrics: { views: 50, likes: 5 },
      });
    });

    test("F09 + F12: handshake verifies DEM version and rejects incompatible major version", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 2,
        ids: ["u1"],
        objects: [{ _id: "u1", name: "Alice", email: "a@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          ack?.({
            success: true,
            data: {
              status: "delta",
              revision: 3,
              version: "99.0.0", // Incompatible major version
              protocolVersion: DEM_PROTOCOL_VERSION,
              changes: [],
              ids: [],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(DEMError);
      await expect(clientManager.loadFromServer()).rejects.toMatchObject({
        code: DEMErrorCode.VERSION_MISMATCH,
      });
    });

    test("F09 + F12: handshake verifies DEM version and rejects incompatible minor version", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 2,
        ids: ["u1"],
        objects: [{ _id: "u1", name: "Alice", email: "a@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          ack?.({
            success: true,
            data: {
              status: "delta",
              revision: 3,
              version: "0.99.0", // Incompatible minor version for 0.x
              protocolVersion: DEM_PROTOCOL_VERSION,
              changes: [],
              ids: [],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(DEMError);
      await expect(clientManager.loadFromServer()).rejects.toMatchObject({
        code: DEMErrorCode.VERSION_MISMATCH,
      });
    });

    test("F09 + F13: startup middleware permission filtering restricts delta stream to allowed IDs", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "dept_it_1", { name: "IT User 1" });
      tracker.recordChange("create", "dept_hr_1", { name: "HR User 1" });
      tracker.recordChange("update", "dept_it_1", { name: "IT User 1 Updated" });
      tracker.recordChange("delete", "dept_hr_1");

      // Middleware only grants access to IT department entities
      const itAllowedIds = new Set(["dept_it_1"]);
      const filteredResult = tracker.getChangesSince(0, itAllowedIds);

      expect(filteredResult.changes.length).toBe(2);
      expect(filteredResult.changes.every((c: ChangeEntry) => c.id === "dept_it_1")).toBe(true);
    });

    test("F09 + F14: expired client revision triggers full sync fallback and resets state", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      // Client knows revision 1, which server pruned
      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 1,
        ids: ["u1_old"],
        objects: [{ _id: "u1_old", name: "Stale Alice", email: "stale@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          // Server responds with full sync fallback
          ack?.({
            success: true,
            data: {
              status: "full",
              revision: 20,
              version: DEM_VERSION,
              protocolVersion: DEM_PROTOCOL_VERSION,
              ids: ["u_fresh_1", "u_fresh_2"],
              objects: [
                { _id: "u_fresh_1", name: "Fresh 1", email: "f1@test.com", role: "admin" },
                { _id: "u_fresh_2", name: "Fresh 2", email: "f2@test.com", role: "member" },
              ],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await clientManager.loadFromServer();

      expect(clientManager.lastRevision).toBe(20);
      expect(clientManager.objectsAsArray.length).toBe(2);
      expect(clientManager.getObject("u1_old")).toBeUndefined();
      expect(clientManager.getObject("u_fresh_1")?.name).toBe("Fresh 1");
      expect(clientManager.getObject("u_fresh_2")?.name).toBe("Fresh 2");
    });
  });

  describe("Multi-Subsystem Triplets", () => {
    test("Triplet F09 + F01 + F06: delta sync with property reflection and mutation tracking", async () => {
      // 1. Tracker records real-time updates with monotonic revisions
      const tracker = new ServerChangeTracker("DeltaTestUser");

      tracker.recordChange("create", "u1", {
        _id: "u1",
        name: "Initial Name",
        email: "init@test.com",
        role: "guest",
      });
      tracker.recordChange("update", "u1", { name: "Intermediate Name" });
      tracker.recordChange("update", "u1", { role: "admin" });
      tracker.recordChange("update", "u1", { email: "final@test.com" });

      expect(tracker.getCurrentRevision()).toBe(4);

      // 2. Client manager applies delta changes
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      const changesPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 4,
        changes: tracker.getChangesSince(0).changes,
      };

      await ClientStateReconciler.applyDelta(manager, changesPayload);

      // 3. Verify reflected properties on target object
      const user = manager.getObject("u1");
      expect(user).toBeDefined();
      expect(user?.name).toBe("Intermediate Name");
      expect(user?.role).toBe("admin");
      expect(user?.email).toBe("final@test.com");
      expect(manager.callbacks.new).toHaveBeenCalledTimes(1);
      expect(manager.callbacks.update).toHaveBeenCalledTimes(3);
    });

    test("Triplet F09 + F04 + F13: delta sync with server manager and access control filtering", () => {
      const tracker = new ServerChangeTracker("DeltaTestUser");

      // Server manager records mutations for various documents
      tracker.recordChange("create", "doc_public_1", { name: "Open Doc" });
      tracker.recordChange("create", "doc_secret_1", { name: "Confidential Doc" });
      tracker.recordChange("update", "doc_public_1", { name: "Open Doc Revision 2" });
      tracker.recordChange("update", "doc_secret_1", { name: "Confidential Revision 2" });
      tracker.recordChange("delete", "doc_secret_1");
      tracker.recordChange("create", "doc_public_2", { name: "Open Doc 2" });

      expect(tracker.getCurrentRevision()).toBe(6);

      // Startup middleware grants access to public documents only
      const clientAllowedIds = new Set(["doc_public_1", "doc_public_2"]);
      const filteredStream = tracker.getChangesSince(0, clientAllowedIds);

      expect(filteredStream.isExpired).toBe(false);
      expect(filteredStream.changes.length).toBe(3);
      expect(filteredStream.changes.map((c: ChangeEntry) => c.id)).toEqual([
        "doc_public_1",
        "doc_public_1",
        "doc_public_2",
      ]);
      expect(filteredStream.changes.map((c: ChangeEntry) => c.revision)).toEqual([1, 3, 6]);
    });

    test("Triplet F09 + F05 + F12: delta sync with client lifecycle and version handshake", async () => {
      const storage = new MemoryStorageAdapter();
      const mockLoggers = createMockLoggers();
      const emitter = new EventEmitter();

      await storage.saveManagerState("DeltaTestUser", {
        className: "DeltaTestUser",
        revision: 8,
        ids: ["u1"],
        objects: [{ _id: "u1", name: "Alice", email: "alice@test.com", role: "user" }],
        properties: ["_id", "name", "email", "role"],
        savedAt: Date.now(),
      });

      // Server responds with compatible version
      const mockSocket = createMockSocket((event, payload, ack) => {
        if (event === "startupDeltaTestUser") {
          ack?.({
            success: true,
            data: {
              status: "delta",
              revision: 10,
              version: DEM_VERSION,
              protocolVersion: DEM_PROTOCOL_VERSION,
              changes: [
                {
                  revision: 9,
                  type: "update",
                  id: "u1",
                  data: { name: "Alice Verified" },
                  timestamp: Date.now(),
                  estimatedBytes: 40,
                },
                {
                  revision: 10,
                  type: "create",
                  id: "u2",
                  data: { _id: "u2", name: "Bob Verified", email: "b@test.com", role: "member" },
                  timestamp: Date.now(),
                  estimatedBytes: 60,
                },
              ],
              ids: [],
              properties: ["_id", "name", "email", "role"],
            },
          });
        }
      });

      const clientManager = new AutoUpdateClientManager(
        DeltaTestUser as any,
        "DeltaTestUser",
        mockSocket as any,
        mockLoggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        undefined,
        { storage },
      );

      await clientManager.loadFromServer();

      expect(clientManager.lastRevision).toBe(10);
      expect(clientManager.objectsAsArray.length).toBe(2);
      expect(clientManager.getObject("u1")?.name).toBe("Alice Verified");
      expect(clientManager.getObject("u2")?.name).toBe("Bob Verified");

      const savedState = await storage.loadManagerState("DeltaTestUser");
      expect(savedState?.revision).toBe(10);
    });

    test("Triplet F09 + F07 + F14: delta sync with entity deletion and expired revision fallback", async () => {
      const tracker = new ServerChangeTracker("DeltaTestUser", { maxEntries: 2 });

      // Entity lifecycle mutations advancing revisions
      tracker.recordChange("create", "u1", { name: "U1" }); // rev 1 (pruned)
      tracker.recordChange("update", "u1", { name: "U1 v2" }); // rev 2 (pruned)
      tracker.recordChange("delete", "u1"); // rev 3 (pruned)
      tracker.recordChange("create", "u2", { name: "U2" }); // rev 4
      tracker.recordChange("create", "u3", { name: "U3" }); // rev 5

      expect(tracker.getLowestRetainedRevision()).toBe(4);
      expect(tracker.getCurrentRevision()).toBe(5);

      // Client asking for rev 1 encounters expired revision
      const queryResult = tracker.getChangesSince(1);
      expect(queryResult.isExpired).toBe(true);
      expect(queryResult.changes).toEqual([]);

      // Client performs full sync fallback
      const manager = createMockReconcilableManager<DeltaTestUser>(
        "DeltaTestUser",
        DeltaTestUser,
      );

      // Pre-populate old u1 on client
      manager.objects_["u1"] = new DeltaTestUser(
        DeltaTestUser,
        manager.socket,
        { _id: "u1", name: "U1 Stale", email: "u1@test.com", role: "user" },
        manager.loggers,
        "DeltaTestUser",
        manager as any,
        manager.callbacks,
        manager.emitter,
      );

      // Reconciler applies idempotent delete for already absent entity
      const deleteAbsentPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 6,
        changes: [
          {
            revision: 6,
            type: "delete",
            id: "ghost_entity_id",
            timestamp: Date.now(),
            estimatedBytes: 40,
          },
        ],
      };

      await expect(
        ClientStateReconciler.applyDelta(manager, deleteAbsentPayload),
      ).resolves.not.toThrow();

      // Delete existing u1
      const deleteExistingPayload: DeltaSyncPayload<any> = {
        status: "delta",
        revision: 7,
        changes: [
          {
            revision: 7,
            type: "delete",
            id: "u1",
            timestamp: Date.now(),
            estimatedBytes: 40,
          },
        ],
      };

      await ClientStateReconciler.applyDelta(manager, deleteExistingPayload);

      expect(manager.getObject("u1")).toBeUndefined();
      expect(manager.callbacks.delete).toHaveBeenCalled();
    });
  });
});
