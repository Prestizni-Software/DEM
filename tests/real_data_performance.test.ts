import { jest } from "@jest/globals";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { EJSON } from "bson";
import { getModelForClass } from "@typegoose/typegoose";
import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "node:http";
import { io as socketIOClient } from "socket.io-client";

import * as ServerClasses from "./testData/ServerClasses/index.js";
import * as ClientClasses from "./testData/ClientClasses/index.js";
import { AUSManagerFactory } from "../AutoUpdateServerManagerClass.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { LoggersType, globalCache } from "../CommonTypes.js";

// Allow ample timeout for full real database ingestion
jest.setTimeout(120000);

describe("Real Production Data Performance Benchmark", () => {
  const DB_URI = "mongodb://localhost:27017/GeoDB_Perf_RealData";
  const PORT = 3099;
  let httpServer: HttpServer;
  let serverIo: SocketServer;
  let serverManagers: any;
  let clientSocket: any;
  let clientManagers: any;

  const dataMapping: Record<string, { serverCls: any; clientCls: any; file: string }> = {
    Company: {
      serverCls: ServerClasses.Company,
      clientCls: ClientClasses.Company,
      file: "companies(4).json",
    },
    Construction: {
      serverCls: ServerClasses.Construction,
      clientCls: ClientClasses.Construction,
      file: "constructions(4).json",
    },
    ConstructionObject: {
      serverCls: ServerClasses.ConstructionObject,
      clientCls: ClientClasses.ConstructionObject,
      file: "constructionobjects(6).json",
    },
    Subordinate: {
      serverCls: ServerClasses.Subordinate,
      clientCls: ClientClasses.Subordinate,
      file: "subordinates(5).json",
    },
    Attachment: {
      serverCls: ServerClasses.Attachment,
      clientCls: ClientClasses.Attachment,
      file: "attachments(1).json",
    },
    Comments: {
      serverCls: ServerClasses.Comments,
      clientCls: ClientClasses.Comments,
      file: "comments(1).json",
    },
    Element: {
      serverCls: ServerClasses.Element,
      clientCls: ClientClasses.Element,
      file: "elements(2).json",
    },
    MeasurementType: {
      serverCls: ServerClasses.MeasurementType,
      clientCls: ClientClasses.MeasurementType,
      file: "measurementtypes(5).json",
    },
    MeasurementTask: {
      serverCls: ServerClasses.MeasurementTask,
      clientCls: ClientClasses.MeasurementTask,
      file: "measurementtasks(3).json",
    },
    Protocol: {
      serverCls: ServerClasses.Protocol,
      clientCls: ClientClasses.Protocol,
      file: "protocols(3).json",
    },
    ProtocolTask: {
      serverCls: ServerClasses.ProtocolTask,
      clientCls: ClientClasses.ProtocolTask,
      file: "protocoltasks(3).json",
    },
  };

  const silentLoggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: (msg) => console.error("BENCHMARK ERROR:", msg),
    warn: () => {},
  };

  beforeAll(async () => {
    // 1. Connect Mongoose to separate performance test database
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(DB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    // 2. Populate DB from performance/data JSON files
    const dataDir = path.resolve("performance", "data");
    for (const [name, { serverCls, file }] of Object.entries(dataMapping)) {
      const filePath = path.join(dataDir, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`Data file not found: ${filePath}`);
        continue;
      }
      const model = getModelForClass(serverCls);
      await model.deleteMany({});
      const rawContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(rawContent) && rawContent.length > 0) {
        const deserialized = EJSON.deserialize(rawContent);
        await model.insertMany(deserialized, { ordered: false });
      }
    }
  });

  afterAll(async () => {
    if (clientManagers) {
      for (const m of Object.values(clientManagers)) {
        (m as any)?.close?.();
      }
    }
    if (clientSocket) clientSocket.close();
    if (serverIo) serverIo.close();
    if (httpServer) httpServer.close();
    await mongoose.disconnect();
  });

  test("Server AUSManagerFactory initializes & pre-loads real production dataset", async () => {
    httpServer = new HttpServer();
    await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
    serverIo = new SocketServer(httpServer, { cors: { origin: "*" } });

    const serverDefs: any = {};
    for (const [name, { serverCls }] of Object.entries(dataMapping)) {
      serverDefs[name] = { class: serverCls };
    }

    const serverStartTime = Date.now();
    serverManagers = await AUSManagerFactory(
      serverDefs,
      silentLoggers,
      serverIo,
      false,
    );
    const serverDuration = Date.now() - serverStartTime;
    console.log(`\n>>> Server AUSManagerFactory Real Data Initialization Time: ${serverDuration}ms`);

    let totalServerObjects = 0;
    for (const [name, mgr] of Object.entries(serverManagers)) {
      const count = (mgr as any).objectsAsArray.length;
      totalServerObjects += count;
      console.log(`    - ${name}: ${count} objects loaded in memory`);
    }
    console.log(`    Total Server In-Memory Objects: ${totalServerObjects}\n`);
    expect(totalServerObjects).toBeGreaterThan(8000);
  });

  test("Client AUCManagerFactory full startup ingestion loads all classes rapidly", async () => {
    clientSocket = socketIOClient(`http://localhost:${PORT}`, {
      auth: { token: "PerfClient" },
      reconnection: false,
    });

    const clientDefs: any = {};
    for (const [name, { clientCls }] of Object.entries(dataMapping)) {
      clientDefs[name] = clientCls;
    }

    globalCache.clear();
    const clientStartTime = Date.now();
    clientManagers = await AUCManagerFactory(
      clientDefs,
      silentLoggers,
      clientSocket,
      false,
    );
    const clientDuration = Date.now() - clientStartTime;
    console.log(`\n======================================================`);
    console.log(`>>> Client AUCManagerFactory Real Data Load Time: ${clientDuration}ms`);
    console.log(`    (Baseline legacy load time was ~18,000ms)`);
    console.log(`======================================================\n`);

    let totalClientObjects = 0;
    for (const [name, mgr] of Object.entries(clientManagers)) {
      const count = (mgr as any).objectsAsArray.length;
      totalClientObjects += count;
    }
    expect(totalClientObjects).toBeGreaterThan(8000);

    // Target: Significantly faster than the 18,000ms baseline (well under 2,000ms)
    expect(clientDuration).toBeLessThan(5000);
  });
});
