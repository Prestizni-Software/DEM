import { io } from "socket.io-client";
import { AUCManagerFactory, AutoUpdated } from "./AutoUpdateClientManagerClass.js";
import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
console.log("Start");

const socket = io("http://localhost:3001", {
  auth: {
    token: "test",
  },
});

export class Test {
  @classProp
  public _id!: string;

  @classProp
  public active!: boolean;

  @classProp
  public status!: Status;

  @classProp
  public description!: string | null;

  @classProp
  @classRef()
  public ref!:AutoUpdated< typeof Test> | null;

  @classProp
  @classRef()
  public refarr!:AutoUpdated< typeof Test>[];

  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test")
  public parent!:AutoUpdated< typeof Test> | null;
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

const obj = managers.Test.objectsAsArray[0];
const obj2 = managers.Test.objectsAsArray[1];

if (!obj || !obj2) throw new Error("No obj");
await obj.setValue("ref.obj.obj._id", "23");
await obj.parent?.parent?.parent?.setValue("active", true);
console.log(obj.ref?.obj?.obj._id);
