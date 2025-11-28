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
import { logger } from "@typegoose/typegoose/lib/logSettings.js";

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

  @classProp @populatedRef("Test:refarr")
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
        accessDefinitions: async (event, managers, token) => {
            logger.debug("Access with token: " + token);
            return true;
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

for(const obj of managers.Test.objectsAsArray){
  await obj.destroy();
}

const obj1 = await managers.Test.createObject({
  active: true, status: Status.INACTIVE,
  description: "Obj1",
  ref: null,
  refarr: [],
  obj: null,
  parent: null
});

const obj2 = await managers.Test.createObject({
  active: true, status: Status.INACTIVE,
  description: "Obj2",
  ref: null,
  refarr: [],
  obj: null,
  parent: null
});

const obj3 = await managers.Test.createObject({
  active: true, status: Status.INACTIVE,
  description: "Obj3",
  ref: null,
  refarr: [],
  obj: null,
  parent: null
});

if (!obj1 || !obj2) throw new Error("No obj");
await obj2.setValue_("parent", obj3);

await obj2.setValue_("refarr", [obj1._id]);

console.log(obj1.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj1.setValue_("active", true);
await obj1.setValue_("active", false);

await obj1.setValue_("ref", obj2._id);

const refarr = obj1.refarr;
refarr.splice(0, refarr.length);
refarr.push(obj2._id);
await obj1.setValue_("refarr", refarr.map((r) => r._id));
const test = await obj1.parent?.parent?.setValue_("active", true);
const testik = obj1.ref;

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj1.setValue_("active", false);
console.log(obj1.status);
