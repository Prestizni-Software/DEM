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

