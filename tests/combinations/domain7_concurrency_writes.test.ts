import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import {
  AutoUpdateClientManager,
  AUCManagerFactory,
} from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../../AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  classProp,
  populatedRef,
  globalCache,
  LoggersType,
  DEMArray,
} from "../../CommonTypes.js";

// ============================================================================
// Entity Models for Primitive Array Tests
// ============================================================================

/**
 * Server entity containing primitive array properties.
 */
class ConcurrencyDocServer extends AutoUpdatedServerObject<ConcurrencyDocServer> {
  @classProp
  public title!: string;

  @classProp
  public items!: string[];

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      (this as unknown as { entry?: { _id?: string } }).entry?._id?.toString() ??
      ""
    );
  }
}

/**
 * Client entity containing reactive DEMArray proxy.
 */
class ConcurrencyDocClient extends AutoUpdatedClientObject<ConcurrencyDocClient> {
  @classProp
  public title!: string;

  @classProp
  public items!: DEMArray<string>;

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      ""
    );
  }
}

// ============================================================================
// Entity Models for Relational Array Tests
// ============================================================================

/**
 * Server entity representing parent with relational child references.
 */
class RelParentServer extends AutoUpdatedServerObject<RelParentServer> {
  @classProp
  public name!: string;

  @classProp
  @populatedRef("RelChildClient")
  public children!: string[];

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      (this as unknown as { entry?: { _id?: string } }).entry?._id?.toString() ??
      ""
    );
  }
}

/**
 * Client entity representing parent with reactive DEMArray child proxies.
 */
class RelParentClient extends AutoUpdatedClientObject<RelParentClient> {
  @classProp
  public name!: string;

  @classProp
  @populatedRef("RelChildClient")
  public children!: DEMArray<RelChildClient>;

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      ""
    );
  }
}

/**
 * Server entity representing child with back-reference to parent.
 */
class RelChildServer extends AutoUpdatedServerObject<RelChildServer> {
  @classProp
  public label!: string;

  @classProp
  @populatedRef("RelParentClient")
  public parent?: string;

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      (this as unknown as { entry?: { _id?: string } }).entry?._id?.toString() ??
      ""
    );
  }
}

/**
 * Client entity representing child with back-reference to parent.
 */
class RelChildClient extends AutoUpdatedClientObject<RelChildClient> {
  @classProp
  public label!: string;

  @classProp
  @populatedRef("RelParentClient")
  public parent?: RelParentClient;

  public get _id(): string {
    return (
      (this as unknown as { data?: { _id?: string } }).data?._id?.toString() ??
      ""
    );
  }
}

// ============================================================================
// Mock Sockets & Test Utilities
// ============================================================================

/**
 * Mock socket interface representing client and server endpoints.
 */
interface IMockSocket {
  id: string;
  connected: boolean;
  on: (event: string, handler: Function) => IMockSocket;
  off: (event: string, handler?: Function) => IMockSocket;
  emit: (event: string, ...args: unknown[]) => void;
  eventNames?: () => string[];
  onAny?: (handler: Function) => void;
}

/**
 * Hub coordinating mock server broadcasts and client sockets.
 */
class MultiClientMockHub {
  private clientListeners: Map<string, Map<string, Function[]>> = new Map();
  private serverSocketListeners: Map<string, Map<string, Function[]>> = new Map();
  private serverSocketAnyListeners: Map<string, Function[]> = new Map();

  /**
   * Mock Socket.IO server broadcasting to all connected clients.
   */
  public readonly mockServer = {
    use: jest.fn(),
    on: jest.fn(),
    emit: (event: string, ...args: unknown[]): void => {
      for (const listenerMap of this.clientListeners.values()) {
        const handlers = listenerMap.get(event);
        if (handlers) {
          for (const handler of [...handlers]) {
            handler(...args);
          }
        }
      }
    },
    disconnectSockets: jest.fn(),
  };

  /**
   * Creates linked client and server mock socket pair.
   *
   * @param clientId - Client unique identifier.
   * @returns Linked socket endpoints.
   */
  public createClientPair(clientId: string): {
    clientSocket: IMockSocket;
    serverSocket: IMockSocket;
  } {
    const cListeners = new Map<string, Function[]>();
    this.clientListeners.set(clientId, cListeners);

    const sListeners = new Map<string, Function[]>();
    this.serverSocketListeners.set(clientId, sListeners);

    const sAnyListeners: Function[] = [];
    this.serverSocketAnyListeners.set(clientId, sAnyListeners);

    const clientSocket: IMockSocket = {
      id: clientId,
      connected: true,
      on: (event: string, handler: Function): IMockSocket => {
        const list = cListeners.get(event) ?? [];
        list.push(handler);
        cListeners.set(event, list);
        return clientSocket;
      },
      off: (event: string, handler?: Function): IMockSocket => {
        if (!handler) {
          cListeners.delete(event);
        } else {
          const list = cListeners.get(event) ?? [];
          cListeners.set(
            event,
            list.filter((h) => h !== handler),
          );
        }
        return clientSocket;
      },
      emit: (event: string, ...args: unknown[]): void => {
        const ack =
          typeof args[args.length - 1] === "function"
            ? (args[args.length - 1] as Function)
            : undefined;
        const payload =
          args.length > (ack ? 2 : 1)
            ? args.slice(0, ack ? -1 : undefined)
            : args[0];

        for (const anyFn of [...sAnyListeners]) {
          anyFn(event, payload, ack);
        }
        const handlers = sListeners.get(event);
        if (handlers) {
          for (const h of [...handlers]) {
            h(payload, ack);
          }
        }
      },
    };

    const serverSocket: IMockSocket = {
      id: `srv-${clientId}`,
      connected: true,
      on: (event: string, handler: Function): IMockSocket => {
        const list = sListeners.get(event) ?? [];
        list.push(handler);
        sListeners.set(event, list);
        return serverSocket;
      },
      off: (event: string, handler?: Function): IMockSocket => {
        if (!handler) {
          sListeners.delete(event);
        } else {
          const list = sListeners.get(event) ?? [];
          sListeners.set(
            event,
            list.filter((h) => h !== handler),
          );
        }
        return serverSocket;
      },
      onAny: (handler: Function): void => {
        sAnyListeners.push(handler);
      },
      eventNames: (): string[] => {
        return Array.from(sListeners.keys());
      },
      emit: (event: string, ...args: unknown[]): void => {
        const handlers = cListeners.get(event);
        if (handlers) {
          for (const h of [...handlers]) {
            h(...args);
          }
        }
      },
    };

    return { clientSocket, serverSocket };
  }
}

/**
 * Creates mock logger bundle for testing.
 *
 * @returns Logger mock functions.
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
 * Creates mock database model with tracking capabilities.
 *
 * @param initialDocs - Array of initial entity documents.
 * @returns Mock Mongoose model.
 */
function createMockModel(initialDocs: Array<Record<string, unknown>> = []) {
  const docs = initialDocs.map((d) => ({ ...d }));
  let activeUpdates = 0;
  let maxActiveUpdates = 0;
  let updateDelayMs = 0;
  let gatePromise: Promise<void> | null = null;

  const model: Record<string, unknown> = {
    db: { readyState: 1 },
    find: jest.fn().mockImplementation(async () => {
      return docs.map((d) => ({
        ...d,
        toObject: () => ({ ...d }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      }));
    }),
    findById: jest.fn().mockImplementation(async (id: string) => {
      const match = docs.find((d) => String(d._id) === String(id));
      if (!match) return null;
      return {
        ...match,
        toObject: () => ({ ...match }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
    }),
    updateOne: jest
      .fn()
      .mockImplementation(
        async (
          filter: { _id?: string },
          update: { $set?: Record<string, unknown> },
        ) => {
          activeUpdates++;
          maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates);

          if (gatePromise) {
            await gatePromise;
          }
          if (updateDelayMs > 0) {
            await new Promise((r) => setTimeout(r, updateDelayMs));
          }

          const match = docs.find((d) => String(d._id) === String(filter._id));
          if (match && update.$set) {
            Object.assign(match, update.$set);
          }
          activeUpdates--;
          return { modifiedCount: 1, matchedCount: 1 };
        },
      ),
    getMaxActiveUpdates: () => maxActiveUpdates,
    setUpdateDelay: (delay: number) => {
      updateDelayMs = delay;
    },
    setGatePromise: (p: Promise<void> | null) => {
      gatePromise = p;
    },
  };

  return model;
}

// ============================================================================
// Test Suite: Domain 7 Multi-Client Concurrency & Array Writes
// ============================================================================

describe("Domain 7: Multi-Client Concurrency & Array Writes", () => {
  let loggers: LoggersType;
  let hub: MultiClientMockHub;

  beforeEach(() => {
    globalCache.clear();
    loggers = createMockLoggers();
    hub = new MultiClientMockHub();
  });

  afterEach(() => {
    globalCache.clear();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Section 1: 4 Simultaneous Clients Concurrent Writes
  // ==========================================================================
  describe("1. 4 Simultaneous Clients Concurrent Writes", () => {
    it("serializes concurrent mutations via saveLock and increments revisions monotonically", async () => {
      const initialDoc = {
        _id: "doc-concurrency-1",
        title: "Concurrent Document",
        items: ["initial-item"],
      };
      const model = createMockModel([initialDoc]);
      (model as unknown as { setUpdateDelay: (d: number) => void }).setUpdateDelay(5);

      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};
      const serverManager = new AutoUpdateServerManager(
        ConcurrencyDocServer,
        "ConcurrencyDocClient",
        hub.mockServer as any,
        loggers,
        model as any,
        serverManagers,
        new EventEmitter(),
        { deltaSync: true },
      );
      serverManagers.ConcurrencyDocClient = serverManager;

      await serverManager.preLoad();
      await serverManager.loadReferences();

      // Initialize 4 separate client connections.
      const p1 = hub.createClientPair("client-1");
      const p2 = hub.createClientPair("client-2");
      const p3 = hub.createClientPair("client-3");
      const p4 = hub.createClientPair("client-4");

      serverManager.registerSocket(p1.serverSocket as any);
      serverManager.registerSocket(p2.serverSocket as any);
      serverManager.registerSocket(p3.serverSocket as any);
      serverManager.registerSocket(p4.serverSocket as any);

      const c1Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p1.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c2Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p2.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c3Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p3.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c4Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p4.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const c1 = c1Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-1",
      ) as ConcurrencyDocClient;
      const c2 = c2Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-1",
      ) as ConcurrencyDocClient;
      const c3 = c3Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-1",
      ) as ConcurrencyDocClient;
      const c4 = c4Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-1",
      ) as ConcurrencyDocClient;

      expect(c1.items.length).toBe(1);
      expect(c2.items.length).toBe(1);
      expect(c3.items.length).toBe(1);
      expect(c4.items.length).toBe(1);

      const initialRev =
        serverManager.changeTracker?.getCurrentRevision() ?? 0;

      // Dispatch 4 simultaneous async mutations.
      await Promise.all([
        c1.items.push("c1-val"),
        c2.items.unshift("c2-val"),
        c3.items.push("c3-val"),
        c4.items.push("c4-val"),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify saveLock serialization without race conditions.
      const maxActive = (
        model as unknown as { getMaxActiveUpdates: () => number }
      ).getMaxActiveUpdates();
      expect(maxActive).toBe(1);

      // Verify monotonic revision increments up to +4.
      const finalRev =
        serverManager.changeTracker?.getCurrentRevision() ?? 0;
      expect(finalRev).toBe(initialRev + 4);

      // Verify convergence to identical canonical state across all 4 clients.
      expect(c1.items.length).toBe(5);
      expect(c1.items.slice()).toEqual(c2.items.slice());
      expect(c2.items.slice()).toEqual(c3.items.slice());
      expect(c3.items.slice()).toEqual(c4.items.slice());

      // Verify all 4 inserted values exist in canonical array.
      expect(c1.items).toContain("c1-val");
      expect(c1.items).toContain("c2-val");
      expect(c1.items).toContain("c3-val");
      expect(c1.items).toContain("c4-val");
      expect(c1.items).toContain("initial-item");

      // Verify content hashes match across all 4 clients.
      const h1 = c1.items.join(",");
      const h2 = c2.items.join(",");
      const h3 = c3.items.join(",");
      const h4 = c4.items.join(",");
      expect(h1).toBe(h2);
      expect(h2).toBe(h3);
      expect(h3).toBe(h4);
    });
  });

  // ==========================================================================
  // Section 2: 4 Clients Mixed Operations & Positional Splice Race
  // ==========================================================================
  describe("2. 4 Clients Mixed Operations & Positional Splice Race", () => {
    it("anchors mutations by targetId during concurrent shifts and resolves target item", async () => {
      const initialDoc = {
        _id: "doc-concurrency-2",
        title: "Mixed Operations Doc",
        items: ["item-A", "item-B", "item-C", "item-D"],
      };
      const model = createMockModel([initialDoc]);

      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};
      const serverManager = new AutoUpdateServerManager(
        ConcurrencyDocServer,
        "ConcurrencyDocClient",
        hub.mockServer as any,
        loggers,
        model as any,
        serverManagers,
        new EventEmitter(),
        { deltaSync: true },
      );
      serverManagers.ConcurrencyDocClient = serverManager;

      await serverManager.preLoad();
      await serverManager.loadReferences();

      const p1 = hub.createClientPair("c-1");
      const p2 = hub.createClientPair("c-2");
      const p3 = hub.createClientPair("c-3");
      const p4 = hub.createClientPair("c-4");

      serverManager.registerSocket(p1.serverSocket as any);
      serverManager.registerSocket(p2.serverSocket as any);
      serverManager.registerSocket(p3.serverSocket as any);
      serverManager.registerSocket(p4.serverSocket as any);

      const c1Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p1.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c2Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p2.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c3Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p3.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c4Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p4.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const c1 = c1Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-2",
      ) as ConcurrencyDocClient;
      const c2 = c2Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-2",
      ) as ConcurrencyDocClient;
      const c3 = c3Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-2",
      ) as ConcurrencyDocClient;
      const c4 = c4Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-2",
      ) as ConcurrencyDocClient;

      // c1 prepends item, shifting positions of item-B and item-C.
      // c2 appends item.
      // c3 splices item-B at original index 1, anchored by targetId: item-B.
      // c4 sets item-C at original index 2, anchored by targetId: item-C.
      await Promise.all([
        c1.items.unshift("c1-start"),
        c2.items.push("c2-end"),
        c3.items.splice(1, 1, "item-B-replaced"),
        c4.items.set(2, "item-C-updated"),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify convergence.
      expect(c1.items.slice()).toEqual(c2.items.slice());
      expect(c2.items.slice()).toEqual(c3.items.slice());
      expect(c3.items.slice()).toEqual(c4.items.slice());

      // Target item-B was replaced; item-C was updated; item-A and item-D persist.
      expect(c1.items).toContain("c1-start");
      expect(c1.items).toContain("c2-end");
      expect(c1.items).toContain("item-A");
      expect(c1.items).toContain("item-B-replaced");
      expect(c1.items).toContain("item-C-updated");
      expect(c1.items).toContain("item-D");
      expect(c1.items).not.toContain("item-B");
    });

    it("safely handles duplicate and already-deleted target without deleting unintended neighbor", async () => {
      const initialDoc = {
        _id: "doc-concurrency-3",
        title: "Duplicate Deletion Doc",
        items: ["item-1", "item-2", "item-3", "item-4"],
      };
      const model = createMockModel([initialDoc]);

      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};
      const serverManager = new AutoUpdateServerManager(
        ConcurrencyDocServer,
        "ConcurrencyDocClient",
        hub.mockServer as any,
        loggers,
        model as any,
        serverManagers,
        new EventEmitter(),
        { deltaSync: true },
      );
      serverManagers.ConcurrencyDocClient = serverManager;

      await serverManager.preLoad();
      await serverManager.loadReferences();

      const p1 = hub.createClientPair("c-a");
      const p2 = hub.createClientPair("c-b");
      const p3 = hub.createClientPair("c-c");
      const p4 = hub.createClientPair("c-d");

      serverManager.registerSocket(p1.serverSocket as any);
      serverManager.registerSocket(p2.serverSocket as any);
      serverManager.registerSocket(p3.serverSocket as any);
      serverManager.registerSocket(p4.serverSocket as any);

      const c1Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p1.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c2Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p2.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c3Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p3.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c4Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p4.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const c1 = c1Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-3",
      ) as ConcurrencyDocClient;
      const c2 = c2Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-3",
      ) as ConcurrencyDocClient;
      const c3 = c3Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-3",
      ) as ConcurrencyDocClient;
      const c4 = c4Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-3",
      ) as ConcurrencyDocClient;

      // Both c1 and c2 attempt to delete item-2 with targetId: item-2.
      await Promise.all([c1.items.splice(1, 1), c2.items.splice(1, 1)]);

      await new Promise((resolve) => setTimeout(resolve, 20));

      // The first deletion removes item-2.
      // The second deletion finds target missing and avoids deleting unintended neighbor item-3.
      expect(c1.items.slice()).toEqual(["item-1", "item-3", "item-4"]);
      expect(c2.items.slice()).toEqual(["item-1", "item-3", "item-4"]);
      expect(c3.items.slice()).toEqual(["item-1", "item-3", "item-4"]);
      expect(c4.items.slice()).toEqual(["item-1", "item-3", "item-4"]);
    });
  });

  // ==========================================================================
  // Section 3: Strict Pessimistic Guarantee
  // ==========================================================================
  describe("3. Strict Pessimistic Guarantee", () => {
    it("preserves unmutated local state on issuing and peer clients while mutation is in-flight", async () => {
      const initialDoc = {
        _id: "doc-concurrency-4",
        title: "Pessimistic Doc",
        items: ["stable-alpha", "stable-beta"],
      };
      const model = createMockModel([initialDoc]);

      // Controlled gate delaying server persistence.
      let unlockGate: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        unlockGate = resolve;
      });
      (
        model as unknown as { setGatePromise: (p: Promise<void> | null) => void }
      ).setGatePromise(gate);

      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};
      const serverManager = new AutoUpdateServerManager(
        ConcurrencyDocServer,
        "ConcurrencyDocClient",
        hub.mockServer as any,
        loggers,
        model as any,
        serverManagers,
        new EventEmitter(),
      );
      serverManagers.ConcurrencyDocClient = serverManager;

      await serverManager.preLoad();
      await serverManager.loadReferences();

      const p1 = hub.createClientPair("c-p1");
      const p2 = hub.createClientPair("c-p2");
      const p3 = hub.createClientPair("c-p3");
      const p4 = hub.createClientPair("c-p4");

      serverManager.registerSocket(p1.serverSocket as any);
      serverManager.registerSocket(p2.serverSocket as any);
      serverManager.registerSocket(p3.serverSocket as any);
      serverManager.registerSocket(p4.serverSocket as any);

      const c1Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p1.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c2Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p2.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c3Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p3.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c4Mgr = await AUCManagerFactory(
        { ConcurrencyDocClient },
        loggers,
        p4.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const c1 = c1Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-4",
      ) as ConcurrencyDocClient;
      const c2 = c2Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-4",
      ) as ConcurrencyDocClient;
      const c3 = c3Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-4",
      ) as ConcurrencyDocClient;
      const c4 = c4Mgr.ConcurrencyDocClient.getObject(
        "doc-concurrency-4",
      ) as ConcurrencyDocClient;

      // Start in-flight mutation on c1.
      const mutationPromise = c1.items.push("in-flight-element");

      // Verify mutation is unresolved and gate is holding.
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Local state remains unmutated on issuing client.
      expect(c1.items.length).toBe(2);
      expect(c1.items.slice()).toEqual(["stable-alpha", "stable-beta"]);
      expect(c1.items.includes("in-flight-element")).toBe(false);

      // Local state remains unmutated on peer clients.
      expect(c2.items.slice()).toEqual(["stable-alpha", "stable-beta"]);
      expect(c3.items.slice()).toEqual(["stable-alpha", "stable-beta"]);
      expect(c4.items.slice()).toEqual(["stable-alpha", "stable-beta"]);

      // Release server persistence lock.
      unlockGate?.();
      await mutationPromise;
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Post-acknowledgment: all clients update to canonical state.
      expect(c1.items.slice()).toEqual([
        "stable-alpha",
        "stable-beta",
        "in-flight-element",
      ]);
      expect(c2.items.slice()).toEqual([
        "stable-alpha",
        "stable-beta",
        "in-flight-element",
      ]);
      expect(c3.items.slice()).toEqual([
        "stable-alpha",
        "stable-beta",
        "in-flight-element",
      ]);
      expect(c4.items.slice()).toEqual([
        "stable-alpha",
        "stable-beta",
        "in-flight-element",
      ]);
    });
  });

  // ==========================================================================
  // Section 4: 4-Client Relational Array Concurrent Writes
  // ==========================================================================
  describe("4. 4-Client Relational Array Concurrent Writes", () => {
    it("synchronizes child back-references consistently across 4 concurrent clients", async () => {
      const parentDoc = {
        _id: "rel-parent-1",
        name: "Parent Workspace",
        children: ["child-initial"],
      };
      const childDocs = [
        {
          _id: "child-initial",
          label: "Initial Child",
          parent: "rel-parent-1",
        },
        { _id: "child-1", label: "Child 1" },
        { _id: "child-2", label: "Child 2" },
        { _id: "child-3", label: "Child 3" },
        { _id: "child-4", label: "Child 4" },
      ];

      const parentModel = createMockModel([parentDoc]);
      const childModel = createMockModel(childDocs);

      const serverManagers: Record<string, AutoUpdateServerManager<any>> = {};

      const parentServerManager = new AutoUpdateServerManager(
        RelParentServer,
        "RelParentClient",
        hub.mockServer as any,
        loggers,
        parentModel as any,
        serverManagers,
        new EventEmitter(),
      );
      serverManagers.RelParentClient = parentServerManager;

      const childServerManager = new AutoUpdateServerManager(
        RelChildServer,
        "RelChildClient",
        hub.mockServer as any,
        loggers,
        childModel as any,
        serverManagers,
        new EventEmitter(),
      );
      serverManagers.RelChildClient = childServerManager;

      await Promise.all([
        parentServerManager.preLoad(),
        childServerManager.preLoad(),
      ]);
      await Promise.all([
        parentServerManager.loadReferences(),
        childServerManager.loadReferences(),
      ]);

      const p1 = hub.createClientPair("rel-c1");
      const p2 = hub.createClientPair("rel-c2");
      const p3 = hub.createClientPair("rel-c3");
      const p4 = hub.createClientPair("rel-c4");

      parentServerManager.registerSocket(p1.serverSocket as any);
      parentServerManager.registerSocket(p2.serverSocket as any);
      parentServerManager.registerSocket(p3.serverSocket as any);
      parentServerManager.registerSocket(p4.serverSocket as any);

      childServerManager.registerSocket(p1.serverSocket as any);
      childServerManager.registerSocket(p2.serverSocket as any);
      childServerManager.registerSocket(p3.serverSocket as any);
      childServerManager.registerSocket(p4.serverSocket as any);

      const defs = { RelParentClient, RelChildClient };

      const c1Mgrs = await AUCManagerFactory(
        defs,
        loggers,
        p1.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c2Mgrs = await AUCManagerFactory(
        defs,
        loggers,
        p2.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c3Mgrs = await AUCManagerFactory(
        defs,
        loggers,
        p3.clientSocket as any,
        false,
        new EventEmitter(),
      );
      const c4Mgrs = await AUCManagerFactory(
        defs,
        loggers,
        p4.clientSocket as any,
        false,
        new EventEmitter(),
      );

      const c1Parent = c1Mgrs.RelParentClient.getObject(
        "rel-parent-1",
      ) as RelParentClient;
      const c2Parent = c2Mgrs.RelParentClient.getObject(
        "rel-parent-1",
      ) as RelParentClient;
      const c3Parent = c3Mgrs.RelParentClient.getObject(
        "rel-parent-1",
      ) as RelParentClient;
      const c4Parent = c4Mgrs.RelParentClient.getObject(
        "rel-parent-1",
      ) as RelParentClient;

      const c1Child1 = c1Mgrs.RelChildClient.getObject(
        "child-1",
      ) as RelChildClient;
      const c2Child2 = c2Mgrs.RelChildClient.getObject(
        "child-2",
      ) as RelChildClient;
      const c3Child3 = c3Mgrs.RelChildClient.getObject(
        "child-3",
      ) as RelChildClient;
      const c4ChildInit = c4Mgrs.RelChildClient.getObject(
        "child-initial",
      ) as RelChildClient;

      // Verify initial back-references prior to mutations.
      expect(
        (c1Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent?._id,
      ).toBe("rel-parent-1");
      expect(
        (c2Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent?._id,
      ).toBe("rel-parent-1");
      expect(
        (c3Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent?._id,
      ).toBe("rel-parent-1");
      expect(c4ChildInit.parent?._id).toBe("rel-parent-1");

      // Dispatch concurrent mutations across 4 clients:
      // c1 appends child-1.
      // c2 appends child-2.
      // c3 prepends child-3.
      // c4 removes child-initial.
      await Promise.all([
        c1Parent.children.push(c1Child1),
        c2Parent.children.push(c2Child2),
        c3Parent.children.unshift(c3Child3),
        c4Parent.children.splice(0, 1),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 30));

      // Verify array convergence across all 4 clients.
      expect(c1Parent.children.length).toBe(3);
      expect(c2Parent.children.length).toBe(3);
      expect(c3Parent.children.length).toBe(3);
      expect(c4Parent.children.length).toBe(3);

      const c1Ids = (c1Parent.children as RelChildClient[]).map((c) => c._id);
      const c2Ids = (c2Parent.children as RelChildClient[]).map((c) => c._id);
      const c3Ids = (c3Parent.children as RelChildClient[]).map((c) => c._id);
      const c4Ids = (c4Parent.children as RelChildClient[]).map((c) => c._id);

      expect(c1Ids).toEqual(c2Ids);
      expect(c2Ids).toEqual(c3Ids);
      expect(c3Ids).toEqual(c4Ids);

      // Verify child-initial was removed on all 4 clients.
      expect(c1Ids).not.toContain("child-initial");

      // Verify back-reference cleared on removed child across all 4 clients.
      expect(
        (c1Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent,
      ).toBeUndefined();
      expect(
        (c2Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent,
      ).toBeUndefined();
      expect(
        (c3Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent,
      ).toBeUndefined();
      expect(
        (c4Mgrs.RelChildClient.getObject("child-initial") as RelChildClient)
          ?.parent,
      ).toBeUndefined();

      // Verify back-references assigned to newly added children on all 4 clients.
      for (const mgrs of [c1Mgrs, c2Mgrs, c3Mgrs, c4Mgrs]) {
        const ch1 = mgrs.RelChildClient.getObject("child-1") as RelChildClient;
        const ch2 = mgrs.RelChildClient.getObject("child-2") as RelChildClient;
        const ch3 = mgrs.RelChildClient.getObject("child-3") as RelChildClient;

        expect(ch1.parent?._id).toBe("rel-parent-1");
        expect(ch2.parent?._id).toBe("rel-parent-1");
        expect(ch3.parent?._id).toBe("rel-parent-1");
      }
    });
  });
});
