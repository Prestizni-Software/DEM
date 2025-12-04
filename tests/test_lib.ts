
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "../AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Status } from "../TestTypes.js";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { Test as ClientTest, Test2 as ClientTest2 } from "../ClientTypes.js";
import { Test2 as ServerTest2, Test as ServerTest} from "../ServerTypes.js";

export const initServerManagers = async () => {
  const server = new Server();
  server.listen(3001);
  const io = new SocketServer(server, { cors: { origin: "*" } });

  await mongoose.connect("mongodb://localhost:27017/GeoDB", {
    timeoutMS: 5000,
  });
  const managers = await AUSManagerFactory(
    {
      Test2: {
        class: ServerTest2,
      },
      Test: {
        class: ServerTest,
        options: {
          autoStatusDefinitions: createAutoStatusDefinitions(
            ServerTest,
            "status",
            Status,
            async (obj) => {
              if (obj.active) return Status.ACTIVE;
              return Status.INACTIVE;
            }
          ),
          accessDefinitions: {
            startupMiddleware: async (objects, classers, auth) => {
              const returns = auth.token == "Client1" ? objects : objects.filter(
                (obj) => obj.description && obj.description !== "TestObj3" && obj.description !== "TestObj4"
              );
              return returns;
            },
            eventMiddleware: async (event, data, classers, auth) => {
              if (auth.token == "Client2" && event.startsWith("delete")) throw new Error("Fail");
            },
          },
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
  return managers;
};

export const initClientManagers = async (id:string) => {
  const socket = io("http://localhost:3001", {
    auth: {
      token: id,
    },
  });

  const managers = await AUCManagerFactory(
    {
      Test: ClientTest,
      Test2: ClientTest2,
    },
    {
      debug: (msg: string) => console.log(msg),
      error: (msg: string) => console.error(msg),
      info: (msg: string) => console.log(msg),
      warn: (msg: string) => console.warn(msg),
    },
    socket
  );
  return managers;
};
