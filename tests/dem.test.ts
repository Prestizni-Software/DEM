import { initServerManagers } from "./lib";
import mongoose from "mongoose";
import { getModelForClass } from "@typegoose/typegoose";
import { Test, Test2 } from "../test_server";
import { Status } from "../TestTypes";

beforeAll(async () => {
  await mongoose.connect("mongodb://localhost:27017/GeoDB", {
    timeoutMS: 5000,
  });
  await getModelForClass(Test).deleteMany({});
  await getModelForClass(Test2).deleteMany({});
});

const managers = await initServerManagers();

describe("Server", async () => {
  test("Managers created", async () => {
    expect(managers).toBeDefined();
  });

  test("No objects created", async () => {
    expect(managers.Test.objectsAsArray.length).toBe(0);
    expect(managers.Test2.objectsAsArray.length).toBe(0);
  });

  const testObject1 = await managers.Test.createObject({
    active: true,
    status: Status.INACTIVE,
    description: "TestObj1",
    ref: null,
    refarr: [],
    obj: {
      _id: "1",
      obj: { _id: "2" },
    },
    parent: null, // Should be TestObj2
  });

  const testObject2 = await managers.Test.createObject({
    active: true,
    status: Status.ACTIVE,
    description: "TestObj2",
    ref: null,
    refarr: [testObject1._id],
    obj: {
      _id: "1",
      obj: { _id: "2" },
    },
    parent: null,
  });

  const testObject3 = await managers.Test.createObject({
    active: true,
    status: Status.INACTIVE,
    description: "TestObj1",
    ref: null,
    refarr: [],
    obj: {
      _id: "1",
      obj: { _id: "2" },
    },
    parent: testObject2._id,
  });

  describe("Creating Objects", async () => {
    test("Object created", async () => {
      expect(testObject1).toBeDefined();
      expect(testObject1._id).toBeDefined();
    });

    test("Object has correct values", async () => {
      expect(testObject1.active).toBe(true);
      expect(testObject1.description).toBe("TestObj1");
      expect(testObject1.ref).toBe(null);
      expect(testObject1.refarr.length).toBe(0);
      expect(testObject1.obj).toBe({
        _id: "1",
        obj: { _id: "2" },
      });
      expect(testObject1.parent).toBe(null);
    });

    test("Autostatus on creation", async () => {
      expect(testObject1.status).toBe(Status.ACTIVE);
    });

    test("Parents at creation", async () => {
        expect(testObject1.parent?.description).toBe("TestObj2");
        expect(testObject3.parent?.description).toBe("TestObj2");
        expect(testObject2.refarr.length).toBe(2);
        expect(testObject2.parent).toBe(null);
        expect(testObject2.refarr.includes(testObject1._id)).toBe(true);
        expect(testObject2.refarr.includes(testObject3._id)).toBe(true);
    })
  });
});
