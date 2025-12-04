import { Status } from "./TestTypes.js";
import { initServerManagers } from "./tests/test_lib.js";

const managers = await initServerManagers();
console.log("CREATING OBJECT WITH active = true, status = INACTIVE");

for (const obj of managers.Test.objectsAsArray) {
  await obj.destroy();
}

const obj1 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj1",
  ref: null,
  refarr: [],
  obj: null,
  parent: null,
});

const obj2 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj2",
  ref: null,
  refarr: [],
  obj: null,
  parent: obj1._id,
});

const obj3 = await managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "Obj3",
  ref: null,
  refarr: [],
  obj: null,
  parent: null,
});

if (!obj1 || !obj2) throw new Error("No obj");
await obj2.setValue_("parent", obj2);

await obj2.setValue_("refarr", [obj1._id]);

await obj1.setValue_("active", true);
await obj1.setValue_("active", false);
await obj1.setValue_("obj", { _id: "1", obj: { _id: "2" } });
await obj1.setValue_("obj._id", "gay");
await obj1.setValue_("ref", obj2._id);
await obj1.setValue_("ref.description", obj2._id.toString());

const refarr = obj1.refarr;
refarr.splice(0, refarr.length);
refarr.push(obj2 as any);
await obj1.setValue_(
  "refarr",
  refarr
);
await obj1.setValue_("active", false);
