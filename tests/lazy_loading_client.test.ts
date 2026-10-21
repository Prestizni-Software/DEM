import { jest } from "@jest/globals";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { classProp, populatedRef } from "../CommonTypes.js";
import { EventEmitter } from "eventemitter3";

class TestAuthorClient extends AutoUpdatedClientObject<TestAuthorClient> {
  @classProp
  public name!: string;

  public static override getDescriptor(data: Partial<TestAuthorClient>): string {
    return `Author: ${data.name ?? "Anonymous"}`;
  }
}

class TestBookClient extends AutoUpdatedClientObject<TestBookClient> {
  @classProp
  public title!: string;

  @populatedRef("TestAuthorClient")
  public author!: TestAuthorClient;

  public static override getDescriptor(data: Partial<TestBookClient>): string {
    return `Book: ${data.title ?? "Untitled"}`;
  }
}

describe("Client-Side Lazy Loading and On-Demand Hydration", () => {
  let emitter: EventEmitter;
  let mockSocket: any;
  let clientManagers: Record<string, any>;
  let bookManager: AutoUpdateClientManager<TestBookClient>;
  let authorManager: AutoUpdateClientManager<TestAuthorClient>;

  beforeEach(() => {
    emitter = new EventEmitter();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    clientManagers = {};

    bookManager = new AutoUpdateClientManager(
      TestBookClient as any,
      "TestBookClient",
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
      undefined,
      { lazyLoading: true },
    );

    authorManager = new AutoUpdateClientManager(
      TestAuthorClient as any,
      "TestAuthorClient",
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
      undefined,
      { lazyLoading: true },
    );

    clientManagers["TestBookClient"] = bookManager;
    clientManagers["TestAuthorClient"] = authorManager;
  });

  it("should process lazy startup manifest and create unhydrated stubs", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupTestBookClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            ids: ["60d5ec49f1b2c8b1f8e4e401", "60d5ec49f1b2c8b1f8e4e402"],
            manifest: [
              { _id: "60d5ec49f1b2c8b1f8e4e401", description: "Book: Book One" },
              { _id: "60d5ec49f1b2c8b1f8e4e402", description: "Book: Book Two" },
            ],
            properties: ["title", "author", "_id"],
          },
        });
      }
    });

    await bookManager.loadFromServer();

    expect(bookManager.isLoaded).toBe(true);
    expect(bookManager.manifest).toHaveLength(2);
    expect(bookManager.manifest[0]).toEqual({
      _id: "60d5ec49f1b2c8b1f8e4e401",
      description: "Book: Book One",
    });

    const stub = bookManager.getObject("60d5ec49f1b2c8b1f8e4e401");
    expect(stub).toBeDefined();
    expect(stub?.isLazyStub).toBe(true);
    expect(stub?.isLoaded).toBe(false);
    expect(stub?.descriptor).toBe("Book: Book One");
  });

  it("should hydrate lazy stub on loadObject call with related depth entities", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupTestBookClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            ids: ["60d5ec49f1b2c8b1f8e4e501"],
            manifest: [{ _id: "60d5ec49f1b2c8b1f8e4e501", description: "Book: DDD" }],
            properties: ["title", "author", "_id"],
          },
        });
      } else if (event === "getTestBookClient60d5ec49f1b2c8b1f8e4e501") {
        ack({
          success: true,
          data: {
            _id: "60d5ec49f1b2c8b1f8e4e501",
            title: "Domain-Driven Design",
            author: "60d5ec49f1b2c8b1f8e4e502",
          },
          related: {
            TestAuthorClient: [
              {
                _id: "60d5ec49f1b2c8b1f8e4e502",
                name: "Eric Evans",
              },
            ],
          },
        });
      }
    });

    await bookManager.loadFromServer();

    const stub = bookManager.getObject("60d5ec49f1b2c8b1f8e4e501")!;
    expect(stub.isLazyStub).toBe(true);
    expect(stub.descriptor).toBe("Book: DDD");

    const hydrated = await bookManager.loadObject("60d5ec49f1b2c8b1f8e4e501", { depth: 2 });
    expect(hydrated).toBe(stub);
    expect(hydrated.isLazyStub).toBe(false);
    expect(hydrated.title).toBe("Domain-Driven Design");
    expect(hydrated.descriptor).toBe("Book: DDD");

    const author = authorManager.getObject("60d5ec49f1b2c8b1f8e4e502");
    expect(author).toBeDefined();
    expect(author?.name).toBe("Eric Evans");

    // Test synchronous reference navigation
    expect(hydrated.author).toBeDefined();
    expect(hydrated.author.name).toBe("Eric Evans");
  });

  it("should allow ensureLoaded() on stub instance directly", async () => {
    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupTestBookClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            ids: ["60d5ec49f1b2c8b1f8e4e601"],
            manifest: [{ _id: "60d5ec49f1b2c8b1f8e4e601", description: "Book: Refactoring" }],
            properties: ["title", "author", "_id"],
          },
        });
      } else if (event === "getTestBookClient60d5ec49f1b2c8b1f8e4e601") {
        ack({
          success: true,
          data: {
            _id: "60d5ec49f1b2c8b1f8e4e601",
            title: "Refactoring",
          },
        });
      }
    });

    await bookManager.loadFromServer();
    const stub = bookManager.getObject("60d5ec49f1b2c8b1f8e4e601")!;
    expect(stub.isLazyStub).toBe(true);
    expect(stub.descriptor).toBe("Book: Refactoring");

    const loaded = await stub.ensureLoaded();
    expect(loaded.isLazyStub).toBe(false);
    expect(loaded.title).toBe("Refactoring");
    expect(loaded.descriptor).toBe("Book: Refactoring");
  });

  it("should set descriptor on lazy stub created via new broadcast", async () => {
    let newHandler: ((payload: any) => Promise<void>) | undefined;
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === "newTestBookClient") {
        newHandler = handler;
      }
    });

    mockSocket.emit.mockImplementation((event: string, payload: any, ack: Function) => {
      if (event === "startupTestBookClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            ids: [],
            manifest: [],
            properties: ["title", "author", "_id"],
          },
        });
      }
    });

    await bookManager.loadFromServer();
    expect(newHandler).toBeDefined();

    await newHandler!({
      _id: "60d5ec49f1b2c8b1f8e4e701",
      description: "Book: Clean Code",
    });

    const stub = bookManager.getObject("60d5ec49f1b2c8b1f8e4e701");
    expect(stub).toBeDefined();
    expect(stub?.isLazyStub).toBe(true);
    expect(stub?.descriptor).toBe("Book: Clean Code");
  });
});
