import { jest } from '@jest/globals';
import { ClientStateReconciler, ReconcilableClientManager } from "../sync/ClientStateReconciler.js";
import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";
import { DeltaSyncPayload } from "../sync/types.js";
import { globalCache } from "../CommonTypes.js";

// Mock client object class
class MockClientObject {
  public _id: string;
  public data: Record<string, any>;
  public name?: string;
  public age?: number;

  constructor(
    public classParam: any,
    public socket: any,
    public dataOrId: any,
    public loggers: any,
    public className: string,
    public manager: any,
    public callbacks: any,
    public emitter: any,
  ) {
    if (typeof dataOrId === "string") {
      this._id = dataOrId;
      this.data = { _id: dataOrId };
    } else {
      this._id = dataOrId._id || "unknown";
      this.data = { ...dataOrId };
      this.name = dataOrId.name;
      this.age = dataOrId.age;
    }
  }

  get extractedData() {
    return { ...this.data, _id: this._id, name: this.name, age: this.age };
  }

  setValue__(key: string, value: any) {
    this.data[key] = value;
    (this as any)[key] = value;
  }
}

describe("ClientStateReconciler", () => {
  let mockManager: ReconcilableClientManager<MockClientObject>;
  let storageAdapter: MemoryStorageAdapter;
  let newCallback: jest.Mock;
  let updateCallback: jest.Mock;
  let deleteCallback: jest.Mock;

  beforeEach(() => {
    // Clear globalCache
    for (const k in globalCache.objects) {
      delete globalCache.objects[k];
    }

    newCallback = jest.fn();
    updateCallback = jest.fn();
    deleteCallback = jest.fn();
    storageAdapter = new MemoryStorageAdapter();

    mockManager = {
      className: "Person",
      properties: ["_id", "name", "age"],
      classParam: MockClientObject,
      socket: {},
      loggers: { warn: jest.fn(), debug: jest.fn() },
      callbacks: { new: newCallback, update: updateCallback, delete: deleteCallback },
      emitter: {},
      objects_: {},
      get objectsAsArray() {
        return Object.values(this.objects_);
      },
      totalObjects: 0,
      loadedObjects: 0,
      isLoaded_: false,
      getObject(id: string) {
        return this.objects_[id];
      },
      async deleteObject(id: string) {
        delete this.objects_[id];
        delete globalCache.objects[id];
        return { success: true, message: "deleted" };
      },
    };
  });

  test("restores state from storage without network queries", async () => {
    await storageAdapter.saveManagerState("Person", {
      className: "Person",
      revision: 10,
      ids: ["p1", "p2"],
      objects: [
        { _id: "p1", name: "Alice", age: 30 },
        { _id: "p2", name: "Bob", age: 25 },
      ],
      properties: ["_id", "name", "age"],
      savedAt: Date.now(),
    });

    const result = await ClientStateReconciler.restoreFromStorage(mockManager, storageAdapter);
    expect(result.restored).toBe(true);
    expect(result.revision).toBe(10);
    expect(result.count).toBe(2);
    expect(mockManager.objects_["p1"].name).toBe("Alice");
    expect(mockManager.objects_["p2"].name).toBe("Bob");
    expect(globalCache.objects["p1"]?.object).toBe(mockManager.objects_["p1"]);
  });

  test("applies delta payload with creates, updates, and deletes", async () => {
    // Pre-populate with p1
    mockManager.objects_["p1"] = new MockClientObject(
      MockClientObject,
      {},
      { _id: "p1", name: "Alice", age: 30 },
      {},
      "Person",
      mockManager,
      mockManager.callbacks,
      {},
    );
    globalCache.objects["p1"] = { className: "Person", object: mockManager.objects_["p1"] };
    mockManager.totalObjects = 1;
    mockManager.loadedObjects = 1;

    const deltaPayload: DeltaSyncPayload<any> = {
      status: "delta",
      revision: 15,
      changes: [
        // Update p1
        {
          revision: 12,
          type: "update",
          id: "p1",
          data: { age: 31 },
          timestamp: Date.now(),
          estimatedBytes: 50,
        },
        // Create p2
        {
          revision: 13,
          type: "create",
          id: "p2",
          data: { _id: "p2", name: "Charlie", age: 20 },
          timestamp: Date.now(),
          estimatedBytes: 60,
        },
      ],
    };

    await ClientStateReconciler.applyDelta(mockManager, deltaPayload, storageAdapter);

    // p1 was updated
    expect(mockManager.objects_["p1"].age).toBe(31);
    expect(updateCallback).toHaveBeenCalledWith(mockManager.objects_["p1"], "age");

    // p2 was created
    expect(mockManager.objects_["p2"]).toBeDefined();
    expect(mockManager.objects_["p2"].name).toBe("Charlie");
    expect(newCallback).toHaveBeenCalledWith(mockManager.objects_["p2"]);

    // Test delete delta
    const deletePayload: DeltaSyncPayload<any> = {
      status: "delta",
      revision: 16,
      changes: [
        {
          revision: 16,
          type: "delete",
          id: "p1",
          timestamp: Date.now(),
          estimatedBytes: 30,
        },
      ],
    };

    await ClientStateReconciler.applyDelta(mockManager, deletePayload, storageAdapter);
    expect(mockManager.objects_["p1"]).toBeUndefined();
    expect(globalCache.objects["p1"]).toBeUndefined();
    expect(deleteCallback).toHaveBeenCalled();
  });

  test("restoreFromState handles empty state, old object cleanup, out-of-order objects, manifests, lazy stubs, and errors", () => {
    expect(ClientStateReconciler.restoreFromState(mockManager, null)).toEqual({
      restored: false,
      revision: 0,
      count: 0,
    });
    expect(
      ClientStateReconciler.restoreFromState(mockManager, {
        className: "Person",
        revision: 5,
        ids: [],
        objects: [],
        properties: [],
        savedAt: 1,
      }),
    ).toEqual({ restored: false, revision: 5, count: 0 });

    const offMock = jest.fn();
    const destroyMock = jest.fn();
    mockManager.socket = { off: offMock };
    (mockManager as any)._cachedObjectsArray = ["stale"];
    const oldObj = new MockClientObject(MockClientObject, mockManager.socket, { _id: "old1" }, {}, "Person", mockManager, {}, {});
    (oldObj as any).destroyImmediate = destroyMock;
    mockManager.objects_["old1"] = oldObj;
    globalCache.objects["old1"] = { className: "Person", object: oldObj as any };

    const res = ClientStateReconciler.restoreFromState(mockManager, {
      className: "Person",
      revision: 12,
      ids: ["p1", "p2", "p3"],
      objects: [
        { _id: "p2", __isLazyStub: true, descriptor: "Lazy Bob" },
        { _id: "p1", name: "Alice", age: 30 },
      ],
      manifest: [{ _id: "p1", description: "Alice" }],
      properties: ["_id", "name", "age"],
      savedAt: 100,
    });

    expect(res).toEqual({ restored: true, revision: 12, count: 3 });
    expect(offMock).toHaveBeenCalledWith("updatePersonold1");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(globalCache.objects["old1"]).toBeUndefined();
    expect(mockManager.isLoaded_).toBe(true);
    expect(mockManager.totalObjects).toBe(3);
    expect(mockManager.loadedObjects).toBe(3);
    expect((mockManager as any)._cachedObjectsArray).toBeNull();
    expect(mockManager.manifest).toEqual([{ _id: "p1", description: "Alice" }]);
    expect(mockManager.objects_["p1"].name).toBe("Alice");
    expect((mockManager.objects_["p2"] as any).isLazyStub).toBe(true);
    expect((mockManager.objects_["p2"] as any).descriptor).toBe("Lazy Bob");
    expect(mockManager.objects_["p3"]._id).toBe("p3");

    // Error handling in restoreFromState
    mockManager.classParam = class {
      constructor() {
        throw new Error("Constructor exploded");
      }
    };
    const errRes = ClientStateReconciler.restoreFromState(mockManager, {
      className: "Person",
      revision: 1,
      ids: ["x1"],
      objects: [{ _id: "x1" }],
      properties: [],
      savedAt: 1,
    });
    expect(errRes).toEqual({ restored: false, revision: 0, count: 0 });
    expect(mockManager.loggers.warn).toHaveBeenCalledWith(
      expect.stringContaining("Constructor exploded"),
    );
  });

  test("restoreAndRevalidate handles up-to-date, delta, full, null, and error responses", async () => {
    await storageAdapter.saveManagerState("Person", {
      className: "Person",
      revision: 10,
      ids: ["p1"],
      objects: [{ _id: "p1", name: "Alice", age: 30 }],
      properties: ["_id", "name", "age"],
      savedAt: 1,
    });

    const upToDate = await ClientStateReconciler.restoreAndRevalidate(
      mockManager,
      storageAdapter,
      async () => ({ status: "up-to-date", revision: 10, changes: [] }),
    );
    expect(upToDate.restored).toBe(true);
    expect(await upToDate.revalidation).toEqual({
      reconciled: true,
      fullResyncRequired: false,
      revision: 10,
    });

    const deltaRes = await ClientStateReconciler.restoreAndRevalidate(
      mockManager,
      storageAdapter,
      async () => ({
        status: "delta",
        revision: 11,
        changes: [{ revision: 11, type: "update", id: "p1", data: { age: 35 }, timestamp: 1, estimatedBytes: 20 }],
      }),
    );
    expect(await deltaRes.revalidation).toEqual({
      reconciled: true,
      fullResyncRequired: false,
      revision: 11,
    });
    expect(mockManager.objects_["p1"].age).toBe(35);

    const fullRes = await ClientStateReconciler.restoreAndRevalidate(
      mockManager,
      storageAdapter,
      async () => ({ status: "full", revision: 20, changes: [] }),
    );
    expect(await fullRes.revalidation).toEqual({
      reconciled: false,
      fullResyncRequired: true,
      revision: 20,
    });

    const nullRes = await ClientStateReconciler.restoreAndRevalidate(
      mockManager,
      storageAdapter,
      async () => null,
    );
    expect(await nullRes.revalidation).toEqual({
      reconciled: false,
      fullResyncRequired: true,
      revision: 11,
    });

    const errRes = await ClientStateReconciler.restoreAndRevalidate(
      mockManager,
      storageAdapter,
      async () => {
        throw new Error("Network down");
      },
    );
    expect(await errRes.revalidation).toEqual({
      reconciled: false,
      fullResyncRequired: true,
      revision: 11,
    });
    expect(mockManager.loggers.warn).toHaveBeenCalledWith(
      expect.stringContaining("Network down"),
    );
  });

  test("serializeState and persistToStorage handle lazy stubs, raw data, missing _id, and errors", async () => {
    const lazyObj: any = { _id: "l1", isLazyStub: true, descriptor: "Stub 1" };
    const rawObj: any = { _id: "r1", getRawExtractedData: () => ({ name: "NoId" }) };
    const plainObj: any = { _id: "p1", data: { _id: "p1", name: "Plain" } };
    const bareObj: any = { _id: "b1" };
    mockManager.objects_ = { l1: lazyObj, r1: rawObj, p1: plainObj, b1: bareObj };
    mockManager.manifest = [{ _id: "l1", description: "Stub 1" }];

    const serialized = ClientStateReconciler.serializeState(mockManager, 42);
    expect(serialized.revision).toBe(42);
    expect(serialized.ids).toEqual(["l1", "r1", "p1", "b1"]);
    expect(serialized.objects).toEqual([
      { _id: "l1", __isLazyStub: true, descriptor: "Stub 1" },
      { name: "NoId", _id: "r1" },
      { _id: "p1", name: "Plain" },
      { _id: "b1" },
    ]);
    expect(serialized.manifest).toEqual([{ _id: "l1", description: "Stub 1" }]);

    const failingAdapter = {
      saveManagerState: jest.fn(async () => { throw new Error("Disk full"); }),
      loadManagerState: jest.fn(async () => { throw new Error("Read error"); }),
      clearManagerState: jest.fn(async () => {}),
      clearAll: jest.fn(async () => {}),
    };
    await ClientStateReconciler.persistToStorage(mockManager, 42, failingAdapter);
    expect(mockManager.loggers.warn).toHaveBeenCalledWith(
      expect.stringContaining("Disk full"),
    );
    const failedRestore = await ClientStateReconciler.restoreFromStorage(mockManager, failingAdapter);
    expect(failedRestore).toEqual({ restored: false, revision: 0, count: 0 });
  });

  test("coalesceChanges supports both compact and lifecycle-preserving modes", () => {
    const single = [{ revision: 1, type: "create" as const, id: "a", data: { x: 1 }, timestamp: 1, estimatedBytes: 10 }];
    expect(ClientStateReconciler.coalesceChanges(single)).toEqual(single);

    const seq = [
      { revision: 1, type: "create" as const, id: "a", data: { x: 1 }, timestamp: 1, estimatedBytes: 10 },
      { revision: 2, type: "update" as const, id: "a", data: { y: 2 }, timestamp: 2, estimatedBytes: 10 },
      { revision: 3, type: "create" as const, id: "b", data: { x: 1 }, timestamp: 3, estimatedBytes: 10 },
      { revision: 4, type: "delete" as const, id: "b", timestamp: 4, estimatedBytes: 10 },
      { revision: 5, type: "update" as const, id: "c", data: { x: 1 }, timestamp: 5, estimatedBytes: 10 },
      { revision: 6, type: "delete" as const, id: "c", timestamp: 6, estimatedBytes: 10 },
      { revision: 7, type: "delete" as const, id: "d", timestamp: 7, estimatedBytes: 10 },
      { revision: 8, type: "create" as const, id: "d", data: { x: 9 }, timestamp: 8, estimatedBytes: 10 },
      { revision: 9, type: "delete" as const, id: "e", timestamp: 9, estimatedBytes: 10 },
      { revision: 10, type: "update" as const, id: "e", data: { x: 10 }, timestamp: 10, estimatedBytes: 10 },
    ];

    const compact = ClientStateReconciler.coalesceChanges(seq, false);
    const byId = new Map(compact.map((c) => [c.id, c]));
    expect(byId.get("a")?.type).toBe("create");
    expect(byId.get("a")?.data).toEqual({ x: 1, y: 2 });
    expect(byId.has("b")).toBe(false);
    expect(byId.get("c")?.type).toBe("delete");
    expect(byId.get("d")?.type).toBe("create");
    expect(byId.get("e")?.type).toBe("update");

    const preserved = ClientStateReconciler.coalesceChanges(seq, true);
    expect(preserved.map((c) => `${c.revision}:${c.id}:${c.type}`)).toEqual([
      "1:a:create",
      "2:a:update",
      "3:b:create",
      "4:b:delete",
      "5:c:update",
      "6:c:delete",
      "8:d:create",
      "10:e:update",
    ]);
  });

  test("applyDelta handles batchCallbacks, evictObject, manifest updates, create-existing, update-missing, and plain objects", async () => {
    const evictMock = jest.fn(async (id: string) => {
      delete mockManager.objects_[id];
      delete globalCache.objects[id];
    });
    mockManager.evictObject = evictMock;
    mockManager.manifest = [{ _id: "p1", description: "P1" }];
    (mockManager as any)._cachedObjectsArray = [];
    (MockClientObject as any).getDescriptor = (d: any) => `Desc:${d.name}`;

    const plainTarget: any = { _id: "p1", data: { _id: "p1", name: "Old" }, name: "Old", _cachedExtractedData: { stale: true } };
    mockManager.objects_["p1"] = plainTarget;
    mockManager.totalObjects = 1;
    mockManager.loadedObjects = 1;

    const batchUpdateMock = jest.fn();
    mockManager.callbacks.batchUpdate = batchUpdateMock;

    await ClientStateReconciler.applyDelta(
      mockManager,
      {
        status: "delta",
        revision: 30,
        changes: [
          { revision: 27, type: "create", id: "p1", data: { _id: "p1", name: "UpdatedViaCreate" }, timestamp: 1, estimatedBytes: 10 },
          { revision: 28, type: "create", id: "p2", data: { _id: "p2", name: "NewP2" }, timestamp: 2, estimatedBytes: 10 },
          { revision: 29, type: "update", id: "p3", data: { _id: "p3", name: "CreatedViaUpdate" }, timestamp: 3, estimatedBytes: 10 },
          { revision: 30, type: "delete", id: "p1", timestamp: 4, estimatedBytes: 10 },
        ],
      },
      undefined,
      { batchCallbacks: true, coalesce: false },
    );

    expect(evictMock).toHaveBeenCalledWith("p1");
    expect(plainTarget.name).toBe("UpdatedViaCreate");
    expect(plainTarget._cachedExtractedData).toBeNull();
    expect(mockManager.objects_["p2"]).toBeDefined();
    expect(mockManager.objects_["p3"]).toBeDefined();
    expect(mockManager.manifest).toEqual([{ _id: "p2", description: "Desc:NewP2" }]);
    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    const summary = batchUpdateMock.mock.calls[0][0] as any;
    expect(summary.created.length).toBe(2);
    expect(summary.updated.length).toBe(1);
    expect(summary.deletedIds).toEqual(["p1"]);
    expect(newCallback).not.toHaveBeenCalled();

    // Fallback individual batch callbacks when batchUpdate is absent
    delete mockManager.callbacks.batchUpdate;
    await ClientStateReconciler.applyDelta(
      mockManager,
      {
        status: "delta",
        revision: 31,
        changes: [
          { revision: 31, type: "update", id: "p2", data: { name: "P2Mod" }, timestamp: 5, estimatedBytes: 10 },
          { revision: 32, type: "create", id: "p4", data: { _id: "p4", name: "P4" }, timestamp: 6, estimatedBytes: 10 },
          { revision: 33, type: "delete", id: "p3", timestamp: 7, estimatedBytes: 10 },
        ],
      },
      undefined,
      { batchCallbacks: true },
    );
    expect(updateCallback).toHaveBeenCalledWith(mockManager.objects_["p2"], "name");
    expect(newCallback).toHaveBeenCalledWith(mockManager.objects_["p4"]);
    expect(deleteCallback).toHaveBeenCalledWith(mockManager);

    delete (MockClientObject as any).getDescriptor;
  });
});
