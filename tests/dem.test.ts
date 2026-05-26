import { initClientManagers, initServerManagers } from "../test_lib.js";
import mongoose from "mongoose";
import { getModelForClass } from "@typegoose/typegoose";
import * as ServerClasses from "./testData/ServerClasses/index.js";
import { SubordinateType } from "./testData/types.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { classProp, classRef } from "../CommonTypes.js";
import { io } from "socket.io-client";
import '@jest/globals'
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";

// Connect to DB
await mongoose.connect("mongodb://localhost:27017/GeoDB", {
  timeoutMS: 5000,
});

// Clear DB
await getModelForClass(ServerClasses.Subordinate).deleteMany({});
await getModelForClass(ServerClasses.Company).deleteMany({});

const { managers: serverManagers, io: serverIo, server } = await initServerManagers();

afterAll(async () => {
  await mongoose.disconnect();
  for (const manager of Object.values(serverManagers)) (manager as any).close();
  serverIo.close();
  server.close();
});

// Create some data
const testServerObject1 = await serverManagers.Subordinate.createObject({
  name: "Sub1",
  login: "sub1_login",
  phone: "123",
  type: SubordinateType.GEODET,
  company: [],
  onSite: null,
});

const testServerObject2 = await serverManagers.Subordinate.createObject({
  name: "Sub2",
  login: "sub2_login",
  phone: "456",
  type: SubordinateType.OFFICE_RAT,
  company: [],
  onSite: null,
});

// Secret object to test redacted loading
const testServerObject3 = await serverManagers.Subordinate.createObject({
  name: "Secret",
  login: "secret_login",
  phone: "000",
  type: SubordinateType.ADMIN,
  company: [],
  onSite: null,
});

const { managers: clientManagers1, socket: socket1 } = await initClientManagers("Client1");
const { managers: clientManagers2, socket: socket2 } = await initClientManagers("Client2");

afterAll(async () => {
  for (const manager of Object.values(clientManagers1)) (manager as any).close();
  for (const manager of Object.values(clientManagers2)) (manager as any).close();
  socket1.close();
  socket2.close();
});

const getClient1Sub = (id: any) => clientManagers1.Subordinate.objects[id.toString()];
const getClient2Sub = (id: any) => clientManagers2.Subordinate.objects[id.toString()];

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
    while (getClient1Sub(testServerObject1._id).phone !== "999") {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient1Sub(testServerObject1._id).phone).toBe("999");
  });

  test("Setting value from client", async () => {
    const c1o2 = getClient1Sub(testServerObject2._id);
    await c1o2.setValue("phone", "888");
    expect(testServerObject2.phone).toBe("888");

    while (getClient2Sub(testServerObject2._id).phone !== "888") {
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
    const c1o2 = getClient1Sub(testServerObject2._id);
    const res = await c1o2.destroy();
    expect(res.success).toBe(true);
    expect(serverManagers.Subordinate.getObject(testServerObject2._id?.toString())).toBeUndefined();
    
    while (getClient2Sub(testServerObject2._id)) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient2Sub(testServerObject2._id)).toBeUndefined();
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
    
    while (!getClient2Sub(newObj._id)) {
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
    // Actually onSite is Construction ref in Subordinate.ts, let's use company array or add construction
    // Wait, Subordinate.ts has `onSite: Construction` and `company: Company[]`.
    
    // Let's create a Construction too
    const construction = await serverManagers.Construction.createObject({
        name: "Const1",
        objects: [],
    });
    
    await testServerObject1.setValue("onSite", construction._id);
    expect(testServerObject1.onSite?._id.toString()).toBe(construction._id.toString());
    
    while (!getClient1Sub(testServerObject1._id).onSite) {
        await new Promise(r => setTimeout(r, 10));
    }
    expect(getClient1Sub(testServerObject1._id).onSite?._id.toString()).toBe(construction._id.toString());
  });
});
