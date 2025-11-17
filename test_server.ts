import { mongoose, Ref as MeRef } from "@typegoose/typegoose";
import { Ref, PathValueOf, IsData, Paths, DeRef, ResolveRef } from "./CommonTypes.js";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Status, Test } from "./TestTypes.js";
import { ObjectId } from "bson";
console.log("Start");
type a = MeRef<Test> extends Ref<Test> ? true : false;
type test4 = DeRef<Ref<Test>>;
type testt = Ref<Test>
type test7 = DeRef<Test>
type test5 = test4 extends { _id: string | ObjectId } ? true : false;
type test3 = Paths<Test>;
type test6 = "ref._id" extends Paths<Test> ? true : false;
type test2 = IsData<Test>;
type test = PathValueOf<Test, "ref.ref.obj">;
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
  io
);
console.log("CREATING OBJECT WITH active = true, status = INACTIVE");


const obj = managers.Test.getObject("69159ff15e4f33ec695ce236");
const obj2 = managers.Test.getObject("6915b412a11536e6b4a70d9b");


if (!obj || !obj2) throw new Error("No obj");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO TRUE");
await obj.setValue("active", true);
await obj.setValue("ref","a")
await obj.setValue("ref.ref.obj.obj._id", 23);
await obj.setValue("obj.obj._id", "gay");

console.log(obj.status);

console.log("UPDATING ACTIVE STATUS TO FALSE");
await obj.setValue("active", false);

console.log(obj.status);
