import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { Test } from "./ClientTypes.js";
import { Paths } from "./CommonTypes.js";
import { Status } from "./TestTypes.js";
import { initClientManagers } from "./test_lib.js";


const managers = await initClientManagers("test"+Math.random().toString(36).substring(7));


const obj = managers.Test.objectsAsArray[0];
const obj2 = managers.Test.objectsAsArray[1];
managers.Test.getObject(obj._id);

if (!obj || !obj2) throw new Error("No obj");
await obj.parent?.parent?.parent?.setValue("active", true);
console.log(obj.ref?.obj?.obj._id);
await obj2.setValue(
  "parent", obj2._id);
await obj.setValue("active", false);
await obj.setValue("active", true);

await obj.destroy();
managers.Test.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "ObjClient",
  ref: null,
  refarr: [],
  obj: null,
  parent: null,
});
obj2.extractedData
type x = keyof AutoUpdatedClientObject<any>