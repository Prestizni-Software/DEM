import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import _ from "lodash";
import { AutoUpdateServerManager } from "../../AutoUpdateServerManagerClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import { AutoUpdatedServerObject } from "../../AutoUpdatedServerObjectClass.js";
import {
  AutoUpdatedClientObject,
  DEM_RAW_ARRAY,
} from "../../AutoUpdatedClientObjectClass.js";
import {
  classProp,
  populatedRef,
  globalCache,
  EntityDescriptor,
  ServerResponse,
  LoggersType,
  LazyLoadingOptions,
} from "../../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";

/**
 * Creates silent logger mocks for test execution.
 *
 * @returns LoggersType implementation with mocked logging functions.
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
 * Options for configuring linked mock socket pair.
 */
interface MockSocketPairOptions {
  handshakeAuth?: Record<string, unknown>;
  socketId?: string;
}

/**
 * Linked bidirectional client and server mock socket interfaces.
 */
interface MockSocketPair {
  clientSocket: {
    id: string;
    connected: boolean;
    on: (event: string, fn: Function) => any;
    off: (event: string, fn?: Function) => any;
    emit: (event: string, ...args: unknown[]) => void;
  };
  serverSocket: {
    id: string;
    handshake: {
      auth: Record<string, unknown>;
      address: string;
    };
    on: (event: string, fn: Function) => any;
    off: (event: string, fn?: Function) => any;
    onAny: (fn: (event: string, data: unknown, ack?: Function) => void) => any;
    eventNames: () => string[];
    emit: (event: string, ...args: unknown[]) => void;
  };
}

/**
 * Constructs linked client and server mock socket pair.
 *
 * @param options - Socket configuration options including handshake authentication.
 * @returns Linked mock socket pair.
 */
function createMockSocketPair(options: MockSocketPairOptions = {}): MockSocketPair {
  const clientListeners = new Map<string, Set<Function>>();
  const serverListeners = new Map<string, Set<Function>>();
  const serverAnyListeners = new Set<(event: string, data: unknown, ack?: Function) => void>();

  const clientSocket = {
    id: options.socketId ?? "client_socket_1",
    connected: true,
    on(event: string, fn: Function) {
      if (!clientListeners.has(event)) clientListeners.set(event, new Set());
      clientListeners.get(event)!.add(fn);
      return clientSocket;
    },
    off(event: string, fn?: Function) {
      if (!fn) {
        clientListeners.delete(event);
      } else {
        clientListeners.get(event)?.delete(fn);
      }
      return clientSocket;
    },
    emit(event: string, ...args: unknown[]) {
      const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as Function) : undefined;
      const data = args.length > (ack ? 2 : 1) ? args.slice(0, ack ? -1 : undefined) : args[0];

      for (const anyFn of serverAnyListeners) {
        anyFn(event, data, ack);
      }

      const listeners = serverListeners.get(event);
      if (listeners) {
        for (const fn of listeners) {
          fn(data, ack);
        }
      }
    },
  };

  const serverSocket = {
    id: options.socketId ?? "server_socket_1",
    handshake: {
      auth: options.handshakeAuth ?? {},
      address: "127.0.0.1",
    },
    on(event: string, fn: Function) {
      if (!serverListeners.has(event)) serverListeners.set(event, new Set());
      serverListeners.get(event)!.add(fn);
      return serverSocket;
    },
    off(event: string, fn?: Function) {
      if (!fn) {
        serverListeners.delete(event);
      } else {
        serverListeners.get(event)?.delete(fn);
      }
      return serverSocket;
    },
    onAny(fn: (event: string, data: unknown, ack?: Function) => void) {
      serverAnyListeners.add(fn);
      return serverSocket;
    },
    eventNames() {
      return Array.from(serverListeners.keys());
    },
    emit(event: string, ...args: unknown[]) {
      const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as Function) : undefined;
      const data = args.length > (ack ? 2 : 1) ? args.slice(0, ack ? -1 : undefined) : args[0];
      const listeners = clientListeners.get(event);
      if (listeners) {
        for (const fn of listeners) {
          fn(data, ack);
        }
      }
    },
  };

  return { clientSocket, serverSocket };
}

/**
 * Creates in-memory mock Mongoose model.
 *
 * @param initialData - Optional initial document records.
 * @returns Mock Mongoose model object.
 */
function createMockModel(initialData: Record<string, unknown>[] = []): any {
  const store = new Map<string, Record<string, unknown>>();
  for (const item of initialData) {
    store.set(String(item._id), _.cloneDeep(item));
  }
  return {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockImplementation(async () => Array.from(store.values())),
    }),
    findById: jest.fn().mockImplementation(async (id: unknown) => {
      const idStr = String((id as { _id?: unknown })?._id ?? id);
      const doc = store.get(idStr);
      if (!doc) return null;
      return {
        ...doc,
        save: jest.fn().mockResolvedValue(doc),
        schema: { path: jest.fn().mockReturnValue(true) },
      };
    }),
    create: jest.fn().mockImplementation(async (data: Record<string, unknown>) => {
      store.set(String(data._id), data);
      return data;
    }),
    updateOne: jest.fn().mockImplementation(
      async (
        filter: { _id: unknown },
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        const idStr = String(filter._id);
        const doc = store.get(idStr);
        if (doc) {
          if (update.$set) Object.assign(doc, update.$set);
          if (update.$unset) {
            for (const k of Object.keys(update.$unset)) {
              delete doc[k];
            }
          }
        }
        return { modifiedCount: 1 };
      },
    ),
    schema: { path: jest.fn().mockReturnValue(true) },
  };
}

// ---------------------------------------------------------------------------
// Entity Models for Tests
// ---------------------------------------------------------------------------

class LazyAuthorServer extends AutoUpdatedServerObject<LazyAuthorServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  public static override getDescriptor(data: Partial<LazyAuthorServer>): string {
    return `Author: ${data.name ?? "Anonymous"}`;
  }
}

class LazyAuthorClient extends AutoUpdatedClientObject<LazyAuthorClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public name!: string;

  public static override getDescriptor(data: Partial<LazyAuthorClient>): string {
    return `Author: ${data.name ?? "Anonymous"}`;
  }
}

class LazyBookServer extends AutoUpdatedServerObject<LazyBookServer> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("LazyAuthorClient")
  public author!: any;

  public static override getDescriptor(data: Partial<LazyBookServer>): string {
    return `Book: ${data.title ?? "Untitled"}`;
  }
}

class LazyBookClient extends AutoUpdatedClientObject<LazyBookClient> {
  public override get _id(): string {
    return (this.data as any)?._id;
  }

  @classProp
  public title!: string;

  @populatedRef("LazyAuthorClient")
  public author!: LazyAuthorClient;

  public static override getDescriptor(data: Partial<LazyBookClient>): string {
    return `Book: ${data.title ?? "Untitled"}`;
  }
}

// Circular Graph Models
class CycleNodeAServer extends AutoUpdatedServerObject<CycleNodeAServer> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeBClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeAServer>): string {
    return `NodeA: ${data.label ?? "Empty"}`;
  }
}

class CycleNodeAClient extends AutoUpdatedClientObject<CycleNodeAClient> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeBClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeAClient>): string {
    return `NodeA: ${data.label ?? "Empty"}`;
  }
}

class CycleNodeBServer extends AutoUpdatedServerObject<CycleNodeBServer> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeCClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeBServer>): string {
    return `NodeB: ${data.label ?? "Empty"}`;
  }
}

class CycleNodeBClient extends AutoUpdatedClientObject<CycleNodeBClient> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeCClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeBClient>): string {
    return `NodeB: ${data.label ?? "Empty"}`;
  }
}

class CycleNodeCServer extends AutoUpdatedServerObject<CycleNodeCServer> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeAClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeCServer>): string {
    return `NodeC: ${data.label ?? "Empty"}`;
  }
}

class CycleNodeCClient extends AutoUpdatedClientObject<CycleNodeCClient> {
  @classProp
  public label!: string;

  @populatedRef("CycleNodeAClient")
  public next!: any;

  public static override getDescriptor(data: Partial<CycleNodeCClient>): string {
    return `NodeC: ${data.label ?? "Empty"}`;
  }
}

// Multi-Manager Relational Models
class OrderCustomerServer extends AutoUpdatedServerObject<OrderCustomerServer> {
  @classProp
  public fullName!: string;

  public static override getDescriptor(data: Partial<OrderCustomerServer>): string {
    return `Customer: ${data.fullName ?? "Unknown"}`;
  }
}

class OrderCustomerClient extends AutoUpdatedClientObject<OrderCustomerClient> {
  @classProp
  public fullName!: string;

  public static override getDescriptor(data: Partial<OrderCustomerClient>): string {
    return `Customer: ${data.fullName ?? "Unknown"}`;
  }
}

class OrderItemServer extends AutoUpdatedServerObject<OrderItemServer> {
  @classProp
  public sku!: string;

  public static override getDescriptor(data: Partial<OrderItemServer>): string {
    return `Item: ${data.sku ?? "Unknown"}`;
  }
}

class OrderItemClient extends AutoUpdatedClientObject<OrderItemClient> {
  @classProp
  public sku!: string;

  public static override getDescriptor(data: Partial<OrderItemClient>): string {
    return `Item: ${data.sku ?? "Unknown"}`;
  }
}

class PurchaseOrderServer extends AutoUpdatedServerObject<PurchaseOrderServer> {
  @classProp
  public orderNumber!: string;

  @populatedRef("OrderCustomerClient")
  public customer!: any;

  @populatedRef("OrderItemClient")
  public item!: any;

  public static override getDescriptor(data: Partial<PurchaseOrderServer>): string {
    return `Order: ${data.orderNumber ?? "N/A"}`;
  }
}

class PurchaseOrderClient extends AutoUpdatedClientObject<PurchaseOrderClient> {
  @classProp
  public orderNumber!: string;

  @populatedRef("OrderCustomerClient")
  public customer!: OrderCustomerClient;

  @populatedRef("OrderItemClient")
  public item!: OrderItemClient;

  public static override getDescriptor(data: Partial<PurchaseOrderClient>): string {
    return `Order: ${data.orderNumber ?? "N/A"}`;
  }
}

// Reference Array Proxy Models
class TaskClientItem extends AutoUpdatedClientObject<TaskClientItem> {
  @classProp
  public title!: string;

  public static override getDescriptor(data: Partial<TaskClientItem>): string {
    return `Task: ${data.title ?? "Untitled"}`;
  }
}

class ProjectContainerClient extends AutoUpdatedClientObject<ProjectContainerClient> {
  @classProp
  public name!: string;

  @populatedRef("TaskClientItem")
  public tasks!: TaskClientItem[];

  public static override getDescriptor(data: Partial<ProjectContainerClient>): string {
    return `Project: ${data.name ?? "Untitled"}`;
  }
}

// Self-Contained Archive Models
class ArchivedDataClient extends AutoUpdatedClientObject<ArchivedDataClient> {
  @classProp
  public title!: string;

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  @classProp
  public logEntries!: Array<{ entryId: string; timestamp: number }>;

  public static override getDescriptor(data: Partial<ArchivedDataClient>): string {
    return `Archive: ${data.title ?? "Untitled"}`;
  }
}

// Permission Document Models
class SecuredDocumentServer extends AutoUpdatedServerObject<SecuredDocumentServer> {
  @classProp
  public title!: string;

  @classProp
  public isConfidential!: boolean;

  public static override getDescriptor(data: Partial<SecuredDocumentServer>): string {
    return `Document: ${data.title ?? "Untitled"}`;
  }
}

class SecuredDocumentClient extends AutoUpdatedClientObject<SecuredDocumentClient> {
  @classProp
  public title!: string;

  @classProp
  public isConfidential!: boolean;

  public static override getDescriptor(data: Partial<SecuredDocumentClient>): string {
    return `Document: ${data.title ?? "Untitled"}`;
  }
}

// Mutable Entity Models
class MutableTicketServer extends AutoUpdatedServerObject<MutableTicketServer> {
  @classProp
  public summary!: string;

  @classProp
  public priority!: string;

  public static override getDescriptor(data: Partial<MutableTicketServer>): string {
    return `Ticket: ${data.summary ?? "Untitled"}`;
  }
}

class MutableTicketClient extends AutoUpdatedClientObject<MutableTicketClient> {
  @classProp
  public summary!: string;

  @classProp
  public priority!: string;

  public static override getDescriptor(data: Partial<MutableTicketClient>): string {
    return `Ticket: ${data.summary ?? "Untitled"}`;
  }
}

// ---------------------------------------------------------------------------
// Main Test Suite
// ---------------------------------------------------------------------------

describe("Domain 4: Smart Lazy Loading Combinations", () => {
  let emitter: EventEmitter;
  let loggers: LoggersType;

  beforeEach(() => {
    // Clear global object cache before each test
    globalCache.clear();
    emitter = new EventEmitter();
    loggers = createMockLoggers();
  });

  // =========================================================================
  // F08 + F01: Smart Lazy Loading & Model Property Reflection
  // =========================================================================

  describe("F08 + F01: Lazy Loading and Model Property Reflection", () => {
    it("returns undefined safely when reading unhydrated properties on lazy stub", async () => {
      // Create mock socket pair
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const bookManager = new AutoUpdateClientManager(
        LazyBookClient as any,
        "LazyBookClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      clientManagers["LazyBookClient"] = bookManager;

      // Provide lazy startup manifest
      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        if (event === "startupLazyBookClient") {
          const ack = args[args.length - 1];
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["book-101"],
              manifest: [{ _id: "book-101", description: "Book: Design Patterns" }],
              properties: ["title", "author", "_id"],
            },
          });
        }
      });

      // Load manifest from server
      await bookManager.loadFromServer();

      const stub = bookManager.getObject("book-101");
      expect(stub).toBeDefined();
      expect(stub?.isLazyStub).toBe(true);
      expect(stub?.isLoaded).toBe(false);

      // Verify safe undefined reads for unhydrated properties
      expect(stub?.title).toBeUndefined();
      expect(stub?.author).toBeUndefined();

      // Verify defined identity and descriptor
      expect(stub?._id).toBe("book-101");
      expect(stub?.descriptor).toBe("Book: Design Patterns");
    });

    it("returns immediately without socket calls when ensureLoaded runs on loaded object", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const bookManager = new AutoUpdateClientManager(
        LazyBookClient as any,
        "LazyBookClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      clientManagers["LazyBookClient"] = bookManager;

      // Setup startup and get responses
      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (event === "startupLazyBookClient") {
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["book-102"],
              manifest: [{ _id: "book-102", description: "Book: Clean Architecture" }],
              properties: ["title", "author", "_id"],
            },
          });
        } else if (event === "getLazyBookClientbook-102") {
          ack({
            success: true,
            data: { _id: "book-102", title: "Clean Architecture" },
          });
        }
      });

      await bookManager.loadFromServer();
      const stub = bookManager.getObject("book-102")!;

      // Hydrate stub on first load
      const loaded = await stub.ensureLoaded();
      expect(loaded.isLazyStub).toBe(false);
      expect(loaded.isLoaded).toBe(true);
      expect(loaded.title).toBe("Clean Architecture");

      // Reset socket call counter
      (clientSocket.emit as jest.Mock).mockClear();

      // Ensure loaded on already hydrated object
      const secondCall = await loaded.ensureLoaded();
      expect(secondCall).toBe(loaded);
      expect(clientSocket.emit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // F08 + F02: Smart Lazy Loading & Cross-Entity Relationship Resolution
  // =========================================================================

  describe("F08 + F02: Lazy Loading and Cross-Entity Relationship Resolution", () => {
    it("terminates graph traversal cleanly when requested depth exceeds graph depth", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const authorServerModel = createMockModel();
      const bookServerModel = createMockModel();

      const authorServerMgr = new AutoUpdateServerManager(
        LazyAuthorServer as any,
        "LazyAuthorClient",
        mockServer,
        loggers,
        authorServerModel,
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const bookServerMgr = new AutoUpdateServerManager(
        LazyBookServer as any,
        "LazyBookClient",
        mockServer,
        loggers,
        bookServerModel,
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["LazyAuthorClient"] = authorServerMgr;
      serverManagers["LazyBookClient"] = bookServerMgr;

      // Populate server memory
      const authorServerObj: any = {
        _id: "author-201",
        name: "Martin Fowler",
        extractedData: { _id: "author-201", name: "Martin Fowler" },
        data: { _id: "author-201", name: "Martin Fowler" },
      };
      const bookServerObj: any = {
        _id: "book-201",
        title: "Refactoring",
        author: "author-201",
        extractedData: { _id: "book-201", title: "Refactoring", author: "author-201" },
        data: { _id: "book-201", title: "Refactoring", author: "author-201" },
      };

      (authorServerMgr as any).objects_["author-201"] = authorServerObj;
      (bookServerMgr as any).objects_["book-201"] = bookServerObj;

      bookServerMgr.registerSocket(serverSocket as any);
      authorServerMgr.registerSocket(serverSocket as any);

      // Create client managers
      const authorClientMgr = new AutoUpdateClientManager(
        LazyAuthorClient as any,
        "LazyAuthorClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const bookClientMgr = new AutoUpdateClientManager(
        LazyBookClient as any,
        "LazyBookClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["LazyAuthorClient"] = authorClientMgr;
      clientManagers["LazyBookClient"] = bookClientMgr;

      await authorClientMgr.loadFromServer();
      await bookClientMgr.loadFromServer();

      // Request hydration with depth 10 on a depth 1 relationship
      const hydratedBook = await bookClientMgr.loadObject("book-201", { depth: 10 });
      expect(hydratedBook.isLazyStub).toBe(false);
      expect(hydratedBook.title).toBe("Refactoring");

      // Verify that reachable author entity was resolved
      const hydratedAuthor = authorClientMgr.getObject("author-201");
      expect(hydratedAuthor).toBeDefined();
      expect(hydratedAuthor?.isLazyStub).toBe(false);
      expect(hydratedAuthor?.name).toBe("Martin Fowler");
      expect(hydratedBook.author.name).toBe("Martin Fowler");
    });

    it("terminates multi-level circular loop traversal cleanly using visited set", async () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      const mgrA = new AutoUpdateServerManager(
        CycleNodeAServer as any,
        "CycleNodeAClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const mgrB = new AutoUpdateServerManager(
        CycleNodeBServer as any,
        "CycleNodeBClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const mgrC = new AutoUpdateServerManager(
        CycleNodeCServer as any,
        "CycleNodeCClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["CycleNodeAClient"] = mgrA;
      serverManagers["CycleNodeBClient"] = mgrB;
      serverManagers["CycleNodeCClient"] = mgrC;

      // Construct circular cycle A -> B -> C -> A
      const nodeA: any = {
        _id: "node-a",
        label: "Alpha",
        next: "node-b",
        extractedData: { _id: "node-a", label: "Alpha", next: "node-b" },
        data: { _id: "node-a", label: "Alpha", next: "node-b" },
      };
      const nodeB: any = {
        _id: "node-b",
        label: "Beta",
        next: "node-c",
        extractedData: { _id: "node-b", label: "Beta", next: "node-c" },
        data: { _id: "node-b", label: "Beta", next: "node-c" },
      };
      const nodeC: any = {
        _id: "node-c",
        label: "Gamma",
        next: "node-a",
        extractedData: { _id: "node-c", label: "Gamma", next: "node-a" },
        data: { _id: "node-c", label: "Gamma", next: "node-a" },
      };

      (mgrA as any).objects_["node-a"] = nodeA;
      (mgrB as any).objects_["node-b"] = nodeB;
      (mgrC as any).objects_["node-c"] = nodeC;

      // Execute traversal with depth 6
      const related = await mgrA.collectEntityGraphAsync(nodeA, 6);

      // Verify circular traversal terminated and collected all nodes once
      expect(related["CycleNodeBClient"]).toBeDefined();
      expect(related["CycleNodeBClient"]).toHaveLength(1);
      expect(related["CycleNodeBClient"][0]._id).toBe("node-b");

      expect(related["CycleNodeCClient"]).toBeDefined();
      expect(related["CycleNodeCClient"]).toHaveLength(1);
      expect(related["CycleNodeCClient"][0]._id).toBe("node-c");

      // Verify root node was not duplicated
      expect(related["CycleNodeAClient"]).toBeUndefined();
    });

    it("hydrates sibling managers from related entities map during depth traversal", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const custServerMgr = new AutoUpdateServerManager(
        OrderCustomerServer as any,
        "OrderCustomerClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const itemServerMgr = new AutoUpdateServerManager(
        OrderItemServer as any,
        "OrderItemClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const orderServerMgr = new AutoUpdateServerManager(
        PurchaseOrderServer as any,
        "PurchaseOrderClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["OrderCustomerClient"] = custServerMgr;
      serverManagers["OrderItemClient"] = itemServerMgr;
      serverManagers["PurchaseOrderClient"] = orderServerMgr;

      const custObj: any = {
        _id: "cust-301",
        fullName: "Ada Lovelace",
        extractedData: { _id: "cust-301", fullName: "Ada Lovelace" },
        data: { _id: "cust-301", fullName: "Ada Lovelace" },
      };
      const itemObj: any = {
        _id: "item-301",
        sku: "COMP-001",
        extractedData: { _id: "item-301", sku: "COMP-001" },
        data: { _id: "item-301", sku: "COMP-001" },
      };
      const orderObj: any = {
        _id: "order-301",
        orderNumber: "PO-9001",
        customer: "cust-301",
        item: "item-301",
        extractedData: {
          _id: "order-301",
          orderNumber: "PO-9001",
          customer: "cust-301",
          item: "item-301",
        },
        data: {
          _id: "order-301",
          orderNumber: "PO-9001",
          customer: "cust-301",
          item: "item-301",
        },
      };

      (custServerMgr as any).objects_["cust-301"] = custObj;
      (itemServerMgr as any).objects_["item-301"] = itemObj;
      (orderServerMgr as any).objects_["order-301"] = orderObj;

      custServerMgr.registerSocket(serverSocket as any);
      itemServerMgr.registerSocket(serverSocket as any);
      orderServerMgr.registerSocket(serverSocket as any);

      const custClientMgr = new AutoUpdateClientManager(
        OrderCustomerClient as any,
        "OrderCustomerClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const itemClientMgr = new AutoUpdateClientManager(
        OrderItemClient as any,
        "OrderItemClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const orderClientMgr = new AutoUpdateClientManager(
        PurchaseOrderClient as any,
        "PurchaseOrderClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["OrderCustomerClient"] = custClientMgr;
      clientManagers["OrderItemClient"] = itemClientMgr;
      clientManagers["PurchaseOrderClient"] = orderClientMgr;

      await custClientMgr.loadFromServer();
      await itemClientMgr.loadFromServer();
      await orderClientMgr.loadFromServer();

      // Hydrate root purchase order
      const hydratedOrder = await orderClientMgr.loadObject("order-301", { depth: 1 });
      expect(hydratedOrder.isLazyStub).toBe(false);

      // Verify sibling managers populated
      const hydratedCust = custClientMgr.getObject("cust-301");
      const hydratedItem = itemClientMgr.getObject("item-301");

      expect(hydratedCust?.fullName).toBe("Ada Lovelace");
      expect(hydratedItem?.sku).toBe("COMP-001");

      // Verify synchronous pointer navigation
      expect(hydratedOrder.customer.fullName).toBe("Ada Lovelace");
      expect(hydratedOrder.item.sku).toBe("COMP-001");
    });
  });

  // =========================================================================
  // F08 + F03: Smart Lazy Loading & Reference Array Proxy
  // =========================================================================

  describe("F08 + F03: Lazy Loading and Reference Array Proxy", () => {
    it("wraps lazy relational arrays in read-only proxies after hydration", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const taskManager = new AutoUpdateClientManager(
        TaskClientItem as any,
        "TaskClientItem",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const projectManager = new AutoUpdateClientManager(
        ProjectContainerClient as any,
        "ProjectContainerClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["TaskClientItem"] = taskManager;
      clientManagers["ProjectContainerClient"] = projectManager;

      // Mock startup and hydration responses
      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (event === "startupProjectContainerClient") {
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["proj-401"],
              manifest: [{ _id: "proj-401", description: "Project: Infrastructure" }],
              properties: ["name", "tasks", "_id"],
            },
          });
        } else if (event === "startupTaskClientItem") {
          ack({
            success: true,
            data: { status: "lazy", ids: [], manifest: [], properties: ["title", "_id"] },
          });
        } else if (event === "getProjectContainerClientproj-401") {
          ack({
            success: true,
            data: { _id: "proj-401", name: "Infrastructure", tasks: ["task-401", "task-402"] },
            related: {
              TaskClientItem: [
                { _id: "task-401", title: "Setup Docker" },
                { _id: "task-402", title: "Configure Kubernetes" },
              ],
            },
          });
        }
      });

      await projectManager.loadFromServer();
      await taskManager.loadFromServer();

      const stub = projectManager.getObject("proj-401")!;
      // Accessing array on unhydrated stub returns undefined safely
      expect(stub.tasks).toBeUndefined();

      // Hydrate project instance
      const project = await stub.ensureLoaded();
      expect(project.isLazyStub).toBe(false);

      // Verify array proxy behavior
      const tasks = project.tasks;
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe("Setup Docker");
      expect(tasks[1].title).toBe("Configure Kubernetes");

      // Verify proxy access to raw array symbol
      expect((tasks as any)[DEM_RAW_ARRAY]).toBeDefined();

      // Verify mutating methods throw DEMError
      expect(() => (tasks as any).push({ title: "New Task" })).toThrow(DEMError);
      expect(() => {
        (tasks as any)[0] = { title: "Overwritten" };
      }).toThrow(DEMError);

      // Verify referential stability on repeated reads
      const tasksSecondRead = project.tasks;
      expect(tasksSecondRead).toBe(tasks);
    });
  });

  // =========================================================================
  // F08 + F04: Smart Lazy Loading & Server Manager Lifecycle
  // =========================================================================

  describe("F08 + F04: Lazy Server Manager Lifecycle and Manifest Generation", () => {
    it("generates server manifest using static getDescriptor with fallback formatting", async () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const managers: Record<string, any> = {};

      const serverMgr = new AutoUpdateServerManager(
        LazyBookServer as any,
        "LazyBookClient",
        mockServer,
        loggers,
        createMockModel(),
        managers,
        emitter,
        { lazyLoading: true },
      );

      const completeBook: any = {
        _id: "book-501",
        extractedData: { _id: "book-501", title: "Pragmatic Programmer" },
      };
      const incompleteBook: any = {
        _id: "book-502",
        extractedData: { _id: "book-502" },
      };

      const manifest = (serverMgr as any).generateManifest([completeBook, incompleteBook]);

      expect(manifest).toHaveLength(2);
      expect(manifest[0]).toEqual({
        _id: "book-501",
        description: "Book: Pragmatic Programmer",
      });
      expect(manifest[1]).toEqual({
        _id: "book-502",
        description: "Book: Untitled",
      });
    });
  });

  // =========================================================================
  // F08 + F05: Smart Lazy Loading & Client Manager Lifecycle
  // =========================================================================

  describe("F08 + F05: Lazy Client Manager Lifecycle and Progress Reporting", () => {
    it("reports 100 percent progress immediately on lazy client startup", async () => {
      const { clientSocket } = createMockSocketPair();
      const progressCallback = jest.fn();

      const clientMgr = new AutoUpdateClientManager(
        LazyAuthorClient as any,
        "LazyAuthorClient",
        clientSocket as any,
        loggers,
        {},
        emitter,
        {
          new: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          progress: progressCallback,
        },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        if (event === "startupLazyAuthorClient") {
          const ack = args[args.length - 1];
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["auth-1", "auth-2", "auth-3"],
              manifest: [
                { _id: "auth-1", description: "Author: One" },
                { _id: "auth-2", description: "Author: Two" },
                { _id: "auth-3", description: "Author: Three" },
              ],
              properties: ["name", "_id"],
            },
          });
        }
      });

      await clientMgr.loadFromServer();

      expect(clientMgr.isLoaded).toBe(true);
      expect(clientMgr.totalObjects).toBe(3);
      expect(clientMgr.loadedObjects).toBe(3);

      // Verify progress callback emitted 100 percent progress
      expect(progressCallback).toHaveBeenCalledWith(1);
      expect(progressCallback).toHaveBeenCalledTimes(1);

      // Verify all items exist as unhydrated stubs
      const stub = clientMgr.getObject("auth-1");
      expect(stub?.isLazyStub).toBe(true);
      expect(stub?.isLoaded).toBe(false);
    });
  });

  // =========================================================================
  // F08 + F06: Smart Lazy Loading & Real-Time Mutation Engine
  // =========================================================================

  describe("F08 + F06: Lazy Entities and Real-Time Mutation Engine", () => {
    it("handles real-time socket updates and transmits mutations on lazy entities", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const ticketModel = createMockModel([
        { _id: "ticket-601", summary: "Initial summary", priority: "LOW" },
      ]);

      const serverMgr = new AutoUpdateServerManager(
        MutableTicketServer as any,
        "MutableTicketClient",
        mockServer,
        loggers,
        ticketModel,
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      serverManagers["MutableTicketClient"] = serverMgr;

      const ticketServerObj: any = {
        _id: "ticket-601",
        summary: "Initial summary",
        priority: "LOW",
        extractedData: { _id: "ticket-601", summary: "Initial summary", priority: "LOW" },
        data: { _id: "ticket-601", summary: "Initial summary", priority: "LOW" },
        setValue: jest.fn().mockImplementation(async (key: string, val: unknown) => {
          ticketServerObj.data[key] = val;
          ticketServerObj.extractedData[key] = val;
          return { success: true, msg: "Updated" };
        }),
      };
      (serverMgr as any).objects_["ticket-601"] = ticketServerObj;
      serverMgr.registerSocket(serverSocket as any);

      const clientMgr = new AutoUpdateClientManager(
        MutableTicketClient as any,
        "MutableTicketClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      clientManagers["MutableTicketClient"] = clientMgr;

      await clientMgr.loadFromServer();
      const stub = clientMgr.getObject("ticket-601")!;
      expect(stub.isLazyStub).toBe(true);

      // Transmit mutation on lazy entity
      const updateResult = await stub.setValue("priority", "HIGH");
      expect(updateResult.success).toBe(true);
      expect(ticketServerObj.setValue).toHaveBeenCalledWith("priority", "HIGH");
    });
  });

  // =========================================================================
  // F08 + F07: Smart Lazy Loading & Entity Lifecycle CRUD
  // =========================================================================

  describe("F08 + F07: Lazy Loading and Entity Lifecycle CRUD", () => {
    it("broadcasts new descriptor to manifest and purges stubs on deletion", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};
      const newCallback = jest.fn();
      const deleteCallback = jest.fn();

      const clientMgr = new AutoUpdateClientManager(
        LazyAuthorClient as any,
        "LazyAuthorClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        {
          new: newCallback,
          update: jest.fn(),
          delete: deleteCallback,
          progress: jest.fn(),
        },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        if (event === "startupLazyAuthorClient") {
          const ack = args[args.length - 1];
          ack({
            success: true,
            data: { status: "lazy", ids: [], manifest: [], properties: ["name", "_id"] },
          });
        }
      });

      await clientMgr.loadFromServer();
      expect(clientMgr.manifest).toHaveLength(0);

      // Server broadcasts creation of new entity descriptor
      serverSocket.emit("newLazyAuthorClient", {
        _id: "auth-701",
        description: "Author: Donald Knuth",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(clientMgr.manifest).toHaveLength(1);
      expect(clientMgr.manifest[0]).toEqual({
        _id: "auth-701",
        description: "Author: Donald Knuth",
      });

      const stub = clientMgr.getObject("auth-701");
      expect(stub).toBeDefined();
      expect(stub?.isLazyStub).toBe(true);
      expect(newCallback).toHaveBeenCalledWith(stub);

      // Server broadcasts entity deletion
      serverSocket.emit("deleteLazyAuthorClient", "auth-701");

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(clientMgr.manifest).toHaveLength(0);
      expect(clientMgr.getObject("auth-701")).toBeUndefined();
      expect(deleteCallback).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // F08 + F11: Smart Lazy Loading & Self-Contained Snapshots
  // =========================================================================

  describe("F08 + F11: Lazy Loading and Self-Contained Snapshots", () => {
    it("hydrates self-contained snapshot subdocuments without cross-manager resolution", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const archiveMgr = new AutoUpdateClientManager(
        ArchivedDataClient as any,
        "ArchivedDataClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      clientManagers["ArchivedDataClient"] = archiveMgr;

      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (event === "startupArchivedDataClient") {
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["arch-801"],
              manifest: [{ _id: "arch-801", description: "Archive: Audit Log 2026" }],
              properties: ["title", "metadataSnapshot", "logEntries", "_id"],
            },
          });
        } else if (event === "getArchivedDataClientarch-801") {
          ack({
            success: true,
            data: {
              _id: "arch-801",
              title: "Audit Log 2026",
              metadataSnapshot: { systemVersion: "3.2.1", signedBy: "SecOps" },
              logEntries: [
                { entryId: "entry-1", timestamp: 1700000001 },
                { entryId: "entry-2", timestamp: 1700000002 },
              ],
            },
          });
        }
      });

      await archiveMgr.loadFromServer();
      const stub = archiveMgr.getObject("arch-801")!;
      expect(stub.isLazyStub).toBe(true);

      const hydrated = await stub.ensureLoaded();
      expect(hydrated.isLazyStub).toBe(false);
      expect(hydrated.title).toBe("Audit Log 2026");
      expect(hydrated.metadataSnapshot).toEqual({
        systemVersion: "3.2.1",
        signedBy: "SecOps",
      });
      expect(hydrated.logEntries).toHaveLength(2);
      expect(hydrated.logEntries[0].entryId).toBe("entry-1");
    });
  });

  // =========================================================================
  // F08 + F13: Smart Lazy Loading & Dynamic Permissions
  // =========================================================================

  describe("F08 + F13: Lazy Loading and Dynamic Permissions", () => {
    it("filters manifest entries per socket using startupMiddleware permissions", async () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      const serverMgr = new AutoUpdateServerManager(
        SecuredDocumentServer as any,
        "SecuredDocumentClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        {
          lazyLoading: true,
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              const role = socket.handshake?.auth?.role;
              if (role === "admin") return objects;
              return objects.filter((o: any) => !o.data?.isConfidential);
            },
          },
        },
      );
      serverManagers["SecuredDocumentClient"] = serverMgr;

      const docPublic: any = {
        _id: "doc-pub-1",
        title: "Public Roadmap",
        isConfidential: false,
        extractedData: { _id: "doc-pub-1", title: "Public Roadmap", isConfidential: false },
        data: { _id: "doc-pub-1", title: "Public Roadmap", isConfidential: false },
      };
      const docPrivate: any = {
        _id: "doc-priv-1",
        title: "Confidential Strategy",
        isConfidential: true,
        extractedData: { _id: "doc-priv-1", title: "Confidential Strategy", isConfidential: true },
        data: { _id: "doc-priv-1", title: "Confidential Strategy", isConfidential: true },
      };

      (serverMgr as any).objects_["doc-pub-1"] = docPublic;
      (serverMgr as any).objects_["doc-priv-1"] = docPrivate;

      // Socket 1: Admin socket
      const { clientSocket: adminClient, serverSocket: adminServer } = createMockSocketPair({
        handshakeAuth: { role: "admin" },
        socketId: "socket_admin",
      });
      serverMgr.registerSocket(adminServer as any);

      // Socket 2: Guest socket
      const { clientSocket: guestClient, serverSocket: guestServer } = createMockSocketPair({
        handshakeAuth: { role: "guest" },
        socketId: "socket_guest",
      });
      serverMgr.registerSocket(guestServer as any);

      const adminClientMgr = new AutoUpdateClientManager(
        SecuredDocumentClient as any,
        "SecuredDocumentClient",
        adminClient as any,
        loggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      const guestClientMgr = new AutoUpdateClientManager(
        SecuredDocumentClient as any,
        "SecuredDocumentClient",
        guestClient as any,
        loggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      await adminClientMgr.loadFromServer();
      await guestClientMgr.loadFromServer();

      // Admin manifest includes confidential document
      expect(adminClientMgr.manifest).toHaveLength(2);
      expect(adminClientMgr.manifest.map((m) => m._id)).toEqual(["doc-pub-1", "doc-priv-1"]);

      // Guest manifest excludes confidential document
      expect(guestClientMgr.manifest).toHaveLength(1);
      expect(guestClientMgr.manifest[0]._id).toBe("doc-pub-1");
      expect(guestClientMgr.getObject("doc-priv-1")).toBeUndefined();
    });
  });

  // =========================================================================
  // F08 + F14: Smart Lazy Loading & Error Handling
  // =========================================================================

  describe("F08 + F14: Lazy Loading and Hydration Error Handling", () => {
    it("rejects with OBJECT_LOAD_FAILED error code on hydration failure", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const bookManager = new AutoUpdateClientManager(
        LazyBookClient as any,
        "LazyBookClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      clientManagers["LazyBookClient"] = bookManager;

      // Mock server error on hydration
      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (event === "startupLazyBookClient") {
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["book-err-1"],
              manifest: [{ _id: "book-err-1", description: "Book: Missing" }],
              properties: ["title", "author", "_id"],
            },
          });
        } else if (event === "getLazyBookClientbook-err-1") {
          ack({
            success: false,
            code: DEMErrorCode.OBJECT_LOAD_FAILED,
            message: "Database connection failed",
          });
        }
      });

      await bookManager.loadFromServer();
      const stub = bookManager.getObject("book-err-1")!;
      expect(stub.isLazyStub).toBe(true);

      // Verify that loadObject rejects with OBJECT_LOAD_FAILED
      await expect(stub.ensureLoaded()).rejects.toMatchObject({
        code: DEMErrorCode.OBJECT_LOAD_FAILED,
      });

      // Verify stub remains unhydrated after error
      expect(stub.isLazyStub).toBe(true);
      expect(stub.isLoaded).toBe(false);
    });
  });

  // =========================================================================
  // Triplet Combinations
  // =========================================================================

  describe("Domain 4 Triplets", () => {
    it("triplet F08+F01+F02: combines lazy loading, property reflection, and relational depth", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};
      const clientManagers: Record<string, any> = {};

      const authorServerMgr = new AutoUpdateServerManager(
        LazyAuthorServer as any,
        "LazyAuthorClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      const bookServerMgr = new AutoUpdateServerManager(
        LazyBookServer as any,
        "LazyBookClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );

      serverManagers["LazyAuthorClient"] = authorServerMgr;
      serverManagers["LazyBookClient"] = bookServerMgr;

      const authorObj: any = {
        _id: "triplet-auth-1",
        name: "Kent Beck",
        extractedData: { _id: "triplet-auth-1", name: "Kent Beck" },
        data: { _id: "triplet-auth-1", name: "Kent Beck" },
      };
      const bookObj: any = {
        _id: "triplet-book-1",
        title: "Test Driven Development",
        author: "triplet-auth-1",
        extractedData: { _id: "triplet-book-1", title: "Test Driven Development", author: "triplet-auth-1" },
        data: { _id: "triplet-book-1", title: "Test Driven Development", author: "triplet-auth-1" },
      };

      (authorServerMgr as any).objects_["triplet-auth-1"] = authorObj;
      (bookServerMgr as any).objects_["triplet-book-1"] = bookObj;

      authorServerMgr.registerSocket(serverSocket as any);
      bookServerMgr.registerSocket(serverSocket as any);

      const authorClientMgr = new AutoUpdateClientManager(
        LazyAuthorClient as any,
        "LazyAuthorClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const bookClientMgr = new AutoUpdateClientManager(
        LazyBookClient as any,
        "LazyBookClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["LazyAuthorClient"] = authorClientMgr;
      clientManagers["LazyBookClient"] = bookClientMgr;

      await authorClientMgr.loadFromServer();
      await bookClientMgr.loadFromServer();

      const bookStub = bookClientMgr.getObject("triplet-book-1")!;
      // Prior to hydration, reflection returns undefined
      expect(bookStub.title).toBeUndefined();
      expect(bookStub.author).toBeUndefined();

      // Hydrate with depth 2
      const hydratedBook = await bookStub.ensureLoaded({ depth: 2 });
      expect(hydratedBook.title).toBe("Test Driven Development");
      expect(hydratedBook.author).toBeDefined();
      expect(hydratedBook.author.name).toBe("Kent Beck");
    });

    it("triplet F08+F02+F03: combines lazy loading, relational pointers, and array proxies", async () => {
      const { clientSocket } = createMockSocketPair();
      const clientManagers: Record<string, any> = {};

      const taskMgr = new AutoUpdateClientManager(
        TaskClientItem as any,
        "TaskClientItem",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );
      const projectMgr = new AutoUpdateClientManager(
        ProjectContainerClient as any,
        "ProjectContainerClient",
        clientSocket as any,
        loggers,
        clientManagers,
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      clientManagers["TaskClientItem"] = taskMgr;
      clientManagers["ProjectContainerClient"] = projectMgr;

      clientSocket.emit = jest.fn((event: string, ...args: any[]) => {
        const ack = args[args.length - 1];
        if (event === "startupProjectContainerClient") {
          ack({
            success: true,
            data: {
              status: "lazy",
              ids: ["proj-t2"],
              manifest: [{ _id: "proj-t2", description: "Project: Modernization" }],
              properties: ["name", "tasks", "_id"],
            },
          });
        } else if (event === "startupTaskClientItem") {
          ack({
            success: true,
            data: { status: "lazy", ids: [], manifest: [], properties: ["title", "_id"] },
          });
        } else if (event === "getProjectContainerClientproj-t2") {
          ack({
            success: true,
            data: { _id: "proj-t2", name: "Modernization", tasks: ["task-t2-a", "task-t2-b"] },
            related: {
              TaskClientItem: [
                { _id: "task-t2-a", title: "Migrate DB" },
                { _id: "task-t2-b", title: "Refactor Services" },
              ],
            },
          });
        }
      });

      await projectMgr.loadFromServer();
      await taskMgr.loadFromServer();

      const project = await projectMgr.loadObject("proj-t2", { depth: 1 });
      expect(project.isLazyStub).toBe(false);

      // Verify array proxy methods
      const taskTitles = project.tasks.map((t) => t.title);
      expect(taskTitles).toEqual(["Migrate DB", "Refactor Services"]);
      expect(project.tasks.length).toBe(2);

      // Verify read-only array proxy immutability
      expect(() => (project.tasks as any).splice(0, 1)).toThrow(DEMError);
    });

    it("triplet F08+F04+F13: combines lazy server manager, getDescriptor, and permissions", async () => {
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      const serverMgr = new AutoUpdateServerManager(
        SecuredDocumentServer as any,
        "SecuredDocumentClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        {
          lazyLoading: true,
          accessDefinitions: {
            startupMiddleware: async (objects, _managers, socket) => {
              const role = socket.handshake?.auth?.role;
              if (role === "auditor") return objects;
              return objects.filter((o: any) => !o.data?.isConfidential);
            },
          },
        },
      );
      serverManagers["SecuredDocumentClient"] = serverMgr;

      const doc1: any = {
        _id: "doc-t3-1",
        title: "Annual Report",
        isConfidential: false,
        extractedData: { _id: "doc-t3-1", title: "Annual Report", isConfidential: false },
        data: { _id: "doc-t3-1", title: "Annual Report", isConfidential: false },
      };
      const doc2: any = {
        _id: "doc-t3-2",
        title: "Internal Audit",
        isConfidential: true,
        extractedData: { _id: "doc-t3-2", title: "Internal Audit", isConfidential: true },
        data: { _id: "doc-t3-2", title: "Internal Audit", isConfidential: true },
      };

      (serverMgr as any).objects_["doc-t3-1"] = doc1;
      (serverMgr as any).objects_["doc-t3-2"] = doc2;

      const { clientSocket: auditorClient, serverSocket: auditorServer } = createMockSocketPair({
        handshakeAuth: { role: "auditor" },
      });
      const { clientSocket: publicClient, serverSocket: publicServer } = createMockSocketPair({
        handshakeAuth: { role: "public" },
      });

      serverMgr.registerSocket(auditorServer as any);
      serverMgr.registerSocket(publicServer as any);

      const auditorMgr = new AutoUpdateClientManager(
        SecuredDocumentClient as any,
        "SecuredDocumentClient",
        auditorClient as any,
        loggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      const publicMgr = new AutoUpdateClientManager(
        SecuredDocumentClient as any,
        "SecuredDocumentClient",
        publicClient as any,
        loggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      await auditorMgr.loadFromServer();
      await publicMgr.loadFromServer();

      // Auditor sees custom descriptors for all documents
      expect(auditorMgr.manifest).toEqual([
        { _id: "doc-t3-1", description: "Document: Annual Report" },
        { _id: "doc-t3-2", description: "Document: Internal Audit" },
      ]);

      // Public user sees descriptor only for public document
      expect(publicMgr.manifest).toEqual([
        { _id: "doc-t3-1", description: "Document: Annual Report" },
      ]);
    });

    it("triplet F08+F06+F14: combines lazy entity mutation, update channel, and error recovery", async () => {
      const { clientSocket, serverSocket } = createMockSocketPair();
      const mockServer: any = { use: jest.fn(), on: jest.fn(), emit: jest.fn() };
      const serverManagers: Record<string, any> = {};

      let simulateDbFailure = true;

      const serverMgr = new AutoUpdateServerManager(
        MutableTicketServer as any,
        "MutableTicketClient",
        mockServer,
        loggers,
        createMockModel(),
        serverManagers,
        emitter,
        { lazyLoading: true },
      );
      serverManagers["MutableTicketClient"] = serverMgr;

      const ticketServerObj: any = {
        _id: "ticket-t4-1",
        summary: "Bug report",
        priority: "LOW",
        extractedData: { _id: "ticket-t4-1", summary: "Bug report", priority: "LOW" },
        data: { _id: "ticket-t4-1", summary: "Bug report", priority: "LOW" },
        setValue: jest.fn().mockImplementation(async (key: string, val: unknown) => {
          if (simulateDbFailure) {
            return {
              success: false,
              code: DEMErrorCode.DB_SAVE_FAILED,
              msg: "Database write rejected",
            };
          }
          ticketServerObj.data[key] = val;
          ticketServerObj.extractedData[key] = val;
          return { success: true, msg: "Saved" };
        }),
      };

      (serverMgr as any).objects_["ticket-t4-1"] = ticketServerObj;
      serverMgr.registerSocket(serverSocket as any);

      const clientMgr = new AutoUpdateClientManager(
        MutableTicketClient as any,
        "MutableTicketClient",
        clientSocket as any,
        loggers,
        {},
        emitter,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        undefined,
        undefined,
        { enabled: true } as LazyLoadingOptions,
      );

      await clientMgr.loadFromServer();
      const stub = clientMgr.getObject("ticket-t4-1")!;
      expect(stub.isLazyStub).toBe(true);

      // Attempt mutation during database failure
      const failedResult = await stub.setValue("priority", "CRITICAL");
      expect(failedResult.success).toBe(false);
      expect(failedResult.code).toBe(DEMErrorCode.DB_SAVE_FAILED);

      // Verify stub remains uncorrupted
      expect(stub.priority).toBeUndefined();

      // Recover database and retry mutation
      simulateDbFailure = false;
      const successResult = await stub.setValue("priority", "CRITICAL");
      expect(successResult.success).toBe(true);
      expect(ticketServerObj.data["priority"]).toBe("CRITICAL");
    });
  });
});
