import { jest } from "@jest/globals";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { classProp, populatedRef } from "../CommonTypes.js";
import { EventEmitter } from "eventemitter3";
import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";
import { ClientStateReconciler } from "../sync/ClientStateReconciler.js";

import { LocalStorageAdapter } from "../sync/storage/LocalStorageAdapter.js";

// Self-contained snapshot model
class SnapshotTaskClient extends AutoUpdatedClientObject<SnapshotTaskClient> {
  @classProp
  public title!: string;

  @classProp
  public authorId!: string;

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  public static override getDescriptor(data: Partial<SnapshotTaskClient>): string {
    return `Task: ${data.title ?? "Untitled"}`;
  }
}

describe("Lazy Loading with Locally Saved Snapshots", () => {
  let emitter: EventEmitter;
  let mockSocket: any;
  let storageAdapter: MemoryStorageAdapter;
  let clientManagers: Record<string, any>;
  let taskManager: AutoUpdateClientManager<SnapshotTaskClient>;

  beforeEach(() => {
    emitter = new EventEmitter();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    storageAdapter = new MemoryStorageAdapter();
    clientManagers = {};

    taskManager = new AutoUpdateClientManager(
      SnapshotTaskClient as any,
      "SnapshotTaskClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      clientManagers,
      emitter as any,
      {
        new: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
      },
      undefined,
      { storage: storageAdapter },
      { lazyLoading: true },
    );
    clientManagers["SnapshotTaskClient"] = taskManager;
  });

  it("should persist lazy startup manifest and stubs to storage adapter on lazy loadFromServer", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 10,
            ids: ["task-1", "task-2"],
            manifest: [
              { _id: "task-1", description: "Task: First Task" },
              { _id: "task-2", description: "Task: Second Task" },
            ],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await taskManager.loadFromServer();

    expect(taskManager.isLoaded).toBe(true);
    expect(taskManager.manifest).toHaveLength(2);

    // Verify storage adapter received the snapshot including manifest and stub indicators
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    expect(stored).not.toBeNull();
    expect(stored?.revision).toBe(10);
    expect(stored?.ids).toEqual(["task-1", "task-2"]);
    expect(stored?.manifest).toEqual([
      { _id: "task-1", description: "Task: First Task" },
      { _id: "task-2", description: "Task: Second Task" },
    ]);

    // Objects in storage should preserve __isLazyStub and descriptor
    const storedObj1: any = stored?.objects.find((o: any) => o._id === "task-1");
    expect(storedObj1).toBeDefined();
    expect(storedObj1.__isLazyStub).toBe(true);
    expect(storedObj1.descriptor).toBe("Task: First Task");
  });

  it("should restore lazy stubs and manifest properly from locally saved snapshot without marking stubs as loaded", async () => {
    // Save snapshot with one stub and one hydrated object
    await storageAdapter.saveManagerState("SnapshotTaskClient", {
      className: "SnapshotTaskClient",
      revision: 15,
      ids: ["task-1", "task-2"],
      manifest: [
        { _id: "task-1", description: "Task: Hydrated Task" },
        { _id: "task-2", description: "Task: Lazy Stub Task" },
      ],
      objects: [
        {
          _id: "task-1",
          title: "Hydrated Task",
          authorId: "user-1",
          metadataSnapshot: { version: 1, tags: ["urgent"] },
        },
        {
          _id: "task-2",
          __isLazyStub: true,
          descriptor: "Task: Lazy Stub Task",
        },
      ],
      properties: ["title", "authorId", "metadataSnapshot", "_id"],
      savedAt: Date.now(),
    });

    // Create a new client manager instance restoring from storage
    const restoredManager = new AutoUpdateClientManager(
      SnapshotTaskClient as any,
      "SnapshotTaskClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      {},
      emitter as any,
      {
        new: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
      },
      undefined,
      { storage: storageAdapter },
      { lazyLoading: true },
    );

    const restoreResult = await ClientStateReconciler.restoreFromStorage(
      restoredManager as any,
      storageAdapter,
    );

    expect(restoreResult.restored).toBe(true);
    expect(restoreResult.count).toBe(2);
    expect(restoredManager.manifest).toHaveLength(2);
    expect(restoredManager.manifest?.[0].description).toBe("Task: Hydrated Task");
    expect(restoredManager.manifest?.[1].description).toBe("Task: Lazy Stub Task");

    // Task 1: was hydrated, should be fully loaded with properties immediately accessible
    const obj1 = restoredManager.getObject("task-1");
    expect(obj1).toBeDefined();
    expect(obj1?.isLazyStub).toBeFalsy();
    expect(obj1?.isLoaded).toBe(true);
    expect(obj1?.title).toBe("Hydrated Task");
    expect(obj1?.metadataSnapshot).toEqual({ version: 1, tags: ["urgent"] });

    // Task 2: was stub, should be a lazy stub and NOT loaded
    const obj2 = restoredManager.getObject("task-2");
    expect(obj2).toBeDefined();
    expect(obj2?.isLazyStub).toBe(true);
    expect(obj2?.isLoaded).toBe(false);
    expect(obj2?.descriptor).toBe("Task: Lazy Stub Task");
  });

  it("should preserve locally hydrated objects when server sends status 'lazy' on startup", async () => {
    // Initial state in storage has task-1 as hydrated, task-2 as stub
    await storageAdapter.saveManagerState("SnapshotTaskClient", {
      className: "SnapshotTaskClient",
      revision: 20,
      ids: ["task-1", "task-2"],
      manifest: [
        { _id: "task-1", description: "Task: Preserved Hydrated" },
        { _id: "task-2", description: "Task: Existing Stub" },
      ],
      objects: [
        {
          _id: "task-1",
          title: "Preserved Hydrated",
          authorId: "user-99",
          metadataSnapshot: { audit: "passed" },
        },
        {
          _id: "task-2",
          __isLazyStub: true,
          descriptor: "Task: Existing Stub",
        },
      ],
      properties: ["title", "authorId", "metadataSnapshot", "_id"],
      savedAt: Date.now(),
    });

    // Server responds with lazy status containing task-1, task-2, and new task-3
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 21,
            ids: ["task-1", "task-2", "task-3"],
            manifest: [
              { _id: "task-1", description: "Task: Preserved Hydrated" },
              { _id: "task-2", description: "Task: Existing Stub" },
              { _id: "task-3", description: "Task: Brand New" },
            ],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await taskManager.loadFromServer();

    expect(taskManager.manifest).toHaveLength(3);

    // task-1 MUST still have its hydrated data, not wiped into an empty stub!
    const task1 = taskManager.getObject("task-1");
    expect(task1).toBeDefined();
    expect(task1?.isLazyStub).toBeFalsy();
    expect(task1?.isLoaded).toBe(true);
    expect(task1?.title).toBe("Preserved Hydrated");
    expect(task1?.metadataSnapshot).toEqual({ audit: "passed" });

    // task-2 remains a stub
    const task2 = taskManager.getObject("task-2");
    expect(task2?.isLazyStub).toBe(true);

    // task-3 is a new stub
    const task3 = taskManager.getObject("task-3");
    expect(task3?.isLazyStub).toBe(true);
    expect(task3?.descriptor).toBe("Task: Brand New");

    // Storage should be updated with all 3 and task-1 still hydrated
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    expect(stored?.ids).toEqual(["task-1", "task-2", "task-3"]);
    const stored1: any = stored?.objects.find((o: any) => o._id === "task-1");
    expect(stored1.title).toBe("Preserved Hydrated");
    expect(stored1.__isLazyStub).toBeFalsy();
  });

  it("should remove deleted entities from manifest and storage on deleteObject", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 5,
            ids: ["task-1", "task-2"],
            manifest: [
              { _id: "task-1", description: "Task: One" },
              { _id: "task-2", description: "Task: Two" },
            ],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      } else if (event === "deleteSnapshotTaskClient") {
        ack?.({ success: true });
      }
    });

    await taskManager.loadFromServer();
    expect(taskManager.manifest).toHaveLength(2);

    // Delete task-1
    await taskManager.deleteObject("task-1");

    expect(taskManager.getObject("task-1")).toBeUndefined();
    expect(taskManager.manifest).toHaveLength(1);
    expect(taskManager.manifest?.[0]._id).toBe("task-2");

    // Check storage
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    expect(stored?.ids).toEqual(["task-2"]);
    expect(stored?.manifest).toEqual([{ _id: "task-2", description: "Task: Two" }]);
  });

  it("should persist when loadObject hydates a lazy stub on demand", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 5,
            ids: ["task-1"],
            manifest: [{ _id: "task-1", description: "Task: Needs Hydration" }],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      } else if (event === "getSnapshotTaskClienttask-1") {
        ack({
          success: true,
          data: {
            _id: "task-1",
            title: "Now Hydrated",
            authorId: "user-42",
            metadataSnapshot: { done: true },
          },
        });
      }
    });

    await taskManager.loadFromServer();
    const stub = taskManager.getObject("task-1")!;
    expect(stub.isLazyStub).toBe(true);

    // Hydrate stub
    await taskManager.loadObject("task-1");
    expect(stub.isLazyStub).toBe(false);
    expect(stub.title).toBe("Now Hydrated");

    // Storage MUST now store the hydrated object, not a stub!
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    const storedObj: any = stored?.objects.find((o: any) => o._id === "task-1");
    expect(storedObj).toBeDefined();
    expect(storedObj.title).toBe("Now Hydrated");
    expect(storedObj.metadataSnapshot).toEqual({ done: true });
    expect(storedObj.__isLazyStub).toBeFalsy();
  });

  it("should persist when real-time new event arrives in lazy mode", async () => {
    let newHandler: ((payload: any) => Promise<void>) | undefined;
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === "newSnapshotTaskClient") {
        newHandler = handler;
      }
    });

    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 1,
            ids: [],
            manifest: [],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await taskManager.loadFromServer();
    expect(newHandler).toBeDefined();

    await newHandler!({
      _id: "task-new-1",
      description: "Task: Brand New Broadcast",
    });

    const stub = taskManager.getObject("task-new-1");
    expect(stub).toBeDefined();
    expect(stub?.isLazyStub).toBe(true);
    expect(taskManager.manifest).toHaveLength(1);

    // Verify storage received this new object
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    expect(stored?.ids).toContain("task-new-1");
    expect(stored?.manifest).toEqual([
      { _id: "task-new-1", description: "Task: Brand New Broadcast" },
    ]);
  });

  it("should update manifest and storage when delta sync creates and deletes objects in lazy mode", async () => {
    // Start with 2 tasks in storage
    await storageAdapter.saveManagerState("SnapshotTaskClient", {
      className: "SnapshotTaskClient",
      revision: 10,
      ids: ["task-1", "task-2"],
      manifest: [
        { _id: "task-1", description: "Task: Task 1" },
        { _id: "task-2", description: "Task: Task 2" },
      ],
      objects: [
        { _id: "task-1", __isLazyStub: true, descriptor: "Task: Task 1" },
        { _id: "task-2", __isLazyStub: true, descriptor: "Task: Task 2" },
      ],
      properties: ["title", "authorId", "metadataSnapshot", "_id"],
      savedAt: Date.now(),
    });

    // Server sends delta: delete task-1, create task-3
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "delta",
            revision: 12,
            changes: [
              { revision: 11, type: "delete", id: "task-1", timestamp: Date.now(), estimatedBytes: 50 },
              {
                revision: 12,
                type: "create",
                id: "task-3",
                data: { _id: "task-3", title: "Delta Created Task", authorId: "u3", metadataSnapshot: { d: 1 } },
                timestamp: Date.now(),
                estimatedBytes: 150,
              },
            ],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await taskManager.loadFromServer();

    expect(taskManager.getObject("task-1")).toBeUndefined();
    expect(taskManager.getObject("task-2")).toBeDefined();
    expect(taskManager.getObject("task-3")).toBeDefined();

    // Manifest must have task-1 removed and task-3 added
    expect(taskManager.manifest).toHaveLength(2);
    expect(taskManager.manifest?.some((m) => m._id === "task-1")).toBe(false);
    expect(taskManager.manifest?.some((m) => m._id === "task-2")).toBe(true);
    expect(taskManager.manifest?.some((m) => m._id === "task-3")).toBe(true);

    // Stored manager state must reflect the delta changes and updated manifest
    const stored = await storageAdapter.loadManagerState("SnapshotTaskClient");
    expect(stored?.revision).toBe(12);
    expect(stored?.ids).toEqual(["task-2", "task-3"]);
    expect(stored?.manifest?.some((m) => m._id === "task-1")).toBe(false);
    expect(stored?.manifest?.some((m) => m._id === "task-3")).toBe(true);
  });

  it("should hydrate cross-manager related entities, persist both managers, and restore offline with synchronous navigation", async () => {
    class LazyCustomerClient extends AutoUpdatedClientObject<LazyCustomerClient> {
      @classProp
      public name!: string;

      public static override getDescriptor(data: Partial<LazyCustomerClient>): string {
        return `Customer: ${data.name ?? "Unknown"}`;
      }
    }

    class LazyOrderClient extends AutoUpdatedClientObject<LazyOrderClient> {
      @classProp
      public orderNumber!: string;

      @populatedRef("LazyCustomerClient")
      public customer!: LazyCustomerClient;

      @classProp
      public detailsSnapshot!: Record<string, unknown>;

      public static override getDescriptor(data: Partial<LazyOrderClient>): string {
        return `Order: ${data.orderNumber ?? "NoNum"}`;
      }
    }

    const multiManagers: Record<string, any> = {};
    const orderStorage = new MemoryStorageAdapter();
    const customerStorage = new MemoryStorageAdapter();

    const orderManager = new AutoUpdateClientManager(
      LazyOrderClient as any,
      "LazyOrderClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      multiManagers,
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: orderStorage },
      { lazyLoading: true },
    );

    const customerManager = new AutoUpdateClientManager(
      LazyCustomerClient as any,
      "LazyCustomerClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      multiManagers,
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: customerStorage },
      { lazyLoading: true },
    );

    multiManagers["LazyOrderClient"] = orderManager;
    multiManagers["LazyCustomerClient"] = customerManager;

    // Startup both managers in lazy mode
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupLazyOrderClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 1,
            ids: ["order-1"],
            manifest: [{ _id: "order-1", description: "Order: ORD-100" }],
            properties: ["orderNumber", "customer", "detailsSnapshot", "_id"],
          },
        });
      } else if (event === "startupLazyCustomerClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 1,
            ids: ["cust-1"],
            manifest: [{ _id: "cust-1", description: "Customer: ACME Corp" }],
            properties: ["name", "_id"],
          },
        });
      } else if (event === "getLazyOrderClientorder-1") {
        ack({
          success: true,
          data: {
            _id: "order-1",
            orderNumber: "ORD-100",
            customer: "cust-1",
            detailsSnapshot: { itemsCount: 5, totalAmount: 99.95 },
          },
          related: {
            LazyCustomerClient: [
              {
                _id: "cust-1",
                name: "ACME Corp",
              },
            ],
          },
        });
      }
    });

    await orderManager.loadFromServer();
    await customerManager.loadFromServer();

    // Both are stubs initially
    const orderStub = orderManager.getObject("order-1");
    const customerStub = customerManager.getObject("cust-1");
    expect(orderStub?.isLazyStub).toBe(true);
    expect(customerStub?.isLazyStub).toBe(true);

    // On-demand load order-1 with related entities
    await orderManager.loadObject("order-1", { depth: 2 });
    expect(orderStub?.isLazyStub).toBe(false);
    expect(customerStub?.isLazyStub).toBe(false);

    // Both orderStorage and customerStorage must now have persisted the hydrated data!
    const storedOrder = await orderStorage.loadManagerState("LazyOrderClient");
    const storedCustomer = await customerStorage.loadManagerState("LazyCustomerClient");

    expect(storedOrder?.objects[0].orderNumber).toBe("ORD-100");
    expect(storedOrder?.objects[0].detailsSnapshot).toEqual({ itemsCount: 5, totalAmount: 99.95 });
    expect(storedOrder?.objects[0].__isLazyStub).toBeFalsy();

    expect(storedCustomer?.objects[0].name).toBe("ACME Corp");
    expect(storedCustomer?.objects[0].__isLazyStub).toBeFalsy();

    // Now simulate an offline restart: create brand new manager instances restoring from storage
    const offlineManagers: Record<string, any> = {};
    const offlineOrderManager = new AutoUpdateClientManager(
      LazyOrderClient as any,
      "LazyOrderClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      offlineManagers,
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: orderStorage },
      { lazyLoading: true },
    );
    const offlineCustomerManager = new AutoUpdateClientManager(
      LazyCustomerClient as any,
      "LazyCustomerClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      offlineManagers,
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: customerStorage },
      { lazyLoading: true },
    );
    offlineManagers["LazyOrderClient"] = offlineOrderManager;
    offlineManagers["LazyCustomerClient"] = offlineCustomerManager;

    await ClientStateReconciler.restoreFromStorage(offlineOrderManager as any, orderStorage);
    await ClientStateReconciler.restoreFromStorage(offlineCustomerManager as any, customerStorage);

    const restoredOrder = offlineOrderManager.getObject("order-1");
    const restoredCust = offlineCustomerManager.getObject("cust-1");

    expect(restoredOrder?.isLoaded).toBe(true);
    expect(restoredOrder?.isLazyStub).toBeFalsy();
    expect(restoredOrder?.orderNumber).toBe("ORD-100");
    expect(restoredOrder?.detailsSnapshot).toEqual({ itemsCount: 5, totalAmount: 99.95 });

    expect(restoredCust?.isLoaded).toBe(true);
    expect(restoredCust?.isLazyStub).toBeFalsy();
    expect(restoredCust?.name).toBe("ACME Corp");

    // Calling ensureLoaded() on restored entities must return immediately without socket calls
    const ensuredOrder = await restoredOrder!.ensureLoaded();
    expect(ensuredOrder).toBe(restoredOrder);

    const ensuredCust = await restoredCust!.ensureLoaded();
    expect(ensuredCust).toBe(restoredCust);
  });

  it("should serialize and deserialize lazy state with LocalStorageAdapter", async () => {
    const memoryBackend: Record<string, string> = {};
    const mockStorageBackend = {
      getItem: (key: string) => memoryBackend[key] ?? null,
      setItem: (key: string, value: string) => { memoryBackend[key] = value; },
      removeItem: (key: string) => { delete memoryBackend[key]; },
    };

    const lsAdapter = new LocalStorageAdapter({ storage: mockStorageBackend });

    const lsManager = new AutoUpdateClientManager(
      SnapshotTaskClient as any,
      "SnapshotTaskClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      {},
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: lsAdapter },
      { lazyLoading: true },
    );

    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupSnapshotTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            revision: 42,
            ids: ["ls-1"],
            manifest: [{ _id: "ls-1", description: "Task: LocalStorage" }],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await lsManager.loadFromServer();

    // Verify localStorage received serialized JSON
    const rawSaved = mockStorageBackend.getItem("dem_state_SnapshotTaskClient");
    expect(rawSaved).toBeTruthy();
    const parsed = JSON.parse(rawSaved!);
    expect(parsed.manifest).toEqual([{ _id: "ls-1", description: "Task: LocalStorage" }]);
    expect(parsed.objects[0].__isLazyStub).toBe(true);

    // Restore into fresh manager
    const freshManager = new AutoUpdateClientManager(
      SnapshotTaskClient as any,
      "SnapshotTaskClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      {},
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: lsAdapter },
      { lazyLoading: true },
    );

    const result = await ClientStateReconciler.restoreFromStorage(freshManager as any, lsAdapter);
    expect(result.restored).toBe(true);
    expect(freshManager.manifest).toEqual([{ _id: "ls-1", description: "Task: LocalStorage" }]);
    const restoredStub = freshManager.getObject("ls-1");
    expect(restoredStub?.isLazyStub).toBe(true);
    expect(restoredStub?.descriptor).toBe("Task: LocalStorage");
  });

  it("should gracefully handle missing or corrupted manifests during restoration", async () => {
    // Stored state without manifest field (legacy snapshot)
    await storageAdapter.saveManagerState("SnapshotTaskClient", {
      className: "SnapshotTaskClient",
      revision: 1,
      ids: ["task-legacy"],
      objects: [
        { _id: "task-legacy", title: "Legacy", authorId: "u1" },
      ],
      properties: ["title", "authorId", "metadataSnapshot", "_id"],
      savedAt: Date.now(),
    });

    const legacyManager = new AutoUpdateClientManager(
      SnapshotTaskClient as any,
      "SnapshotTaskClient",
      mockSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      {},
      emitter as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage: storageAdapter },
      { lazyLoading: true },
    );

    const result = await ClientStateReconciler.restoreFromStorage(legacyManager as any, storageAdapter);
    expect(result.restored).toBe(true);
    // When no manifest is in storage, manifest remains empty array rather than undefined or throwing
    expect(legacyManager.manifest).toBeDefined();
    expect(Array.isArray(legacyManager.manifest)).toBe(true);
  });
});
