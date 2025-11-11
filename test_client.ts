import { prop } from "@typegoose/typegoose";
import { classProp } from "./CommonTypes.js";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
console.log("Start");

const socket = io("http://localhost:3000");

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

const obj = await managers.Test.createObject({ active: true, status: Status.INACTIVE, description: null });

obj.setValue("description","a")

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
