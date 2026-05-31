import { initClientManagers, initServerManagers } from "../test_lib.js";
import mongoose from "mongoose";
import { getModelForClass } from "@typegoose/typegoose";
import * as ServerClasses from "./testData/ServerClasses/index.js";
import { SubordinateType } from "./testData/types.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { classProp, classRef } from "../CommonTypes.js";
import { io } from "socket.io-client";
import { jest } from '@jest/globals'
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";

// Increase Jest timeout for this file
jest.setTimeout(60000);

let serverManagers: any;
let serverIo: any;
let server: any;
let clientManagers1: any;
let socket1: any;
let clientManagers2: any;
let socket2: any;

let testServerObject1: any;
let testServerObject2: any;
let testServerObject3: any;

beforeAll(async () => {
    // Connect to DB if needed
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect("mongodb://localhost:27017/GeoDB", {
          serverSelectionTimeoutMS: 5000,
        });
    }

    // Clear DB
    const classesToClear = [
        ServerClasses.Subordinate,
        ServerClasses.Company,
        ServerClasses.Construction,
        ServerClasses.Comments,
        ServerClasses.MeasurementTask,
        ServerClasses.Protocol,
        ServerClasses.ProtocolTask,
        ServerClasses.MeasurementType
    ];

    for (const cls of classesToClear) {
        try {
            await getModelForClass(cls as any).deleteMany({});
        } catch (e) {}
    }

    const init = await initServerManagers();
    serverManagers = init.managers;
    serverIo = init.io;
    server = init.server;

    // Create some data
    testServerObject1 = await serverManagers.Subordinate.createObject({
      name: "Sub1",
      login: "sub1_login",
      phone: "123",
      type: SubordinateType.GEODET,
      company: [],
      onSite: null,
    });

    testServerObject2 = await serverManagers.Subordinate.createObject({
      name: "Sub2",
      login: "sub2_login",
      phone: "456",
      type: SubordinateType.OFFICE_RAT,
      company: [],
      onSite: null,
    });

    // Secret object to test redacted loading
    testServerObject3 = await serverManagers.Subordinate.createObject({
      name: "Secret",
      login: "secret_login",
      phone: "000",
      type: SubordinateType.ADMIN,
      company: [],
      onSite: null,
    });

    const c1 = await initClientManagers("Client1");
    clientManagers1 = c1.managers;
    socket1 = c1.socket;

    const c2 = await initClientManagers("Client2");
    clientManagers2 = c2.managers;
    socket2 = c2.socket;
});

afterAll(async () => {
  if (clientManagers1) for (const manager of Object.values(clientManagers1)) (manager as any).close();
  if (clientManagers2) for (const manager of Object.values(clientManagers2)) (manager as any).close();
  if (socket1) socket1.close();
  if (socket2) socket2.close();

  if (serverManagers) for (const manager of Object.values(serverManagers)) (manager as any).close();
  if (serverIo) serverIo.close();
  if (server) server.close();
  await mongoose.disconnect();
});

const getClient1Sub = (id: any) => clientManagers1?.Subordinate.objects[id.toString()];
const getClient2Sub = (id: any) => clientManagers2?.Subordinate.objects[id.toString()];

describe("DEM Library Tests with New Data Structure", () => {
  test("Managers created", async () => {
    expect(serverManagers).toBeDefined();
    expect(clientManagers1).toBeDefined();
    expect(clientManagers2).toBeDefined();
  });

  test("Default objects created", async () => {
    expect(serverManagers.Subordinate.objectsAsArray.length).toBe(3);
    expect(serverManagers.Company.objectsAsArray.length).toBe(0);
  });

  test("Default objects loaded on Client1", async () => {
    // Client1 should see all 3 (Secret included)
    expect(clientManagers1.Subordinate.objectsAsArray.length).toBe(3);
  });

  test("Client2 redacted object not loaded", async () => {
    // Client2 should NOT see "Secret" (filtered in startupMiddleware in test_lib.ts)
    expect(clientManagers2.Subordinate.objectsAsArray.length).toBe(2);
    expect(getClient2Sub(testServerObject3._id)).toBeUndefined();
  });

  test("Server object has correct values", async () => {
    expect(testServerObject1.name).toBe("Sub1");
    expect(testServerObject1.login).toBe("sub1_login");
  });

  test("Client object has correct values", async () => {
    const c1o1 = getClient1Sub(testServerObject1._id);
    expect(c1o1.name).toBe("Sub1");
    expect(c1o1.login).toBe("sub1_login");

    const c2o1 = getClient2Sub(testServerObject1._id);
    expect(c2o1.name).toBe("Sub1");
    expect(c2o1.login).toBe("sub1_login");
  });

  test("Setting shallow value from server", async () => {
    await testServerObject1.setValue("phone", "999");
    expect(testServerObject1.phone).toBe("999");

    // Wait for sync
    const start = Date.now();
    while (getClient1Sub(testServerObject1._id).phone !== "999" && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient1Sub(testServerObject1._id).phone).toBe("999");
  });

  test("Setting value from client", async () => {
    const c1o2 = getClient1Sub(testServerObject2._id);
    await c1o2.setValue("phone", "888");
    expect(testServerObject2.phone).toBe("888");

    const start = Date.now();
    while (getClient2Sub(testServerObject2._id).phone !== "888" && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient2Sub(testServerObject2._id).phone).toBe("888");
  });

  test("Denied deletion from client (Client2)", async () => {
    const c2o1 = getClient2Sub(testServerObject1._id);
    const res = await c2o1.destroy();
    expect(res.success).toBe(false);
    expect(serverManagers.Subordinate.getObject(testServerObject1._id?.toString())).toBeDefined();
  });

  test("Allowed deletion from client (Client1)", async () => {
    const id = testServerObject2._id.toString();
    const c1o2 = getClient1Sub(testServerObject2._id);
    const res = await c1o2.destroy();
    expect(res.success).toBe(true);
    expect(serverManagers.Subordinate.getObject(id)).toBeUndefined();
    
    const start = Date.now();
    while (getClient2Sub(id) && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient2Sub(id)).toBeUndefined();
  });

  test("Creation of new object from client", async () => {
    const newObj = await clientManagers1.Subordinate.createObject({
        name: "NewSub",
        login: "new_login",
        phone: "777",
        type: SubordinateType.GEODET,
        company: [],
        onSite: null,
    });
    expect(newObj._id).toBeDefined();
    expect(serverManagers.Subordinate.getObject(newObj._id.toString())).toBeDefined();
    
    const start = Date.now();
    while (!getClient2Sub(newObj._id) && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient2Sub(newObj._id).name).toBe("NewSub");
  });

  test("Reference testing", async () => {
    const company = await serverManagers.Company.createObject({
        fullName: "Test Company",
        abbr: "TC",
    });
    
    await testServerObject1.setValue("onSite", undefined); // Reset
    
    // Let's create a Construction too
    const construction = await serverManagers.Construction.createObject({
        name: "Const1",
        objects: [],
    });
    
    await testServerObject1.setValue("onSite", construction._id);
    expect(testServerObject1.onSite?._id.toString()).toBe(construction._id.toString());
    
    const start = Date.now();
    while (!getClient1Sub(testServerObject1._id).onSite && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient1Sub(testServerObject1._id).onSite?._id.toString()).toBe(construction._id.toString());
  });

  test("AUCManagerFactory should only resolve after ALL managers are fully initialized with real data", async () => {
    const c3 = await initClientManagers("Client3");
    const managers = c3.managers;
    const socket = c3.socket;

    try {
        // Since Subordinates are created in beforeAll, they should be loaded immediately
        expect(managers.Subordinate.isLoaded).toBe(true);
        expect(managers.Subordinate.objectsAsArray.length).toBeGreaterThan(0);
        
        // Verify another manager that should be empty but loaded
        expect(managers.Company.isLoaded).toBe(true);
        expect(managers.Company.objectsAsArray.length).toBeGreaterThan(0);
    } finally {
        for (const manager of Object.values(managers)) (manager as any).close();
        socket.close();
    }
  });
});
