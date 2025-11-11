import { mongoose, prop } from "@typegoose/typegoose";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { classProp, classRef } from "./CommonTypes.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
console.log("Start");


const io = new SocketServer(new Server() , { cors: { origin: "*" } });

await mongoose.connect("mongodb://localhost:27017/GeoDB", { timeoutMS: 5000 });
enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

class Test {
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
  public ref?: Test | null;
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
            },
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
  io,
  new EventTarget()
);

console.log("CREATING OBJECT WITH active = true, status = INACTIVE");

const obj = await managers.Test.createObject({ active: true, status: Status.INACTIVE, description: null });

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
