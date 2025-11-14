import { prop } from "@typegoose/typegoose";
import { classProp } from "./CommonTypes.js";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
import { Test } from "./TestTypes.js";
console.log("Start");

const socket = io("http://localhost:3000");

enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}


const managers = await AUCManagerFactory(
  {
    Test,
  },
  {
    debug: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
  },
  socket
);

console.log("CREATING OBJECT WITH active = true, status = INACTIVE");

const obj = managers.Test.getObject("6915b55f11d9579cc670502f");
const obj2 = managers.Test.getObject("691702d91a05cb761dfc66f4");

if(!obj || !obj2)
  throw new Error("No obj")

await obj.setValue("ref.obj.obj._id", "gay2")

console.log(obj.ref?.obj?.obj._id);