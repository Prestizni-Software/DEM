import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef } from "./CommonTypes.js";
import { Paths } from "./CommonTypes.js";
console.log("Start");

const socket = io("http://localhost:3000");

export class Test {
  @classProp
  public _id!: string;

  @classProp
  public active!: boolean;

  @classProp
  public status!: Status;

  @classProp
  public description!: string | null;

  @classProp @classRef("Test")
  public ref!: Test | null;

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
type test = Paths<Test>
await obj.setValue("ref.obj.obj._id", "23")


console.log(obj.ref?.obj?.obj._id);