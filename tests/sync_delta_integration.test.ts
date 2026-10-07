import { jest } from '@jest/globals';
import { createServer } from "http";
import { Server } from "socket.io";
import { io as ClientSocket, Socket as ClientSocketType } from "socket.io-client";
import mongoose from "mongoose";
import { prop } from "@typegoose/typegoose";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AUSManagerFactory } from "../AutoUpdateServerManagerClass.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { classProp, globalCache } from "../CommonTypes.js";
import { MemoryStorageAdapter } from "../sync/storage/MemoryStorageAdapter.js";

// Test Models
class SyncCompanyServer extends AutoUpdatedServerObject<SyncCompanyServer> {
  @classProp
  public _id!: mongoose.Types.ObjectId;

  @prop({ required: true, type: () => String })
  @classProp
  public name!: string;

  @prop({ required: false, type: () => Number, default: 0 })
  @classProp
  public employees!: number;
}

class SyncCompanyClient extends AutoUpdatedClientObject<SyncCompanyClient> {
  @classProp
  public _id!: string;

  @classProp
  public name!: string;

  @classProp
  public employees!: number;
}

class SyncPrunedServer extends AutoUpdatedServerObject<SyncPrunedServer> {
  @classProp
  public _id!: mongoose.Types.ObjectId;

  @prop({ required: true, type: () => String })
  @classProp
  public label!: string;
}

class SyncPrunedClient extends AutoUpdatedClientObject<SyncPrunedClient> {
  @classProp
  public _id!: string;

  @classProp
  public label!: string;
}

describe("DEM Delta Synchronization Integration Tests", () => {
  let httpServer: any;
  let ioServer: Server;
  let serverPort: number;
  let serverManagers: any;
  const noopLoggers = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  };

  beforeAll(async () => {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dem_sync_test";
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
  });

  beforeEach(async () => {
    globalCache.clear();
    try {
      await mongoose.connection.collection("synccompanyservers").drop();
    } catch {}
    try {
      await mongoose.connection.collection("syncprunedservers").drop();
    } catch {}

    httpServer = createServer();
    ioServer = new Server(httpServer, {
      cors: { origin: "*" },
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as any).port;
        resolve();
      });
    });

    serverManagers = await AUSManagerFactory(
      {
        SyncCompany: {
          class: SyncCompanyServer,
          options: {
            deltaSync: {
              maxAgeMs: 60000,
              maxSizeBytes: 1024 * 1024,
            },
          },
        },
        SyncPruned: {
          class: SyncPrunedServer,
          options: {
            deltaSync: {
              maxSizeBytes: 100, // Small byte limit to force pruning
            },
          },
        },
      },
      noopLoggers,
      ioServer,
      false,
    );
  });

  afterEach(async () => {
    ioServer.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      ioServer.close(() => {
        httpServer.close(() => resolve());
      });
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  function createClientSocket(): ClientSocketType {
    return ClientSocket(`http://127.0.0.1:${serverPort}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
  }

  test("1. Initial Full Sync saves state and revision to client storage adapter", async () => {
    const c1 = await serverManagers.SyncCompany.createObject({ name: "Alpha Corp", employees: 10 });
    const c2 = await serverManagers.SyncCompany.createObject({ name: "Beta LLC", employees: 25 });

    const clientSocket = createClientSocket();
    const storage = new MemoryStorageAdapter();

    const clientManagers = await AUCManagerFactory(
      { SyncCompany: SyncCompanyClient },
      noopLoggers,
      clientSocket,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    const clientManager = clientManagers.SyncCompany;
    expect(clientManager.objectsAsArray.length).toBe(2);
    expect(clientManager.lastRevision).toBe(2);

    const stored = await storage.loadManagerState("SyncCompany");
    expect(stored).toBeDefined();
    expect(stored?.revision).toBe(2);
    expect(stored?.ids).toContain(c1._id.toString());
    expect(stored?.ids).toContain(c2._id.toString());

    clientSocket.disconnect();
  });

  test("2. Reconnection with NO changes returns up-to-date with 0 object recreation", async () => {
    const c1 = await serverManagers.SyncCompany.createObject({ name: "Alpha Corp", employees: 10 });

    const clientSocket1 = createClientSocket();
    const storage = new MemoryStorageAdapter();

    const clientManagers1 = await AUCManagerFactory(
      { SyncCompany: SyncCompanyClient },
      noopLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );
    expect(clientManagers1.SyncCompany.objectsAsArray.length).toBe(1);
    expect(clientManagers1.SyncCompany.lastRevision).toBe(1);

    clientSocket1.disconnect();

    const clientSocket2 = createClientSocket();
    const clientManagers2 = await AUCManagerFactory(
      { SyncCompany: SyncCompanyClient },
      noopLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    expect(clientManagers2.SyncCompany.objectsAsArray.length).toBe(1);
    expect(clientManagers2.SyncCompany.lastRevision).toBe(1);
    expect(clientManagers2.SyncCompany.getObject(c1._id.toString())?.name).toBe("Alpha Corp");

    clientSocket2.disconnect();
  });

  test("3. Reconnection with DELTA changes applies creates, updates, and deletes seamlessly", async () => {
    const c1 = await serverManagers.SyncCompany.createObject({ name: "Alpha Corp", employees: 10 });
    const c2 = await serverManagers.SyncCompany.createObject({ name: "Beta LLC", employees: 20 });

    const clientSocket1 = createClientSocket();
    const storage = new MemoryStorageAdapter();

    const clientManagers1 = await AUCManagerFactory(
      { SyncCompany: SyncCompanyClient },
      noopLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );
    expect(clientManagers1.SyncCompany.lastRevision).toBe(2);

    clientSocket1.disconnect();

    const c2Id = c2._id.toString();
    // Mutations while offline:
    await c1.setValue("name", "Alpha Corp Global");
    await c1.setValue("employees", 15);
    await serverManagers.SyncCompany.deleteObject(c2._id);
    const c3 = await serverManagers.SyncCompany.createObject({ name: "Gamma Inc", employees: 50 });

    expect(serverManagers.SyncCompany.changeTracker.getCurrentRevision()).toBe(6);

    const newCallback = jest.fn();
    const updateCallback = jest.fn();
    const deleteCallback = jest.fn();

    const clientSocket2 = createClientSocket();
    const clientManagers2 = await AUCManagerFactory(
      { SyncCompany: SyncCompanyClient },
      noopLoggers,
      clientSocket2,
      false,
      undefined,
      {
        SyncCompany: {
          new: newCallback,
          update: updateCallback,
          delete: deleteCallback,
        },
      },
      undefined,
      { storage },
    );

    const clientManager = clientManagers2.SyncCompany;
    expect(clientManager.lastRevision).toBe(6);
    expect(clientManager.objectsAsArray.length).toBe(2);

    const clientC1 = clientManager.getObject(c1._id.toString());
    expect(clientC1).toBeDefined();
    expect(clientC1?.name).toBe("Alpha Corp Global");
    expect(clientC1?.employees).toBe(15);
    expect(updateCallback).toHaveBeenCalled();

    const clientC2 = clientManager.getObject(c2Id);
    expect(clientC2).toBeUndefined();
    expect(deleteCallback).toHaveBeenCalled();

    const clientC3 = clientManager.getObject(c3._id.toString());
    expect(clientC3).toBeDefined();
    expect(clientC3?.name).toBe("Gamma Inc");
    expect(newCallback).toHaveBeenCalled();

    clientSocket2.disconnect();
  });

  test("4. Expired revision triggers full sync fallback safely", async () => {
    const p1 = await serverManagers.SyncPruned.createObject({ label: "Initial Label" });

    const clientSocket1 = createClientSocket();
    const storage = new MemoryStorageAdapter();

    const clientManagers1 = await AUCManagerFactory(
      { SyncPruned: SyncPrunedClient },
      noopLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );
    expect(clientManagers1.SyncPruned.lastRevision).toBe(1);
    clientSocket1.disconnect();

    // Create many objects to exceed 100 bytes limit and prune rev 1
    for (let i = 2; i <= 15; i++) {
      await serverManagers.SyncPruned.createObject({ label: `Label ${i}` });
    }

    expect(serverManagers.SyncPruned.changeTracker.getLowestRetainedRevision()).toBeGreaterThan(1);

    const clientSocket2 = createClientSocket();
    const clientManagers2 = await AUCManagerFactory(
      { SyncPruned: SyncPrunedClient },
      noopLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    expect(clientManagers2.SyncPruned.objectsAsArray.length).toBe(15);
    expect(clientManagers2.SyncPruned.lastRevision).toBe(15);

    clientSocket2.disconnect();
  });
});
