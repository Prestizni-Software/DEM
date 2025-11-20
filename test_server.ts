import { mongoose, Ref, prop } from "@typegoose/typegoose";
import { PathValueOf, Paths } from "./CommonTypes_server.js";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Objekt, Status } from "./TestTypes.js";
import { ObjectId } from "bson";
import { classProp, classRef, IsData } from "./CommonTypes.js";


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
  public ref!: Ref<Test> | null;

  @prop({ required: false })
  @classProp
  public obj!:Objekt | null
}

console.log("Start");
const server = new Server();
server.listen(3000);
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
            if(obj.description) return;
            if (obj.active) return Status.ACTIVE;
            return Status.INACTIVE;
          }
        ),
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


const obj = managers.Test.getObject("69159ff15e4f33ec695ce236");
const obj2 = managers.Test.getObject("6915b412a11536e6b4a70d9b");


if (!obj || !obj2) throw new Error("No obj");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);
await obj.setValue("active", false);

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
