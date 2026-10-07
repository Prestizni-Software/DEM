import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";
import { LocalStorageAdapter } from "../sync/storage/LocalStorageAdapter.js";
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
      const loaded = await adapter.loadManagerState("User");
      expect(loaded?.revision).toBe(10);
      expect(loaded?.objects[0].username).toBe("Alice");

      await adapter.clearManagerState("User");
      expect(await adapter.loadManagerState("User")).toBeNull();
    });

    test("handles corrupted JSON data safely", async () => {
      const mockStorage = {
        getItem: () => "INVALID_NON_JSON{{{",
        setItem: () => {},
        removeItem: () => {},
      };
      const adapter = new LocalStorageAdapter({ storage: mockStorage });
      const loaded = await adapter.loadManagerState("Corrupt");
      expect(loaded).toBeNull();
    });
  });
});
