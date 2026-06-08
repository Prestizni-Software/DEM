import {  Pure } from "./CommonTypes.js";
import { initClientManagers } from "./test_lib.js";
import { Company } from "./tests/testData/ClientClasses/Company";

const { managers } = await initClientManagers("test"+Math.random().toString(36).substring(7));


const obj: Company = managers.Company.objectsAsArray[0];
const obj2: Company = managers.Company.objectsAsArray[1];

if (obj) {
    managers.Company.getObject(obj._id);
    obj.getValue("fullName")
}

type y = Pure<Company>;


if (!obj || !obj2) {
    console.log("No objects found");
} else {
    await obj.setValue("fullName", "New Company Name");
    console.log(obj.fullName);
    await obj2.setValue("fullName", obj.fullName);
    await obj.setValue("fullName", "Another Name");
    await obj.destroy();
}

managers.Company.createObject({
  fullName: "New Company",
  abbr: "NC",
});
