import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { DEM_RAW_ARRAY } from "../AutoUpdatedClientObjectClass.js";
import { globalCache, DEMError } from "../CommonTypes.js";

function makeMockSocket() {
  return {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn((event: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({ success: true, message: "OK" });
      }
    }),
  };
}

describe("Reference Array Getter Referential Stability & Proxy Immutability", () => {
  let loggers: any;
  let emitter: EventEmitter;
  let mockSocket: any;

  beforeEach(() => {
    globalCache.clear();
    emitter = new EventEmitter();
    mockSocket = makeMockSocket();
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  function createTestClasses() {
    class MockItem extends AutoUpdatedClientObject<any> {
      get _id() {
        return (this as any).data?._id;
      }
      override waitForPreloaded = jest.fn().mockResolvedValue(undefined as any);
    }
    Reflect.defineMetadata("props", ["_id", "title"], MockItem.prototype);

    class MockContainer extends AutoUpdatedClientObject<any> {
      get _id() {
        return (this as any).data?._id;
      }
      override waitForPreloaded = jest.fn().mockResolvedValue(undefined as any);
    }
    Reflect.defineMetadata("props", ["_id", "items"], MockContainer.prototype);
    Reflect.defineMetadata("isRef", true, MockContainer.prototype, "items");
    Reflect.defineMetadata("refsTo", "MockItem", MockContainer.prototype, "items");

    return { MockItem, MockContainer };
  }

  test("Reference array getter returns stable proxy reference across multiple reads", async () => {
    const { MockItem, MockContainer } = createTestClasses();

    const itemManager = new AutoUpdateClientManager(
      MockItem as any,
      "MockItem",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const containerManager = new AutoUpdateClientManager(
      MockContainer as any,
      "MockContainer",
      mockSocket as any,
      loggers,
      { MockItem: itemManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const item1 = new MockItem(
      MockItem,
      mockSocket,
      { _id: "item-1", title: "First Item" },
      loggers,
      "MockItem",
      itemManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    const item2 = new MockItem(
      MockItem,
      mockSocket,
      { _id: "item-2", title: "Second Item" },
      loggers,
      "MockItem",
      itemManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    (itemManager as any).objects_["item-1"] = item1;
    (itemManager as any).objects_["item-2"] = item2;
    globalCache.objects["item-1"] = { className: "MockItem", object: item1 as any };
    globalCache.objects["item-2"] = { className: "MockItem", object: item2 as any };

    const container = new MockContainer(
      MockContainer,
      mockSocket,
      { _id: "container-1", items: ["item-1", "item-2"] },
      loggers,
      "MockContainer",
      containerManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    // 1. Check Array.isArray
    const itemsRead1 = (container as any).items;
    expect(Array.isArray(itemsRead1)).toBe(true);
    expect(itemsRead1.length).toBe(2);
    expect(itemsRead1[0]).toBe(item1);
    expect(itemsRead1[1]).toBe(item2);

    // 2. Check Referential Stability: consecutive reads return the exact same proxy reference
    const itemsRead2 = (container as any).items;
    expect(itemsRead1).toBe(itemsRead2);

    // 3. Check Read operations work cleanly
    const titles = itemsRead1.map((x: any) => x.title);
    expect(titles).toEqual(["First Item", "Second Item"]);
  });

  test("Proxy blocks mutating operations for developers with informative errors", async () => {
    const { MockItem, MockContainer } = createTestClasses();

    const itemManager = new AutoUpdateClientManager(
      MockItem as any,
      "MockItem",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );
    const containerManager = new AutoUpdateClientManager(
      MockContainer as any,
      "MockContainer",
      mockSocket as any,
      loggers,
      { MockItem: itemManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const container = new MockContainer(
      MockContainer,
      mockSocket,
      { _id: "container-1", items: [] },
      loggers,
      "MockContainer",
      containerManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const items = (container as any).items;

    // Mutating method calls must throw DEMError
    expect(() => items.push({} as any)).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.pop()).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.shift()).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.unshift({} as any)).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.splice(0, 1)).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.sort()).toThrow(/Cannot mutate DEM reference array 'items' directly/);
    expect(() => items.reverse()).toThrow(/Cannot mutate DEM reference array 'items' directly/);

    // Index assignment must throw DEMError
    expect(() => {
      items[0] = {} as any;
    }).toThrow(/Cannot assign index on DEM reference array 'items'/);

    // Element deletion must throw DEMError
    expect(() => {
      delete items[0];
    }).toThrow(/Cannot delete elements from DEM reference array 'items'/);
  });

  test("Underlying mutable array is accessible to the library via DEM_RAW_ARRAY", async () => {
    const { MockContainer } = createTestClasses();
    const container = new MockContainer(
      MockContainer,
      mockSocket,
      { _id: "container-1", items: [] },
      loggers,
      "MockContainer",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const items = (container as any).items;
    const raw = items[DEM_RAW_ARRAY];
    expect(Array.isArray(raw)).toBe(true);

    // Direct mutation of raw internal array does not throw
    expect(() => raw.push({ test: true })).not.toThrow();
    expect(raw.length).toBe(1);
  });

  test("Cache invalidates when a referenced child entity is destroyed", async () => {
    const { MockItem, MockContainer } = createTestClasses();

    const itemManager = new AutoUpdateClientManager(
      MockItem as any,
      "MockItem",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );
    const containerManager = new AutoUpdateClientManager(
      MockContainer as any,
      "MockContainer",
      mockSocket as any,
      loggers,
      { MockItem: itemManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const item1 = new MockItem(
      MockItem,
      mockSocket,
      { _id: "item-10", title: "Active Child 1" },
      loggers,
      "MockItem",
      itemManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    const item2 = new MockItem(
      MockItem,
      mockSocket,
      { _id: "item-20", title: "Active Child 2" },
      loggers,
      "MockItem",
      itemManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    (itemManager as any).objects_["item-10"] = item1;
    (itemManager as any).objects_["item-20"] = item2;
    globalCache.objects["item-10"] = { className: "MockItem", object: item1 as any };
    globalCache.objects["item-20"] = { className: "MockItem", object: item2 as any };

    const container = new MockContainer(
      MockContainer,
      mockSocket,
      { _id: "container-99", items: ["item-10", "item-20"] },
      loggers,
      "MockContainer",
      containerManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    // First read: both items resolved and cached
    const itemsInitial = (container as any).items;
    expect(itemsInitial.length).toBe(2);
    expect(itemsInitial[0]).toBe(item1);
    expect(itemsInitial[1]).toBe(item2);

    // Destroy item1 via manager
    await itemManager.deleteObject("item-10");
    expect(globalCache.objects["item-10"]).toBeUndefined();

    // Second read: cache must detect that item1 is destroyed and purge stale cache
    const itemsAfterDelete = (container as any).items;
    expect(itemsAfterDelete.length).toBe(1);
    expect(itemsAfterDelete[0]).toBe(item2);
    expect(itemsAfterDelete).not.toBe(itemsInitial);
  });
});
