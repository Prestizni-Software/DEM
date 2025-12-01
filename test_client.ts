import { io } from "socket.io-client";
import {
  AUCManagerFactory,
  AutoUpdated,
} from "./AutoUpdateClientManagerClass.js";
import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
console.log("Start");

const socket = io("http://localhost:3001", {
  auth: {
    token: "test",
  },
});
export class ClientTest {
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
  public ref!: AutoUpdated<typeof ClientTest> | null;

  @classProp
  @classRef()
  public refarr!: AutoUpdated<typeof ClientTest>[];

  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  public parent!: AutoUpdated<typeof ClientTest> | null;
}

export class ClientTest2 {
  @classProp
  public _id!: string;
}

const managers = await AUCManagerFactory(
  {
    ClientTest: ClientTest,
    ClientTest2: ClientTest2,
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

const obj = managers.ClientTest.objectsAsArray[0];
const obj2 = managers.ClientTest.objectsAsArray[1];

if (!obj || !obj2) throw new Error("No obj");
await obj.parent?.parent?.parent?.setValue("active", true);
console.log(obj.ref?.obj?.obj._id);
await obj.setValue("active", false);
await obj.setValue("active", true);

await obj.destroy();
managers.ClientTest.createObject({
  active: true,
  status: Status.INACTIVE,
  description: "ObjClient",
  ref: null,
  refarr: [],
  obj: null,
  parent: null,
});
