import {
  AUSManagerFactory,
  DEMEventTypes,
} from "./AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { Status } from "./TestTypes.js";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
import { Test as ClientTest, Test2 as ClientTest2 } from "./ClientTypes.js";
import { Test2 as ServerTest2, Test as ServerTest } from "./ServerTypes.js";
import { logger } from "@typegoose/typegoose/lib/logSettings.js";

export const initServerManagers = async () => {
  const server = new Server();
  server.listen(3001);
  const io = new SocketServer(server, { cors: { origin: "*" } });

  io.use(async (socket, next) => {
    if (!socket.handshake.auth.token) next(new Error("Invalid token"));
    next();
  });

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
          onUpdate: async (obj, set) => {
            if (obj.status === Status.ACTIVE && !obj.active) {
              await set("status", Status.INACTIVE);
            } else if (obj.status === Status.INACTIVE && obj.active) {
              await set("status", Status.ACTIVE);
            }
          },
          accessDefinitions: {
            startupMiddleware: async (objects, managers, socket) => {
              const returns =
                socket.handshake.auth.token == "Client1"
                  ? objects
                  : objects.filter(
                      (obj) =>
                        obj.description &&
                        obj.description !== "TestObj3" &&
                        obj.description !== "TestObj4",
                    );
              logger.error(
                objects.map((obj) => obj.description ?? "" + obj._id),
              );
              logger.error(
                returns.map((obj) => obj.description ?? "" + obj._id),
              );
              return returns;
            },
            eventMiddleware: async (event, managers, socket) => {
              if (
                socket.handshake.auth.token == "Client2" &&
                event.type === DEMEventTypes.delete
              )
                throw new Error("Fail");
            },
          },
        },
      },
    },
    {
      info: (s: string) => console.log("SERVER " + s),
      warn: (s: string) => console.warn("SERVER " + s),
      error: (s: string) => console.error("SERVER " + s),
      debug: (s: string) => console.debug("SERVER " + s),
    },
    io,
  );
  return managers;
};

export const initClientManagers = async (id: string) => {
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
      debug: (msg: string) => console.log("CLIENT " + msg),
      error: (msg: string) => console.error("CLIENT " + msg),
      info: (msg: string) => console.log("CLIENT " + msg),
      warn: (msg: string) => console.warn("CLIENT " + msg),
    },
    socket,
  );
  return managers;
};

import * as ServerClasses from "./tests/testData/ServerClasses/index.js";
import * as ClientClasses from "./tests/testData/ClientClasses/index.js";

export const initFullServerManagers = async (port: number = 3002) => {
  const server = new Server();
  server.listen(port);
  const io = new SocketServer(server, { cors: { origin: "*" } });

  io.use(async (socket, next) => {
    next();
  });

  await mongoose.connect("mongodb://localhost:27017/GeoDB_Full", {
    timeoutMS: 5000,
  });
  
  const defs: any = {};
  for (const [name, cls] of Object.entries(ServerClasses)) {
    if (typeof cls === 'function' && cls.prototype instanceof ServerClasses.AutoUpdatedServerObject) {
       defs[name] = { class: cls };
    }
  }

  const managers = await AUSManagerFactory(
    defs,
    {
      info: (s: string) => {},
      warn: (s: string) => {},
      error: (s: string) => console.error("SERVER " + s),
      debug: (s: string) => {},
    },
    io,
    true
  );
  return { managers, io, server };
};

export const initFullClientManagers = async (port: number = 3002) => {
  const socket = io(`http://localhost:${port}`, {
    auth: {
      token: "FullClient",
    },
  });

  const defs: any = {};
  for (const [name, cls] of Object.entries(ClientClasses)) {
    if (typeof cls === 'function' && cls.prototype instanceof ClientClasses.AutoUpdatedClientObject) {
       defs[name] = cls;
    }
  }

  const managers = await AUCManagerFactory(
    defs,
    {
      debug: (msg: string) => {},
      error: (msg: string) => console.error("CLIENT " + msg),
      info: (msg: string) => {},
      warn: (msg: string) => {},
    },
    socket,
  );
  return { managers, socket };
};

