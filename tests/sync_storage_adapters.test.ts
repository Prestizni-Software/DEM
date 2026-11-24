import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";
import { LocalStorageAdapter } from "../sync/storage/LocalStorageAdapter.js";
import { IndexedDbStorageAdapter } from "../sync/storage/IndexedDbStorageAdapter.js";
import { StoredManagerState } from "../sync/types.js";

describe("Client Storage Adapters", () => {
  describe("MemoryStorageAdapter", () => {
    test("saves, loads and clears manager state", async () => {
      const adapter = new MemoryStorageAdapter();

      expect(await adapter.loadManagerState("Company")).toBeNull();

      const sampleState: StoredManagerState<any> = {
        className: "Company",
        revision: 42,
        ids: ["id1", "id2"],
        objects: [{ _id: "id1", name: "Corp A" }, { _id: "id2", name: "Corp B" }],
        properties: ["_id", "name"],
        savedAt: Date.now(),
      };

      await adapter.saveManagerState("Company", sampleState);

      const loaded = await adapter.loadManagerState("Company");
      expect(loaded).toBeDefined();
      expect(loaded?.revision).toBe(42);
      expect(loaded?.ids).toEqual(["id1", "id2"]);
      expect(loaded?.objects.length).toBe(2);

      // Verify deep clone isolation
      sampleState.objects[0].name = "Mutated In Place";
      const loadedAgain = await adapter.loadManagerState("Company");
      expect(loadedAgain?.objects[0].name).toBe("Corp A");

      await adapter.clearManagerState("Company");
      expect(await adapter.loadManagerState("Company")).toBeNull();
    });

    test("clearAll clears multiple manager states", async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.saveManagerState("M1", { className: "M1", revision: 1, ids: [], objects: [], properties: [], savedAt: 0 });
      await adapter.saveManagerState("M2", { className: "M2", revision: 2, ids: [], objects: [], properties: [], savedAt: 0 });

      expect(await adapter.loadManagerState("M1")).not.toBeNull();
      expect(await adapter.loadManagerState("M2")).not.toBeNull();

      await adapter.clearAll();
      expect(await adapter.loadManagerState("M1")).toBeNull();
      expect(await adapter.loadManagerState("M2")).toBeNull();
    });
  });

  describe("LocalStorageAdapter", () => {
    test("works with mock localStorage backend", async () => {
      const memoryMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => memoryMap.get(k) ?? null,
        setItem: (k: string, v: string) => { memoryMap.set(k, v); },
        removeItem: (k: string) => { memoryMap.delete(k); },
        clear: () => { memoryMap.clear(); },
        key: (idx: number) => Array.from(memoryMap.keys())[idx] ?? null,
        get length() { return memoryMap.size; },
      };

      const adapter = new LocalStorageAdapter({ prefix: "test_dem_", storage: mockStorage });

      const state: StoredManagerState<any> = {
        className: "User",
        revision: 10,
        ids: ["u1"],
        objects: [{ _id: "u1", username: "Alice" }],
        properties: ["_id", "username"],
        savedAt: Date.now(),
      };

      await adapter.saveManagerState("User", state);
      expect(memoryMap.has("test_dem_User")).toBe(true);
      const loaded = await adapter.loadManagerState("User");
      expect(loaded?.revision).toBe(10);
      expect(loaded?.objects[0].username).toBe("Alice");

      await adapter.clearManagerState("User");
      expect(memoryMap.has("test_dem_User")).toBe(false);
      expect(await adapter.loadManagerState("User")).toBeNull();
    });

    test("uses default prefix dem_state_ and clearAll only deletes prefixed keys", async () => {
      const memoryMap = new Map<string, string>();
      memoryMap.set("unrelated_key", "keep_me");
      const mockStorage = {
        getItem: (k: string) => memoryMap.get(k) ?? null,
        setItem: (k: string, v: string) => { memoryMap.set(k, v); },
        removeItem: (k: string) => { memoryMap.delete(k); },
        clear: () => { memoryMap.clear(); },
        key: (idx: number) => Array.from(memoryMap.keys())[idx] ?? null,
        get length() { return memoryMap.size; },
      };

      const adapter = new LocalStorageAdapter({ storage: mockStorage });
      await adapter.saveManagerState("Alpha", {
        className: "Alpha",
        revision: 1,
        ids: ["a1"],
        objects: [{ _id: "a1" }],
        properties: [],
        savedAt: 1,
      });
      await adapter.saveManagerState("Beta", {
        className: "Beta",
        revision: 2,
        ids: ["b1"],
        objects: [{ _id: "b1" }],
        properties: [],
        savedAt: 2,
      });

      expect(memoryMap.has("dem_state_Alpha")).toBe(true);
      expect(memoryMap.has("dem_state_Beta")).toBe(true);

      await adapter.clearAll();
      expect(memoryMap.has("dem_state_Alpha")).toBe(false);
      expect(memoryMap.has("dem_state_Beta")).toBe(false);
      expect(memoryMap.get("unrelated_key")).toBe("keep_me");
    });

    test("handles corrupted JSON, invalid shapes, missing backend, and storage errors safely", async () => {
      const mockStorage = {
        getItem: (k: string) => {
          if (k.endsWith("Corrupt")) return "INVALID_NON_JSON{{{";
          if (k.endsWith("BadRev")) return JSON.stringify({ revision: "not-a-number", ids: [] });
          if (k.endsWith("BadIds")) return JSON.stringify({ revision: 1, ids: "not-an-array" });
          if (k.endsWith("NullVal")) return "null";
          return null;
        },
        setItem: () => { throw new Error("QuotaExceededError"); },
        removeItem: () => { throw new Error("StorageError"); },
      };
      const adapter = new LocalStorageAdapter({ storage: mockStorage });
      expect(await adapter.loadManagerState("Corrupt")).toBeNull();
      expect(await adapter.loadManagerState("BadRev")).toBeNull();
      expect(await adapter.loadManagerState("BadIds")).toBeNull();
      expect(await adapter.loadManagerState("NullVal")).toBeNull();
      expect(await adapter.loadManagerState("Missing")).toBeNull();

      await expect(
        adapter.saveManagerState("A", { className: "A", revision: 1, ids: [], objects: [], properties: [], savedAt: 0 }),
      ).resolves.toBeUndefined();
      await expect(adapter.clearManagerState("A")).resolves.toBeUndefined();
      await expect(adapter.clearAll()).resolves.toBeUndefined();

      const noBackendAdapter = new LocalStorageAdapter();
      await expect(
        noBackendAdapter.saveManagerState("A", { className: "A", revision: 1, ids: [], objects: [], properties: [], savedAt: 0 }),
      ).resolves.toBeUndefined();
      expect(await noBackendAdapter.loadManagerState("A")).toBeNull();
      await expect(noBackendAdapter.clearManagerState("A")).resolves.toBeUndefined();
      await expect(noBackendAdapter.clearAll()).resolves.toBeUndefined();
    });
  });

  describe("IndexedDbStorageAdapter", () => {
    function createMockIdbFactory(options?: { failFirstOpen?: boolean; storeAlreadyExists?: boolean }) {
      const stores = new Map<string, Map<string, any>>();
      let openCount = 0;

      const makeReq = <T>(exec: () => T) => {
        const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          try {
            req.result = exec();
            req.onsuccess?.();
          } catch (e) {
            req.error = e;
            req.onerror?.();
          }
        });
        return req;
      };

      const factory: any = {
        open(dbName: string, _version?: number) {
          openCount += 1;
          const req: any = {
            result: null,
            error: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
          };
          queueMicrotask(() => {
            if (options?.failFirstOpen && openCount === 1) {
              req.error = new Error("Transient IDB open failure");
              req.onerror?.();
              return;
            }
            if (options?.storeAlreadyExists && !stores.has("manager_states")) {
              stores.set("manager_states", new Map());
            }
            const db: any = {
              name: dbName,
              objectStoreNames: {
                contains: (name: string) => stores.has(name),
              },
              createObjectStore: (name: string) => {
                const map = new Map<string, any>();
                stores.set(name, map);
                return map;
              },
              transaction: (storeName: string, _mode: string) => ({
                objectStore: (name: string) => {
                  const map = stores.get(name);
                  if (!map) throw new Error(`Missing store ${name}`);
                  return {
                    put: (record: any) => makeReq(() => { map.set(record.className, record); return record.className; }),
                    get: (key: string) => makeReq(() => map.get(key)),
                    delete: (key: string) => makeReq(() => { map.delete(key); }),
                    clear: () => makeReq(() => { map.clear(); }),
                  };
                },
              }),
            };
            req.result = db;
            req.onupgradeneeded?.();
            req.onsuccess?.();
          });
          return req;
        },
        _stores: stores,
      };
      return factory;
    }

    test("saves, loads, clears, and clears all manager states", async () => {
      const mockIdb = createMockIdbFactory();
      const adapter = new IndexedDbStorageAdapter({
        dbName: "test_db",
        storeName: "test_store",
        idbFactory: mockIdb,
      });

      expect(await adapter.loadManagerState("Company")).toBeNull();

      const state: StoredManagerState<any> = {
        className: "Company",
        revision: 7,
        ids: ["c1", "c2"],
        objects: [{ _id: "c1", name: "Acme" }, { _id: "c2", name: "Beta" }],
        properties: ["_id", "name"],
        savedAt: 12345,
      };

      await adapter.saveManagerState("Company", state);
      const loaded = await adapter.loadManagerState("Company");
      expect(loaded?.revision).toBe(7);
      expect(loaded?.ids).toEqual(["c1", "c2"]);
      expect(loaded?.objects.length).toBe(2);

      // Invalid shape in store returns null
      mockIdb._stores.get("test_store").set("InvalidRev", { className: "InvalidRev", revision: "bad", ids: [] });
      mockIdb._stores.get("test_store").set("InvalidIds", { className: "InvalidIds", revision: 1, ids: "bad" });
      expect(await adapter.loadManagerState("InvalidRev")).toBeNull();
      expect(await adapter.loadManagerState("InvalidIds")).toBeNull();

      await adapter.clearManagerState("Company");
      expect(await adapter.loadManagerState("Company")).toBeNull();

      await adapter.saveManagerState("M1", { ...state, className: "M1" });
      await adapter.saveManagerState("M2", { ...state, className: "M2" });
      await adapter.clearAll();
      expect(await adapter.loadManagerState("M1")).toBeNull();
      expect(await adapter.loadManagerState("M2")).toBeNull();
    });

    test("recovers after transient IndexedDB open failure and handles missing idbFactory", async () => {
      const flakyIdb = createMockIdbFactory({ failFirstOpen: true, storeAlreadyExists: true });
      const adapter = new IndexedDbStorageAdapter({ idbFactory: flakyIdb });

      // First call fails open and gracefully falls back
      expect(await adapter.loadManagerState("Company")).toBeNull();

      // Second call retries open because dbPromise was cleared on error
      await adapter.saveManagerState("Company", {
        className: "Company",
        revision: 3,
        ids: ["c1"],
        objects: [{ _id: "c1" }],
        properties: [],
        savedAt: 1,
      });
      const loaded = await adapter.loadManagerState("Company");
      expect(loaded?.revision).toBe(3);

      // Missing idbFactory gracefully no-ops and returns null
      const unsupported = new IndexedDbStorageAdapter();
      await expect(
        unsupported.saveManagerState("X", { className: "X", revision: 1, ids: [], objects: [], properties: [], savedAt: 0 }),
      ).resolves.toBeUndefined();
      expect(await unsupported.loadManagerState("X")).toBeNull();
      await expect(unsupported.clearManagerState("X")).resolves.toBeUndefined();
      await expect(unsupported.clearAll()).resolves.toBeUndefined();
    });
  });
});
