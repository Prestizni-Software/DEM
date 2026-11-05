import { jest } from "@jest/globals";
import { ClientStateReconciler, ReconcilableClientManager } from "../sync/ClientStateReconciler.js";
import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";
import { StoredManagerState } from "../sync/types.js";
import { globalCache } from "../CommonTypes.js";
import "reflect-metadata";
import { EventEmitter } from "eventemitter3";
import { Subordinate } from "./testData/ClientClasses/index.js";

/**
 * Minimal client object whose cloning getter fails when read.
 */
class RawOnlyObject {
  public _id: string;
  public data: Record<string, any>;
  public isLazyStub = false;
  public descriptor?: string;

  constructor(
    public classParam: any,
    public socket: any,
    dataOrId: any,
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
      this._id = dataOrId._id;
      this.data = { ...dataOrId };
    }
  }

  get extractedData(): never {
    throw new Error("extractedData (cloneDeep) must not be read");
  }

  getRawExtractedData() {
    return { ...this.data, _id: this._id };
  }
}

/**
 * Builds a reconcilable manager for the tests.
 */
function createManager(): ReconcilableClientManager<any> {
  return {
    className: "Person",
    properties: ["_id", "name"],
    classParam: RawOnlyObject,
    socket: {},
    loggers: { warn: jest.fn() },
    callbacks: {},
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
    deleteObject: jest.fn(async () => undefined),
  } as unknown as ReconcilableClientManager<any>;
}

beforeEach(() => {
  for (const k in globalCache.objects) delete globalCache.objects[k];
});

describe("Part 1: serializeState", () => {
  it("serializes without reading the cloning extractedData getter", () => {
    const manager = createManager();
    manager.objects_["a"] = new RawOnlyObject(RawOnlyObject, {}, { _id: "a", name: "Ann" }, {}, "Person", manager, {}, {});
    const state = ClientStateReconciler.serializeState(manager, 7);
    expect(state.revision).toBe(7);
    expect(state.ids).toEqual(["a"]);
    expect(state.objects).toEqual([{ _id: "a", name: "Ann" }]);
    expect(state.className).toBe("Person");
  });

  it("keeps lazy stubs as stubs", () => {
    const manager = createManager();
    const stub = new RawOnlyObject(RawOnlyObject, {}, "b", {}, "Person", manager, {}, {});
    stub.isLazyStub = true;
    stub.descriptor = "Bob";
    manager.objects_["b"] = stub;
    const state = ClientStateReconciler.serializeState(manager, 1);
    expect(state.objects[0]).toEqual({ _id: "b", __isLazyStub: true, descriptor: "Bob" });
  });

  it("persistToStorage stores the serialized state", async () => {
    const manager = createManager();
    manager.objects_["a"] = new RawOnlyObject(RawOnlyObject, {}, { _id: "a", name: "Ann" }, {}, "Person", manager, {}, {});
    const adapter = new MemoryStorageAdapter();
    await ClientStateReconciler.persistToStorage(manager, 3, adapter);
    const stored = await adapter.loadManagerState<any>("Person");
    expect(stored?.revision).toBe(3);
    expect(stored?.ids).toEqual(["a"]);
  });
});

describe("Part 2: restoreFromState", () => {
  const state: StoredManagerState<any> = {
    className: "Person",
    revision: 5,
    ids: ["a", "b"],
    objects: [{ _id: "a", name: "Ann" }, { _id: "b", __isLazyStub: true, descriptor: "Bob" }],
    properties: ["_id", "name"],
    savedAt: 1,
    manifest: [{ _id: "a", description: "Ann" }],
  };

  it("hydrates a manager from a state object without an adapter", () => {
    const manager = createManager();
    const result = ClientStateReconciler.restoreFromState(manager, state);
    expect(result).toEqual({ restored: true, revision: 5, count: 2 });
    expect(Object.keys(manager.objects_)).toEqual(["a", "b"]);
    expect(manager.totalObjects).toBe(2);
    expect(manager.loadedObjects).toBe(2);
    expect(manager.isLoaded_).toBe(true);
    expect(manager.manifest).toEqual([{ _id: "a", description: "Ann" }]);
    expect((manager.objects_["b"] as any).isLazyStub).toBe(true);
    expect(globalCache.objects["a"].object).toBe(manager.objects_["a"]);
  });

  it("returns restored false for an empty state", () => {
    const manager = createManager();
    const result = ClientStateReconciler.restoreFromState(manager, { ...state, ids: [], objects: [] });
    expect(result).toEqual({ restored: false, revision: 5, count: 0 });
  });

  it("restoreFromStorage uses the same path", async () => {
    const manager = createManager();
    const adapter = new MemoryStorageAdapter();
    await adapter.saveManagerState("Person", state);
    const result = await ClientStateReconciler.restoreFromStorage(manager, adapter);
    expect(result.count).toBe(2);
    expect(manager.isLoaded_).toBe(true);
  });
});

export type { StoredManagerState };
export { createManager, RawOnlyObject };

describe("Part 3: constructor cost", () => {
  const N = 200;
  const build = () => {
    const socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
    const manager = { managers: {}, cache: { references: {} }, isLoaded: true };
    const loggers = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const emitter = new EventEmitter();
    const objs: any[] = [];
    for (let i = 0; i < N; i++) {
      objs.push(
        new (Subordinate as any)(Subordinate, socket, { _id: "id" + i, name: "n" + i }, loggers, "Subordinate", manager, {}, emitter),
      );
    }
    return { objs, loggers };
  };

  it("schedules one batched microtask for many constructions", async () => {
    const spy = jest.spyOn(Promise.prototype, "then");
    build();
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(calls).toBeLessThan(N / 10);
  });

  it("keeps accessors and loggers working after the microtask", async () => {
    const { objs, loggers } = build();
    await Promise.resolve();
    await Promise.resolve();
    expect(objs[3].name).toBe("n3");
    expect((objs[3] as any)._loggers).toBeUndefined();
    objs[3].loggers.info("hello");
    expect((objs[3] as any)._loggers).toBeDefined();
    expect(loggers.info).toHaveBeenCalledWith(expect.stringContaining("id3"));
    expect(loggers.info).toHaveBeenCalledWith(expect.stringContaining("hello"));
  });
});

describe("Part 4: restoreAndRevalidate", () => {
  const storedState: StoredManagerState<any> = {
    className: "Person",
    revision: 5,
    ids: ["a"],
    objects: [{ _id: "a", name: "Ann" }],
    properties: ["_id", "name"],
    savedAt: 1,
  };

  it("returns restored data before fetchDelta resolves and applies delta later", async () => {
    const manager = createManager();
    const adapter = new MemoryStorageAdapter();
    await adapter.saveManagerState("Person", storedState);

    let resolveDelta!: (value: any) => void;
    const fetchDelta = jest.fn(
      () =>
        new Promise<any>((res) => {
          resolveDelta = res;
        }),
    );

    const result = await ClientStateReconciler.restoreAndRevalidate(
      manager,
      adapter,
      fetchDelta,
    );

    expect(result.restored).toBe(true);
    expect(result.revision).toBe(5);
    expect(result.count).toBe(1);
    expect(manager.objects_["a"].data.name).toBe("Ann");
    expect(fetchDelta).toHaveBeenCalledWith(5);

    resolveDelta({
      status: "delta",
      revision: 8,
      changes: [
        {
          revision: 8,
          type: "create",
          id: "b",
          data: { _id: "b", name: "Bob" },
          timestamp: 2,
          estimatedBytes: 10,
        },
      ],
    });

    const reval = await result.revalidation;
    expect(reval).toEqual({
      reconciled: true,
      fullResyncRequired: false,
      revision: 8,
    });
    expect(manager.objects_["b"]).toBeDefined();
    expect(manager.objects_["b"].data.name).toBe("Bob");
  });

  it("reports fullResyncRequired when server returns full status", async () => {
    const manager = createManager();
    const adapter = new MemoryStorageAdapter();
    await adapter.saveManagerState("Person", storedState);

    const result = await ClientStateReconciler.restoreAndRevalidate(
      manager,
      adapter,
      async () => ({ status: "full", revision: 12 }),
    );

    const reval = await result.revalidation;
    expect(reval).toEqual({
      reconciled: false,
      fullResyncRequired: true,
      revision: 12,
    });
  });

  it("reports fullResyncRequired when fetchDelta throws", async () => {
    const manager = createManager();
    const adapter = new MemoryStorageAdapter();
    await adapter.saveManagerState("Person", storedState);

    const result = await ClientStateReconciler.restoreAndRevalidate(
      manager,
      adapter,
      async () => {
        throw new Error("network error");
      },
    );

    const reval = await result.revalidation;
    expect(reval).toEqual({
      reconciled: false,
      fullResyncRequired: true,
      revision: 5,
    });
  });
});

describe("Part 5: Delta Sync Compaction and Callback Batching", () => {
  it("coalesces redundant change entries per entity in coalesceChanges", () => {
    const rawChanges = [
      // Entity 1: created then updated 3 times -> single create with merged data
      { revision: 1, type: "create" as const, id: "e1", data: { _id: "e1", name: "v1", count: 0 }, timestamp: 1, estimatedBytes: 20 },
      { revision: 2, type: "update" as const, id: "e1", data: { name: "v2" }, timestamp: 2, estimatedBytes: 20 },
      { revision: 3, type: "update" as const, id: "e1", data: { count: 1 }, timestamp: 3, estimatedBytes: 20 },
      { revision: 4, type: "update" as const, id: "e1", data: { name: "v3", extra: true }, timestamp: 4, estimatedBytes: 20 },
      // Entity 2: created, updated, then deleted -> completely omitted
      { revision: 5, type: "create" as const, id: "e2", data: { _id: "e2", name: "temp" }, timestamp: 5, estimatedBytes: 20 },
      { revision: 6, type: "update" as const, id: "e2", data: { name: "temp2" }, timestamp: 6, estimatedBytes: 20 },
      { revision: 7, type: "delete" as const, id: "e2", timestamp: 7, estimatedBytes: 20 },
      // Entity 3: existing entity updated 100 times -> single update with merged data
      ...Array.from({ length: 100 }, (_, i) => ({
        revision: 8 + i,
        type: "update" as const,
        id: "e3",
        data: { step: i + 1, [`k${i % 5}`]: i },
        timestamp: 8 + i,
        estimatedBytes: 20,
      })),
      // Entity 4: existing entity updated then deleted -> single delete
      { revision: 108, type: "update" as const, id: "e4", data: { name: "beforeDel" }, timestamp: 108, estimatedBytes: 20 },
      { revision: 109, type: "delete" as const, id: "e4", timestamp: 109, estimatedBytes: 20 },
    ];

    const compacted = ClientStateReconciler.coalesceChanges(rawChanges);
    expect(compacted.length).toBe(3);

    const c1 = compacted.find((c) => c.id === "e1");
    expect(c1?.type).toBe("create");
    expect(c1?.revision).toBe(4);
    expect(c1?.data).toEqual({ _id: "e1", name: "v3", count: 1, extra: true });

    const c2 = compacted.find((c) => c.id === "e2");
    expect(c2).toBeUndefined();

    const c3 = compacted.find((c) => c.id === "e3");
    expect(c3?.type).toBe("update");
    expect(c3?.revision).toBe(107);
    expect(c3?.data).toEqual({
      step: 100,
      k0: 95,
      k1: 96,
      k2: 97,
      k3: 98,
      k4: 99,
    });

    const c4 = compacted.find((c) => c.id === "e4");
    expect(c4?.type).toBe("delete");
    expect(c4?.revision).toBe(109);
  });

  it("applies 500 sequential updates across 10 entities in O(U * K) instead of O(C * K) and supports batchCallbacks", async () => {
    const socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
    const loggers = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const emitter = new EventEmitter();
    const updateCb = jest.fn();
    const newCb = jest.fn();
    const deleteCb = jest.fn();
    const batchUpdateCb = jest.fn();

    const manager: ReconcilableClientManager<any> = {
      className: "Subordinate",
      properties: ["_id", "name"],
      classParam: Subordinate,
      socket,
      loggers,
      callbacks: {
        new: newCb,
        update: updateCb,
        delete: deleteCb,
        batchUpdate: batchUpdateCb,
      },
      emitter,
      objects_: {},
      get objectsAsArray() {
        return Object.values(this.objects_);
      },
      totalObjects: 10,
      loadedObjects: 10,
      isLoaded_: true,
      getObject(id: string) {
        return this.objects_[id];
      },
      deleteObject: jest.fn(async (id: string) => {
        delete manager.objects_[id];
      }),
    };

    for (let i = 0; i < 10; i++) {
      const id = `sub_${i}`;
      manager.objects_[id] = new (Subordinate as any)(
        Subordinate,
        socket,
        { _id: id, name: `Initial_${i}` },
        loggers,
        "Subordinate",
        manager,
        manager.callbacks,
        emitter,
      );
    }
    await Promise.resolve();

    // Generate 500 updates (50 per entity)
    const changes = [];
    for (let i = 0; i < 500; i++) {
      const targetIdx = i % 10;
      changes.push({
        revision: i + 1,
        type: "update" as const,
        id: `sub_${targetIdx}`,
        data: { name: `Updated_${targetIdx}_rev_${i}` },
        timestamp: i + 1,
        estimatedBytes: 32,
      });
    }

    const setValueSpy = jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(manager.objects_["sub_0"])),
      "setValue__",
    );

    await ClientStateReconciler.applyDelta(
      manager,
      { status: "delta", revision: 500, changes },
      undefined,
      { batchCallbacks: true },
    );

    // Because of compaction, setValue__ is called only once per unique entity (10 times total, not 500!)
    expect(setValueSpy).toHaveBeenCalledTimes(10);
    setValueSpy.mockRestore();

    // Because batchCallbacks: true is enabled, per-property updateCb is suppressed and batchUpdateCb fires once
    expect(updateCb).not.toHaveBeenCalled();
    expect(batchUpdateCb).toHaveBeenCalledTimes(1);
    expect(batchUpdateCb).toHaveBeenCalledWith(
      expect.objectContaining({
        updated: expect.any(Array),
        created: [],
        deletedIds: [],
      }),
    );
    expect(batchUpdateCb.mock.calls[0][0].updated.length).toBe(10);

    for (let i = 0; i < 10; i++) {
      expect(manager.objects_[`sub_${i}`].name).toBe(`Updated_${i}_rev_${490 + i}`);
    }
  });
});

