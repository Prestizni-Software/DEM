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
});
