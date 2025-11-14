import { mongoose, prop, Ref as MeRef } from "@typegoose/typegoose";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { classProp, classRef, Ref , PathValueOf } from "./CommonTypes.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
console.log("Start");

type DeTypegooseRef<T> = T extends MeRef<infer U> ? Ref<U> : never

const server = new Server();
server.listen(3000);
const io = new SocketServer(server , { cors: { origin: "*" } });

await mongoose.connect("mongodb://localhost:27017/GeoDB", { timeoutMS: 5000 });
enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

type a = MeRef<Test> extends Ref<Test> ? true : false
type test = PathValueOf<Test, "ref.description">

type Objekt = {
  _id: string;
  obj: Objekt2
}

type Objekt2 = {
  _id: string;
}

export class Test {
  @classProp
  public _id!: string;

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
  public ref!: Ref<Test> | null;

  @classProp
  public obj!:Objekt
}

const managers = await AUSManagerFactory(
  {
    Test: {
      class: Test,
      options: {
        autoStatusDefinitions: createAutoStatusDefinitions(
          Test,
          {
            active: true,
          },
          "status",
          Status,
          {
            ACTIVE: {
              active: true,
            },
            INACTIVE: {
              active: false,
            }
          }
        ),
        accessDefinitions: {},
      },
    },
  },
  {
    info: (s: string) => console.log(s),
    warn: (s: string) => console.warn(s),
    error: (s: string) => console.error(s),
    debug: (s: string) => console.debug(s),
  },
  io
);
console.log("CREATING OBJECT WITH active = true, status = INACTIVE");

const obj = managers.Test.getObject("69159ff15e4f33ec695ce236")
const obj2 = managers.Test.getObject("6915b412a11536e6b4a70d9b")

if(!obj || !obj2)
  throw new Error("No obj")

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);

await obj.setValue("ref.ref.ref.obj.obj._id", "aaa");
await obj.setValue("obj.obj._id", "gay");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
