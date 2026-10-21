import { jest } from "@jest/globals";
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { classProp, populatedRef } from "../CommonTypes.js";
import { EventEmitter } from "eventemitter3";

class MockAuthor extends AutoUpdatedServerObject<MockAuthor> {
  @classProp
  public name!: string;

  public static override getDescriptor(data: Partial<MockAuthor>): string {
    return `Author: ${data.name ?? "Anonymous"}`;
  }
}

class MockBook extends AutoUpdatedServerObject<MockBook> {
  @classProp
  public title!: string;

  @populatedRef("MockAuthor")
  public author!: any;

  public static override getDescriptor(data: Partial<MockBook>): string {
    return `Book: ${data.title ?? "Untitled"}`;
  }
}

class CircularA extends AutoUpdatedServerObject<CircularA> {
  @classProp
  public name!: string;

  @populatedRef("CircularB")
  public b!: any;
}

class CircularB extends AutoUpdatedServerObject<CircularB> {
  @classProp
  public name!: string;

  @populatedRef("CircularA")
  public a!: any;
}

describe("Server-Side Lazy Loading and Graph Traversal", () => {
  let emitter: EventEmitter;
  let mockSocketServer: any;

  beforeEach(() => {
    emitter = new EventEmitter();
    mockSocketServer = {
      use: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };
  });

  it("should generate manifest with descriptors on lazy startup", async () => {
    const mockModel: any = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const managers: Record<string, any> = {};
    const bookManager = new AutoUpdateServerManager(
      MockBook as any,
      "MockBook",
      mockSocketServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      managers,
      emitter as any,
      { lazyLoading: true },
    );
    managers["MockBook"] = bookManager;

    const book1: any = {
      _id: "60d5ec49f1b2c8b1f8e4e101",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e101", title: "Domain Driven Design" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e101", title: "Domain Driven Design" },
    };
    const book2: any = {
      _id: "60d5ec49f1b2c8b1f8e4e102",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e102", title: "Clean Architecture" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e102", title: "Clean Architecture" },
    };

    (bookManager as any).objects_ = {
      "60d5ec49f1b2c8b1f8e4e101": book1,
      "60d5ec49f1b2c8b1f8e4e102": book2,
    };

    expect(bookManager.isLazyLoadingEnabled).toBe(true);

    const manifest = (bookManager as any).generateManifest([book1, book2]);
    expect(manifest).toHaveLength(2);
    expect(manifest[0]).toEqual({
      _id: "60d5ec49f1b2c8b1f8e4e101",
      description: "Book: Domain Driven Design",
    });
    expect(manifest[1]).toEqual({
      _id: "60d5ec49f1b2c8b1f8e4e102",
      description: "Book: Clean Architecture",
    });
  });

  it("should traverse reference graph up to depth 2 without circular loops", () => {
    const mockModel: any = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const managers: Record<string, any> = {};

    const aManager = new AutoUpdateServerManager(
      CircularA as any,
      "CircularA",
      mockSocketServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      managers,
      emitter as any,
      { lazyLoading: true },
    );
    const bManager = new AutoUpdateServerManager(
      CircularB as any,
      "CircularB",
      mockSocketServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      managers,
      emitter as any,
      { lazyLoading: true },
    );

    managers["CircularA"] = aManager;
    managers["CircularB"] = bManager;

    const objA: any = {
      _id: "60d5ec49f1b2c8b1f8e4e201",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e201", name: "Node A", b: "60d5ec49f1b2c8b1f8e4e202" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e201", name: "Node A", b: "60d5ec49f1b2c8b1f8e4e202" },
    };
    const objB: any = {
      _id: "60d5ec49f1b2c8b1f8e4e202",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e202", name: "Node B", a: "60d5ec49f1b2c8b1f8e4e201" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e202", name: "Node B", a: "60d5ec49f1b2c8b1f8e4e201" },
    };

    (aManager as any).objects_ = { "60d5ec49f1b2c8b1f8e4e201": objA };
    (bManager as any).objects_ = { "60d5ec49f1b2c8b1f8e4e202": objB };

    const related = aManager.collectEntityGraph(objA, 2);
    expect(related["CircularB"]).toBeDefined();
    expect(related["CircularB"]).toHaveLength(1);
    expect(related["CircularB"][0]._id).toBe("60d5ec49f1b2c8b1f8e4e202");
  });

  it("should respond with related entities on EVENT_GET when depth is specified", async () => {
    const mockModel: any = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const managers: Record<string, any> = {};
    const authorManager = new AutoUpdateServerManager(
      MockAuthor as any,
      "MockAuthor",
      mockSocketServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      managers,
      emitter as any,
      { lazyLoading: true },
    );
    const bookManager = new AutoUpdateServerManager(
      MockBook as any,
      "MockBook",
      mockSocketServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      managers,
      emitter as any,
      { lazyLoading: true },
    );

    managers["MockAuthor"] = authorManager;
    managers["MockBook"] = bookManager;

    const author: any = {
      _id: "60d5ec49f1b2c8b1f8e4e301",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e301", name: "Eric Evans" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e301", name: "Eric Evans" },
    };
    const book: any = {
      _id: "60d5ec49f1b2c8b1f8e4e302",
      extractedData: { _id: "60d5ec49f1b2c8b1f8e4e302", title: "Domain-Driven Design", author: "60d5ec49f1b2c8b1f8e4e301" },
      data: { _id: "60d5ec49f1b2c8b1f8e4e302", title: "Domain-Driven Design", author: "60d5ec49f1b2c8b1f8e4e301" },
    };

    (authorManager as any).objects_ = { "60d5ec49f1b2c8b1f8e4e301": author };
    (bookManager as any).objects_ = { "60d5ec49f1b2c8b1f8e4e302": book };

    let onAnyCallback: any;
    const mockSocket: any = {
      on: jest.fn(),
      onAny: jest.fn((cb) => {
        onAnyCallback = cb;
      }),
    };

    bookManager.registerSocket(mockSocket);
    expect(onAnyCallback).toBeDefined();

    const ack = jest.fn();
    await onAnyCallback("getMockBook60d5ec49f1b2c8b1f8e4e302", { depth: 1 }, ack);

    expect(ack).toHaveBeenCalled();
    const response = ack.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.data.title).toBe("Domain-Driven Design");
    expect(response.related).toBeDefined();
    expect(response.related["MockAuthor"]).toHaveLength(1);
    expect(response.related["MockAuthor"][0].name).toBe("Eric Evans");
  });
});
