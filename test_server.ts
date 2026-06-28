import { Status } from "./TestTypes.js";
import { initServerManagers } from "./test_lib.js";

let { managers } = await initServerManagers();
console.log("CREATING OBJECT WITH active = true, status = INACTIVE");

const obj1 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj1",
  ref: null,
  refarr: [],
  parent: null,
  obj: {
    _id: "default",
    obj: { _id: "default" },
  },
});
managers = managers.Construction.objectsAsArray[0].parentManager.managers;
const x1 = obj1.extractedData;
managers.Construction.objectsAsArray[0].setValue("objects", [obj1._id]);
const obj2 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj2",
  ref: null,
  refarr: [],
  obj: null,
  parent: obj1,
});
await obj2.setValue("parent", null);
const x2 = [obj1, obj2._id, obj2._id.toString()];
const obj3 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj3",
  ref: obj1._id,
  refarr: [obj1._id, obj2],
  obj: null,
  parent: null,
});

if (!obj1 || !obj2) throw new Error("No obj");

await obj2.setValue("refarr", [obj1._id.toString()]);

await obj1.setValue("active", false);
await obj1.setValue("obj", { _id: "1", obj: { _id: "2" } });
await obj1.setValue("ref", obj2._id.toString());

const refarr = [...(obj1 as any).refarr];
refarr.splice(0, refarr.length);
refarr.push(obj2);
await obj1.setValue("refarr", refarr);
await obj1.setValue("active", false);
