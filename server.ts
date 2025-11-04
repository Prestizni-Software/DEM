import { createServer } from "node:http";
import { Server } from "socket.io";
import mongoose, { Types } from "mongoose";
import { getModelForClass, prop, Ref } from "@typegoose/typegoose";
import readline from "node:readline";
import { LoggersType, classProp, classRef } from "./CommonTypes.js";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "./AutoUpdateServerManagerClass.js";

// ---------------------- Data Models ----------------------

enum Statuses {
  Status1 = "Status1",
  Status2 = "Banana",
}
class Test2 {
  @classProp public _id!: Types.ObjectId;
  @classProp public login!: string;
  @classProp public loggers2!: LoggersType;
}

export class Test {
  @classProp public _id!: Types.ObjectId;
  @classProp public login!: string[];
  @classProp public loggers2!: LoggersType;
  @classProp public status!: Statuses;

  @classProp @classRef @prop() public test2!: Ref<Test2>;

  @classProp @classRef @prop() public test3?: Ref<Test2>;
}

// ---------------------- Setup CLI ----------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ---------------------- Loggers ----------------------
const loggers: LoggersType = {
  info: console.log,
  debug: console.debug,
  error: console.error,
  warn: console.warn,
};

// ---------------------- Start Server ----------------------
const start = async () => {
  console.log("📡 Connecting to MongoDB...");
  await mongoose.connect("mongodb://localhost:27017");
  console.log("✅ Connected to MongoDB");

  const TestModel = getModelForClass(Test);
  const Test2Model = getModelForClass(Test2);

  // ---------------------- Socket.IO ----------------------
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });

  httpServer.listen(3000, () => {
    console.log("📡 Socket.IO server running on port 3000");
  });

  // ---------------------- Wrap DB entries ----------------------

  const classers = await AUSManagerFactory(
    {
      Test: {
        model: TestModel,
        class: Test,
        options: {
          accessDefinitions: {
            status: {},
            "test3.loggers2.warn": {},
          },
          autoStatusDefinitions: createAutoStatusDefinitions({
            class: Test,
            statusProperty: "status",
            statusEnum: Statuses,
            definitions: {
              Status1: {},
              Status2:{}
            },
          }),
        },
      },
      Test2: {
        model: Test2Model,
        class: Test2,
      },
    },
    loggers,
    io
  );

  const testObject = classers.Test.getObject("68c9f23872cff1778cb1abe2");
  await testObject?.setValue("test2.loggers2", loggers);
  testObject?.test2.loggers2.info("test");
  await testObject?.setValue("test2.loggers2.info", console.error);
  testObject?.test2.loggers2.info("test");

  // ---------------------- Handle Socket Connections ----------------------
  io.on("connection", async (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    for (const classer of Object.values(classers)) {
      classer.registerSocket(socket);
    }
    // Client disconnect
    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};
start();
