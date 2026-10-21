import { jest } from "@jest/globals";
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { classProp, populatedRef } from "../CommonTypes.js";
import { EventEmitter } from "eventemitter3";

// Class with self-contained raw snapshot properties (no populatedRef)
class ArchivedTaskServer extends AutoUpdatedServerObject<ArchivedTaskServer> {
  @classProp
  public title!: string;

  @classProp
  public authorId!: string;

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  public static override getDescriptor(data: Partial<ArchivedTaskServer>): string {
    return `Archived: ${data.title ?? "Untitled"}`;
  }
}

class ArchivedTaskClient extends AutoUpdatedClientObject<ArchivedTaskClient> {
  @classProp
  public title!: string;

  @classProp
  public authorId!: string;

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  public static override getDescriptor(data: Partial<ArchivedTaskClient>): string {
    return `Archived: ${data.title ?? "Untitled"}`;
  }
}

describe("End-to-End Lazy Loading, Real-Time Manifest Updates, and Self-Contained Entities", () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it("should broadcast descriptor on new entity creation to client manifest in lazy mode", async () => {
    // Simulated bidirectional socket pair
    const clientSocketEmitter = new EventEmitter();
    const serverSocketEmitter = new EventEmitter();

    const clientSocket: any = {
      on: (ev: string, fn: any) => clientSocketEmitter.on(ev, fn),
      off: (ev: string, fn: any) => clientSocketEmitter.off(ev, fn),
      emit: jest.fn(),
    };

    const serverClientSocket: any = {
      id: "socket_client_1",
      on: (ev: string, fn: any) => serverSocketEmitter.on(ev, fn),
      onAny: jest.fn(),
      emit: (ev: string, payload: any) => clientSocketEmitter.emit(ev, payload),
      eventNames: () => ["newArchivedTaskClient"],
    };

    const mockServer: any = {
      use: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockModel: any = {
      create: jest.fn(),
      findById: jest.fn(),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      schema: { path: jest.fn().mockReturnValue(true) },
    };

    const serverManagers: Record<string, any> = {};
    const serverManager = new AutoUpdateServerManager(
      ArchivedTaskServer as any,
      "ArchivedTaskClient",
      mockServer,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      mockModel,
      serverManagers,
      emitter as any,
      { lazyLoading: true },
    );
    serverManagers["ArchivedTaskClient"] = serverManager;
    serverManager.registerSocket(serverClientSocket);

    const clientManagers: Record<string, any> = {};
    const newCallback = jest.fn();
    const clientManager = new AutoUpdateClientManager(
      ArchivedTaskClient as any,
      "ArchivedTaskClient",
      clientSocket,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      clientManagers,
      emitter as any,
      {
        new: newCallback,
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
      },
      undefined,
      undefined,
      { lazyLoading: true },
    );
    clientManagers["ArchivedTaskClient"] = clientManager;

    // Simulate startup
    clientSocket.emit.mockImplementation((ev: string, payload: any, ack: Function) => {
      if (ev === "startupArchivedTaskClient") {
        ack({
          success: true,
          data: {
            status: "lazy",
            ids: [],
            manifest: [],
            properties: ["title", "authorId", "metadataSnapshot", "_id"],
          },
        });
      }
    });

    await clientManager.loadFromServer();
    expect(clientManager.manifest).toHaveLength(0);

    // Now server broadcasts a newly created entity
    const createdServerObj: any = {
      _id: "60d5ec49f1b2c8b1f8e4e901",
      extractedData: {
        _id: "60d5ec49f1b2c8b1f8e4e901",
        title: "Migrate legacy database",
        authorId: "user_123",
        metadataSnapshot: { completedAt: "2026-10-21", auditLogCount: 42 },
      },
      data: {
        _id: "60d5ec49f1b2c8b1f8e4e901",
        title: "Migrate legacy database",
        authorId: "user_123",
        metadataSnapshot: { completedAt: "2026-10-21", auditLogCount: 42 },
      },
    };

    serverClientSocket.emit(
      "newArchivedTaskClient",
      serverManager.getNewObjectPayload(createdServerObj),
    );

    // Wait for client event loop tick
    await new Promise((r) => setTimeout(r, 20));

    expect(clientManager.manifest).toHaveLength(1);
    expect(clientManager.manifest[0]).toEqual({
      _id: "60d5ec49f1b2c8b1f8e4e901",
      description: "Archived: Migrate legacy database",
    });

    const stub = clientManager.getObject("60d5ec49f1b2c8b1f8e4e901");
    expect(stub).toBeDefined();
    expect(stub?.isLazyStub).toBe(true);
    expect(stub?.descriptor).toBe("Archived: Migrate legacy database");
    expect(newCallback).toHaveBeenCalledWith(stub);
  });

  it("should directly return raw properties and nested objects without cross-manager resolution for self-contained entities", async () => {
    const rawData = {
      _id: "60d5ec49f1b2c8b1f8e4e902",
      title: "Completed inspection task",
      authorId: "admin_user_456",
      metadataSnapshot: {
        closedBy: "Supervisor",
        signatures: ["sign1", "sign2"],
        originalTaskData: { severity: "CRITICAL", resolved: true },
      },
    };

    const mockSocket: any = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };

    const taskObj = new ArchivedTaskClient(
      ArchivedTaskClient,
      mockSocket,
      rawData as any,
      { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      "ArchivedTaskClient",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      emitter as any,
    );
    taskObj.generateSettersAndGetters();

    expect(taskObj.title).toBe("Completed inspection task");
    expect(taskObj.authorId).toBe("admin_user_456");
    expect(taskObj.metadataSnapshot).toEqual({
      closedBy: "Supervisor",
      signatures: ["sign1", "sign2"],
      originalTaskData: { severity: "CRITICAL", resolved: true },
    });
  });
});
