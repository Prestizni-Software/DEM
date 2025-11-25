import { mongoose, Ref, prop } from "@typegoose/typegoose";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Types } from "mongoose";

export class Test {
  @classProp
  public _id!: Types.ObjectId;

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
  @classProp @classRef()
  public ref!: Ref<Test> | null;

  @prop({ required: true, default: [] })
  @classProp @classRef()
  public refarr!: Ref<Test>[];

  @prop({ required: false })
  @classProp
  public obj!: Objekt | null;

  @classProp @populatedRef("Test")
  public parent!: Ref<Test> | null;
}

console.log("Start");
const server = new Server();
server.listen(3001);
const io = new SocketServer(server, { cors: { origin: "*" } });

await mongoose.connect("mongodb://localhost:27017/GeoDB", { timeoutMS: 5000 });
const managers = await AUSManagerFactory(
  {
    Test: {
      class: Test,
      options: {
        autoStatusDefinitions: createAutoStatusDefinitions(
          Test,
          "status",
          Status,
          async (obj) => {
            if (obj.description) return;
            if (obj.active) return Status.ACTIVE;
            return Status.INACTIVE;
          }
        ),
        accessDefinitions:{
          login: async (token: string) => true,
          access: async (data, managers, userId) => {
            return false;
          }
        }
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

/*for(const obj of managers.Test.objectsAsArray){
  await obj.destroy();
}*/

const obj = managers.Test.getObject("69258c5082673d1b24da2d1f")

const obj2 = managers.Test.getObject("69258c5082673d1b24da2d21")

if (!obj || !obj2) throw new Error("No obj");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue_("active", true);
await obj.setValue_("active", false);

await obj.setValue_("ref", obj2._id);

const refarr = obj.refarr;
refarr.splice(0, 0);
refarr.push(obj2._id);
await obj.setValue_("refarr", refarr.map((r) => r._id));
const test = await obj.parent?.parent?.setValue_("active", true);
const testik = obj.ref;

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue_("active", false);
console.log(obj.status);
