import { mongoose, prop, Ref as MeRef } from "@typegoose/typegoose";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { classProp, classRef, Ref , PathValueOf, IsData } from "./CommonTypes.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Status, Test } from "./TestTypes.js";
console.log("Start");

type DeTypegooseRef<T> = T extends MeRef<infer U> ? Ref<U> : never




type a = MeRef<Test> extends Ref<Test> ? true : false
type test = PathValueOf<Test, "ref.description">
const server = new Server();
server.listen(3000);
const io = new SocketServer(server , { cors: { origin: "*" } });

await mongoose.connect("mongodb://localhost:27017/GeoDB", { timeoutMS: 5000 });
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

type test2 = IsData<Test>

const obj = managers.Test.getObject("69159ff15e4f33ec695ce236")
const obj2 = managers.Test.getObject("6915b412a11536e6b4a70d9b")
const obj3 = managers.Test.createObject({})

if(!obj || !obj2)
  throw new Error("No obj")

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);

await obj.setValue("ref.ref.ref.obj.obj._id", 23);
await obj.setValue("obj.obj._id", "gay");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
