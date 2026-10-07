import { jest } from "@jest/globals";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { getModelForClass } from "@typegoose/typegoose";
import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "node:http";
import { io as socketIOClient } from "socket.io-client";

import * as ServerClasses from "./testData/ServerClasses/index.js";
import * as ClientClasses from "./testData/ClientClasses/index.js";
import { AUSManagerFactory } from "../AutoUpdateServerManagerClass.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { LoggersType, globalCache, Constructor, IAutoUpdatedClientObjectBase } from "../CommonTypes.js";
import {
  MemoryStorageAdapter,
  LocalStorageAdapter,
  IndexedDbStorageAdapter,
} from "../sync/index.js";

jest.setTimeout(240000);

function createMockIDBFactory(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, any>>>();
  return {
    open(dbName: string, _version: number) {
      if (!dbs.has(dbName)) {
        dbs.set(dbName, new Map());
      }
      const stores = dbs.get(dbName)!;
      const req: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        const db: any = {
          objectStoreNames: {
            contains(name: string) {
              return stores.has(name);
            },
          },
          createObjectStore(name: string, _opts?: any) {
            if (!stores.has(name)) {
              stores.set(name, new Map());
            }
            return {};
          },
          transaction(storeName: string, _mode: string) {
            const storeMap = stores.get(storeName) ?? new Map();
            stores.set(storeName, storeMap);
            return {
              objectStore(_name: string) {
                return {
                  put(val: any) {
                    const putReq: any = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      const key = val.className || val._id || "default";
                      storeMap.set(key, JSON.parse(JSON.stringify(val)));
                      putReq.onsuccess?.();
                    }, 0);
                    return putReq;
                  },
                  get(key: string) {
                    const getReq: any = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => {
                      const data = storeMap.get(key);
                      getReq.result = data ? JSON.parse(JSON.stringify(data)) : undefined;
                      getReq.onsuccess?.();
                    }, 0);
                    return getReq;
                  },
                  delete(key: string) {
                    const delReq: any = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      storeMap.delete(key);
                      delReq.onsuccess?.();
                    }, 0);
                    return delReq;
                  },
                  clear() {
                    const clrReq: any = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      storeMap.clear();
                      clrReq.onsuccess?.();
                    }, 0);
                    return clrReq;
                  },
                };
              },
            };
          },
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  } as unknown as IDBFactory;
}

function processMongoJSON(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(processMongoJSON);
  } else if (obj !== null && typeof obj === "object") {
    if (obj.$oid) {
      return new mongoose.Types.ObjectId(obj.$oid);
    } else if (obj.$date) {
      return new Date(obj.$date);
    }
    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      newObj[key] = processMongoJSON(value);
    }
    return newObj;
  }
  return obj;
}

describe("DEM Real Production Data Delta Sync & Stress Benchmarks (8500+ Objects)", () => {
  const DB_URI = "mongodb://localhost:27017/GeoDB_Sync_Stress_RealData";
  let httpServer: HttpServer;
  let serverIo: SocketServer;
  let serverPort: number;
  let serverManagers: any;

  const fileMapping: Record<string, string> = {
    Company: "companies.json",
    Construction: "constructions.json",
    ConstructionObject: "constructionobjects.json",
    Subordinate: "subordinates.json",
    Attachment: "attachments.json",
    Comments: "comments.json",
    Element: "elements.json",
    MeasurementType: "measurementtypes.json",
    MeasurementTask: "measurementtasks.json",
    Protocol: "protocols.json",
    ProtocolTask: "protocoltasks.json",
  };

  const silentLoggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: (msg) => console.error("SYNC BENCHMARK ERROR:", msg),
    warn: () => {},
  };

  function createClientSocket(): any {
    return socketIOClient(`http://127.0.0.1:${serverPort}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
  }

  function getClientDefs(): Record<string, Constructor<IAutoUpdatedClientObjectBase>> {
    const defs: Record<string, Constructor<IAutoUpdatedClientObjectBase>> = {};
    for (const [name, cls] of Object.entries(ClientClasses)) {
      if (
        typeof cls === "function" &&
        cls.prototype instanceof (ClientClasses as any).AutoUpdatedClientObject
      ) {
        defs[name] = cls as Constructor<IAutoUpdatedClientObjectBase>;
      }
    }
    return defs;
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(DB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    const dataDir = path.join(process.cwd(), "tests", "testData");
    let initialCount = 0;
    const loadedData: Record<string, any[]> = {};

    for (const [name, fileName] of Object.entries(fileMapping)) {
      const cls = (ServerClasses as any)[name];
      if (!cls) continue;
      const filePath = path.join(dataDir, fileName);
      const model = getModelForClass(cls);
      await model.deleteMany({});
      if (fs.existsSync(filePath)) {
        const rawContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const processed = processMongoJSON(rawContent);
        loadedData[name] = processed;
        initialCount += processed.length;
        if (processed.length > 0) {
          await model.insertMany(processed, { ordered: false });
        }
      }
    }

    // Scale dataset to 8500+ objects by cloning valid schema records
    const targetTotal = 8600;
    const cloneClasses = [
      "Comments",
      "ProtocolTask",
      "MeasurementTask",
      "Protocol",
      "Attachment",
      "ConstructionObject",
    ];

    while (initialCount < targetTotal) {
      const remaining = targetTotal - initialCount;
      for (const name of cloneClasses) {
        const cls = (ServerClasses as any)[name];
        const baseItems = loadedData[name];
        if (!baseItems || baseItems.length === 0 || !cls) continue;
        const model = getModelForClass(cls);
        const batchSize = Math.min(baseItems.length, Math.ceil(remaining / cloneClasses.length));
        const clonedBatch = baseItems.slice(0, batchSize).map((item) => {
          const copy = JSON.parse(JSON.stringify(item));
          copy._id = new mongoose.Types.ObjectId();
          if (copy.whenCreated) copy.whenCreated = new Date();
          if (copy.lastEdited) copy.lastEdited = new Date();
          return copy;
        });
        await model.insertMany(clonedBatch, { ordered: false });
        initialCount += clonedBatch.length;
      }
    }

    httpServer = new HttpServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as any).port;
        resolve();
      });
    });
    serverIo = new SocketServer(httpServer, { cors: { origin: "*" } });

    const serverDefs: any = {};
    for (const [name, cls] of Object.entries(ServerClasses)) {
      if (
        typeof cls === "function" &&
        cls.prototype instanceof (ServerClasses as any).AutoUpdatedServerObject
      ) {
        serverDefs[name] = {
          class: cls,
          options: {
            deltaSync: {
              maxSizeBytes: 50 * 1024 * 1024, // 50MB
              maxAgeMs: 24 * 60 * 60 * 1000,   // 24 hours
            },
          },
        };
      }
    }

    serverManagers = await AUSManagerFactory(
      serverDefs,
      silentLoggers,
      serverIo,
      false,
    );

    let totalServerObjects = 0;
    for (const [name, mgr] of Object.entries(serverManagers)) {
      const count = (mgr as any).objectsAsArray.length;
      totalServerObjects += count;
    }
    expect(totalServerObjects).toBeGreaterThan(8500);
  });

  afterAll(async () => {
    if (serverManagers) {
      for (const m of Object.values(serverManagers)) {
        (m as any).close?.();
      }
    }
    if (serverIo) serverIo.disconnectSockets(true);
    if (serverIo) serverIo.close();
    if (httpServer) httpServer.close();
    await mongoose.disconnect();
  });

  test("1. Real Data Delta Sync with MemoryStorageAdapter (8500+ objects)", async () => {
    const storage = new MemoryStorageAdapter();
    const clientDefs = getClientDefs();

    // Step A: Initial full sync
    const clientSocket1 = createClientSocket();
    globalCache.clear();
    const clientManagers1 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    let totalClient1 = 0;
    for (const mgr of Object.values(clientManagers1)) {
      totalClient1 += (mgr as any).objectsAsArray.length;
    }
    expect(totalClient1).toBeGreaterThan(8500);
    for (const m of Object.values(clientManagers1)) (m as any).close?.();
    clientSocket1.disconnect();

    // Step B: Mutate objects on server while client is offline
    const companies = serverManagers.Company.objectsAsArray;
    const testCompany = companies[0];
    const originalFullName = testCompany.fullName;
    const updatedFullName = originalFullName + " [DeltaSync Test]";
    await testCompany.setValue("fullName", updatedFullName);

    // Step C: Reconnect client with same MemoryStorageAdapter
    const clientSocket2 = createClientSocket();
    globalCache.clear();
    const clientManagers2 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    const clientCompany = clientManagers2.Company.getObject(testCompany._id.toString());
    expect(clientCompany).toBeDefined();
    expect(clientCompany?.fullName).toBe(updatedFullName);

    let totalClient2 = 0;
    for (const mgr of Object.values(clientManagers2)) {
      totalClient2 += (mgr as any).objectsAsArray.length;
    }
    expect(totalClient2).toBe(totalClient1);

    // Revert modification
    await testCompany.setValue("fullName", originalFullName);
    for (const m of Object.values(clientManagers2)) (m as any).close?.();
    clientSocket2.disconnect();
  });

  test("2. Real Data Delta Sync with LocalStorageAdapter", async () => {
    const localStore = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => localStore.set(k, v),
      removeItem: (k: string) => localStore.delete(k),
      clear: () => localStore.clear(),
      get length() {
        return localStore.size;
      },
      key: (i: number) => Array.from(localStore.keys())[i] ?? null,
    };

    const storage = new LocalStorageAdapter({ storage: mockLocalStorage });
    const clientDefs = getClientDefs();

    // Step A: Initial full sync
    const clientSocket1 = createClientSocket();
    globalCache.clear();
    const clientManagers1 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    let totalClient1 = 0;
    for (const mgr of Object.values(clientManagers1)) {
      totalClient1 += (mgr as any).objectsAsArray.length;
    }
    expect(totalClient1).toBeGreaterThan(8500);
    expect(localStore.size).toBeGreaterThan(0);
    for (const m of Object.values(clientManagers1)) (m as any).close?.();
    clientSocket1.disconnect();

    // Step B: Mutate Construction on server
    const constructions = serverManagers.Construction.objectsAsArray;
    const testConstruction = constructions[0];
    const originalConstructionName = testConstruction.name;
    const updatedConstructionName = originalConstructionName + " [LocalStorage Delta]";
    await testConstruction.setValue("name", updatedConstructionName);

    // Step C: Reconnect client with same LocalStorageAdapter
    const clientSocket2 = createClientSocket();
    globalCache.clear();
    const clientManagers2 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    const clientConstruction = clientManagers2.Construction.getObject(testConstruction._id.toString());
    expect(clientConstruction).toBeDefined();
    expect(clientConstruction?.name).toBe(updatedConstructionName);

    // Revert
    await testConstruction.setValue("name", originalConstructionName);
    for (const m of Object.values(clientManagers2)) (m as any).close?.();
    clientSocket2.disconnect();
  });

  test("3. Real Data Delta Sync with IndexedDbStorageAdapter", async () => {
    const mockIdbFactory = createMockIDBFactory();
    const storage = new IndexedDbStorageAdapter({ idbFactory: mockIdbFactory });
    const clientDefs = getClientDefs();

    // Step A: Initial full sync
    const clientSocket1 = createClientSocket();
    globalCache.clear();
    const clientManagers1 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    let totalClient1 = 0;
    for (const mgr of Object.values(clientManagers1)) {
      totalClient1 += (mgr as any).objectsAsArray.length;
    }
    expect(totalClient1).toBeGreaterThan(8500);
    for (const m of Object.values(clientManagers1)) (m as any).close?.();
    clientSocket1.disconnect();

    // Step B: Mutate Protocol on server
    const protocols = serverManagers.Protocol.objectsAsArray;
    const testProtocol = protocols[0];
    const originalProtocolNumber = testProtocol.protocolNumber;
    const updatedProtocolNumber = (originalProtocolNumber || 100) + 999;
    await testProtocol.setValue("protocolNumber", updatedProtocolNumber);

    // Step C: Reconnect client with IndexedDbStorageAdapter
    const clientSocket2 = createClientSocket();
    globalCache.clear();
    const clientManagers2 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    const clientProtocol = clientManagers2.Protocol.getObject(testProtocol._id.toString());
    expect(clientProtocol).toBeDefined();
    expect(clientProtocol?.protocolNumber).toBe(updatedProtocolNumber);

    // Revert
    await testProtocol.setValue("protocolNumber", originalProtocolNumber);
    for (const m of Object.values(clientManagers2)) (m as any).close?.();
    clientSocket2.disconnect();
  });

  test("4. Stress Test: 5 Rounds of Rapid Disconnects, Server Mutations & Reconnections", async () => {
    const storage = new MemoryStorageAdapter();
    const clientDefs = getClientDefs();

    // Initial connection
    let clientSocket = createClientSocket();
    globalCache.clear();
    let clientManagers = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    for (let round = 1; round <= 5; round++) {
      for (const m of Object.values(clientManagers)) (m as any).close?.();
      clientSocket.disconnect();

      // Perform mutations across multiple classes while offline
      const company = serverManagers.Company.objectsAsArray[round % serverManagers.Company.objectsAsArray.length];
      await company.setValue("fullName", `Stress Company Round ${round}`);

      const construction = serverManagers.Construction.objectsAsArray[round % serverManagers.Construction.objectsAsArray.length];
      await construction.setValue("name", `Stress Construction Round ${round}`);

      // Reconnect
      clientSocket = createClientSocket();
      globalCache.clear();
      clientManagers = await AUCManagerFactory(
        clientDefs,
        silentLoggers,
        clientSocket,
        false,
        undefined,
        {},
        undefined,
        { storage },
      );

      // Verify state matches server
      const clientCompany = clientManagers.Company.getObject(company._id.toString());
      expect(clientCompany?.fullName).toBe(`Stress Company Round ${round}`);

      const clientConstruction = clientManagers.Construction.getObject(construction._id.toString());
      expect(clientConstruction?.name).toBe(`Stress Construction Round ${round}`);
    }

    for (const m of Object.values(clientManagers)) (m as any).close?.();
    clientSocket.disconnect();
  });

  test("5. Dynamic Limits Adjustment Mid-Run: Changing MB and TTL Limits Forces Clean Full-Sync Fallback", async () => {
    const storage = new MemoryStorageAdapter();
    const clientDefs = getClientDefs();

    // Initial connection
    const clientSocket1 = createClientSocket();
    globalCache.clear();
    const clientManagers1 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket1,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    const initialCompanyRev = clientManagers1.Company.lastRevision;
    for (const m of Object.values(clientManagers1)) (m as any).close?.();
    clientSocket1.disconnect();

    // Perform multiple server mutations
    const company = serverManagers.Company.objectsAsArray[0];
    for (let i = 1; i <= 5; i++) {
      await company.setValue("fullName", `Dynamic Limit Step ${i}`);
    }

    // Dynamically change MB limit to tiny 1 byte and TTL to 1ms mid-run
    serverManagers.Company.changeTracker.updateOptions({
      maxSizeBytes: 1, // 1 byte limit
      maxAgeMs: 1,     // 1 ms TTL
    });

    // Wait 5ms for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 5));
    serverManagers.Company.changeTracker.prune();

    // Client reconnects with old revision
    const clientSocket2 = createClientSocket();
    globalCache.clear();
    const clientManagers2 = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket2,
      false,
      undefined,
      {},
      undefined,
      { storage },
    );

    // Client must have safely fallen back to full sync and received latest state
    const clientCompany = clientManagers2.Company.getObject(company._id.toString());
    expect(clientCompany).toBeDefined();
    expect(clientCompany?.fullName).toBe("Dynamic Limit Step 5");
    expect(clientManagers2.Company.lastRevision).toBeGreaterThan(initialCompanyRev);

    // Reset limits for Company tracker
    serverManagers.Company.changeTracker.updateOptions({
      maxSizeBytes: 50 * 1024 * 1024,
      maxAgeMs: 24 * 3600 * 1000,
    });

    for (const m of Object.values(clientManagers2)) (m as any).close?.();
    clientSocket2.disconnect();
  });
});
