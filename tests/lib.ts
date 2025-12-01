import { Test, Test2 } from "../test_server";
import {
  AUSManagerFactory,
  createAutoStatusDefinitions,
} from "../AutoUpdateServerManagerClass";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Status } from "../TestTypes";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass";
import { ClientTest, ClientTest2 } from "../test_client";

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
        class: Test2,
      },
      Test: {
        class: Test,
        options: {
          autoStatusDefinitions: createAutoStatusDefinitions(
            Test,
            "status",
            Status,
            async (obj) => {
              if (obj.active) return Status.ACTIVE;
              return Status.INACTIVE;
            }
          ),
          accessDefinitions: {
            startupMiddleware: async (objects, classers, auth) => {
              const returns = objects.filter(
                (obj) => obj.description && obj.description !== ""
              );
              return returns;
            },
            eventMiddleware: async (event, classers, auth) => {
              if (event[0].includes("fail")) throw new Error("Fail");
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

export const initClientManagers = async () => {
  const socket = io("http://localhost:3001", {
    auth: {
      token: "test",
    },
  });

  const managers = await AUCManagerFactory(
    {
      ClientTest: ClientTest,
      ClientTest2: ClientTest2,
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
