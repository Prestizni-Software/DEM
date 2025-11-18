import { prop } from "@typegoose/typegoose";
import { classProp, classRef, Paths } from "./CommonTypes.js";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
import { Objekt } from "./TestTypes.js";
console.log("Start");

const socket = io("http://localhost:3000");

enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export class Test {
  @classProp
  public _id!: string | ObjectId;

  @prop({ required: true })
  @classProp
  public active!: boolean;

  @prop({ required: true })
  @classProp
  public status!: Status;

  @prop({ required: false })
  @classProp
  public description!: string | null;

  @prop({ required: false })
  @classProp @classRef("Test")
  public ref!: Test | null;

  @prop({ required: false })
  @classProp
  public obj!:Objekt | null
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