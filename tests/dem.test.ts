import { initClientManagers, initServerManagers } from "./test_lib.js";
import mongoose from "mongoose";
import { getModelForClass } from "@typegoose/typegoose";
import { Status } from "../TestTypes.js";
import { Test, Test2 } from "../ServerTypes.js";

await mongoose.connect("mongodb://localhost:27017/GeoDB", {
  timeoutMS: 5000,
});
await getModelForClass(Test).deleteMany({});
await getModelForClass(Test2).deleteMany({});
const serverManagers = await initServerManagers();

afterAll(async () => {
  await mongoose.disconnect();
});

const testServerObject1 = await serverManagers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "TestObj1",
  ref: null,
  refarr: [],
  obj: {
    _id: "default",
    obj: { _id: "default" },
  },
  parent: null, // Should be TestObj2
});

const testServerObject2 = await serverManagers.Test.createObject({
  active: true,
  status: Status.ACTIVE,
  description: "TestObj2",
  ref: null,
  refarr: [testServerObject1._id],
  obj: {
    _id: "default",
    obj: { _id: "default" },
  },
  parent: null,
});

const testServerObject3 = await serverManagers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "TestObj3",
  ref: null,
  refarr: [],
  obj: {
    _id: "default",
    obj: { _id: "default" },
  },
  parent: testServerObject1._id,
});

const clientManagers1 = await initClientManagers("Client1");

const clientManagers2 = await initClientManagers("Client2");

const testClient1Object1 =
  clientManagers1.Test.objects[testServerObject1._id.toString()];

const testClient1Object2 =
  clientManagers1.Test.objects[testServerObject2._id.toString()];

const testClient1Object3 =
  clientManagers1.Test.objects[testServerObject3._id.toString()];

const testClient2Object1 =
  clientManagers2.Test.objects[testServerObject1._id.toString()];

const testClient2Object2 =
  clientManagers2.Test.objects[testServerObject2._id.toString()];

const testClient2Object3 =
  clientManagers2.Test.objects[testServerObject3._id.toString()];

describe("Server ", () => {
  test("Managers created", async () => {
    expect(serverManagers).toBeDefined();
    expect(clientManagers1).toBeDefined();
    expect(clientManagers2).toBeDefined();
  }, 1000);

  test("Default objects created", async () => {
    expect(serverManagers.Test.objectsAsArray.length).toBe(3);
    expect(serverManagers.Test2.objectsAsArray.length).toBe(0);
  }, 1000);

  test("Default object loaded", async () => {
    expect(clientManagers1.Test.objectsAsArray.length).toBe(3);
  }, 1000);

  test("Object created", async () => {
    expect(testServerObject1).toBeDefined();
    expect(testServerObject1._id).toBeDefined();
  }, 1000);

  test("Server object has correct values", async () => {
    expect(testServerObject1.active).toBe(true);
    expect(testServerObject1.description).toBe("TestObj1");
    expect(testServerObject1.ref).toBe(null);
    console.log(testServerObject1.obj);
    expect(JSON.stringify(testServerObject1.obj)).toBe(
      JSON.stringify({
        _id: "default",
        obj: { _id: "default" },
      })
    );
  }, 1000);

  test("Client object has correct values", async () => {
    expect(testClient1Object1.active).toBe(true);
    expect(testClient1Object1.description).toBe("TestObj1");
    expect(testClient1Object1.ref ?? null).toBe(null);
    console.log(testClient1Object1.obj);
    expect(JSON.stringify(testClient1Object1.obj)).toBe(
      JSON.stringify({
        _id: "default",
        obj: { _id: "default" },
      })
    );
    expect(testClient2Object1.active).toBe(true);
    expect(testClient2Object1.description).toBe("TestObj1");
    expect(testClient2Object1.ref ?? null).toBe(null);
    console.log(testClient2Object1.obj);
    expect(JSON.stringify(testClient2Object1.obj)).toBe(
      JSON.stringify({
        _id: "default",
        obj: { _id: "default" },
      })
    );
  }, 1000);

  test("Client2 redacted object not loaded", async () => {
    expect(testClient2Object3).toBeUndefined();
    expect(clientManagers2.Test.objectsAsArray.length).toBe(2);
  });

  test("Autostatus at creation - Client", async () => {
    expect(testServerObject1.status).toBe(Status.ACTIVE);
  }, 1000);

  test("Autostatus at creation - Client", async () => {
    expect(testClient1Object1.status).toBe(Status.ACTIVE);
    expect(testClient2Object1.status).toBe(Status.ACTIVE);
  }, 1000);

  test("Parent fill from parent after object already created", async () => {
    expect(testServerObject1.parent?.description).toBe(
      testServerObject2.description
    );
  }, 1000);

  test("Child reference added after created object with parent", async () => {
    expect(testServerObject1.refarr[0]?.description).toBe(
      testServerObject3.description
    );
  }, 1000);

  test("Setting shallow value", async () => {
    await testServerObject1.setValue("active", false);
    expect(testServerObject1.active).toBe(false);
  }, 1000);

  test("Autostatus on set value", async () => {
    expect(testServerObject1.status).toBe(Status.INACTIVE);
  }, 1000);

  test("Setting deep value", async () => {
    await testServerObject1.setValue("obj.obj._id", "3");
    expect(testServerObject1.obj?.obj?._id).toBe("3");
  }, 1000);

  test("Setting ref value", async () => {
    await testServerObject1.setValue("ref", testServerObject3._id);
    expect(testServerObject1.ref?.description).toBe(
      testServerObject3.description
    );
  }, 1000);

  test("Setting ref's value deep value", async () => {
    await testServerObject1.ref?.setValue("obj.obj._id", "4");
    expect(testServerObject3.obj?.obj?._id).toBe("4");
  }, 1000);

  test("Setting ref's shallow value", async () => {
    await testServerObject1.ref?.setValue("description", "Testing...");
    expect(testServerObject3.description).toBe("Testing...");
    await testServerObject3.setValue("description", "TestObj3");
  }, 1000);

  test("Setting ref's shallow value from parent", async () => {
    await testServerObject1.setValue_("ref.description", "get tested broski");
    expect(testServerObject3.description).toBe("get tested broski");
    await testServerObject3.setValue("description", "TestObj3");
  }, 1000);

  test("Setting ref's deep value from parent", async () => {
    await testServerObject1.setValue_("ref.obj._id", "gay");
    expect(testServerObject3.obj?._id).toBe("gay");
  }, 1000);

  test("Setting shallow value from client", async () => {
    await testClient1Object2.setValue("active", false);
    expect(testClient1Object2.active).toBe(false);
    expect(testServerObject2.active).toBe(false);
  }, 1000);

  test("Updating value at client from server", async () => {
    while (testClient2Object2.active) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(testClient2Object2.active).toBe(false);
  }, 1000);

  test("Autostatus on set value from client", async () => {
    expect(testClient1Object2.status).toBe(Status.INACTIVE);
    expect(testServerObject2.status).toBe(Status.INACTIVE);
    expect(testClient2Object2.status).toBe(Status.INACTIVE);
  }, 1000);

  test("Setting deep value from client", async () => {
    await testClient1Object2.setValue("obj.obj._id", "gayUwU69");
    expect(testClient1Object2.obj?.obj?._id).toBe("gayUwU69");
    expect(testServerObject2.obj?.obj?._id).toBe("gayUwU69");
    while (testClient2Object2.obj?.obj?._id !== "gayUwU69") {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(testClient2Object2.obj?.obj?._id).toBe("gayUwU69");
  }, 1000);

  test("Setting parent value from server", async () => {
    await testServerObject2.setValue_("parent", testServerObject2._id);
    expect(testServerObject2.parent?.description).toBe(
      testServerObject2.description
    );
    while (testClient2Object2.parent?.description !== "TestObj2") {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(testClient2Object2.parent?.description).toBe("TestObj2");
    while (testClient2Object2.parent?.description !== "TestObj2") {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(testClient2Object2.parent?.description).toBe("TestObj2");
  }, 1000);

  test("Setting parent value from client", async () => {
    await testClient1Object2.setValue("parent", testClient1Object3._id);
    expect(testClient1Object2.parent?.description).toBe(
      testClient1Object3.description
    );
    expect(testServerObject2.parent?.description).toBe(
      testServerObject3.description
    );
  }, 1000);

  test("Denied deletion from client", async () => {
    expect((await testClient2Object2.destroy()).success).toBe(false);
  }, 1000);

  test("Allowed deletion from server", async () => {
    expect((await testClient1Object2.destroy()).success).toBe(true);
  }, 1000);
  let newObjectId: string;
  test("Creation of new object from server", async () => {
    newObjectId = (
      await serverManagers.Test.createObject({
        description: "TestObj4",
        active: true,
        status: Status.INACTIVE,
        ref: null,
        refarr: [],
        obj: null,
        parent: null,
      })
    )._id.toString();
    expect(serverManagers.Test.getObject(newObjectId)?.description).toBe(
      "TestObj4"
    );
    while (
      clientManagers1.Test.getObject(newObjectId)?.description !== "TestObj4"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(clientManagers1.Test.getObject(newObjectId)?.description).toBe(
      "TestObj4"
    );
  }, 1000);

  test("Client2 not notified of object creation", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientManagers2.Test.getObject(newObjectId)).toBeUndefined();
    expect(clientManagers2.Test.objectsAsArray.length).toBe(2);
  });

  test("Creation of new object from client", async () => {
    newObjectId = (
      await clientManagers1.Test.createObject({
        description: "TestObj5",
        active: true,
        status: Status.INACTIVE,
        ref: null,
        refarr: [],
        obj: null,
        parent: null,
      })
    )._id.toString();
    expect(clientManagers1.Test.getObject(newObjectId)?.description).toBe(
      "TestObj5"
    );
    expect(serverManagers.Test.getObject(newObjectId)?.description).toBe(
      "TestObj5"
    );
    while (
      clientManagers2.Test.getObject(newObjectId)?.description !== "TestObj5"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(clientManagers2.Test.getObject(newObjectId)?.description).toBe(
      "TestObj5"
    );
  }, 1000);

  test("End", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 1000);
});
