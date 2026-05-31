import {
  AUSManagerFactory,
  DEMEventTypes,
} from "./AutoUpdateServerManagerClass.js";
import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";
import {
  AutoUpdatedClientObject,
} from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
} from "./CommonTypes.js";
import * as ServerClasses from "./tests/testData/ServerClasses/index.js";
import * as ClientClasses from "./tests/testData/ClientClasses/index.js";

import * as ServerTypes from "./ServerTypes.js";
import * as ClientTypes from "./ClientTypes.js";

mongoose.set('debug', true);

export const initServerManagers = async () => {
  const server = new Server();
  server.listen(3001);
  const io = new SocketServer(server, { cors: { origin: "*" } });

  io.use(async (socket, next) => {
    if (!socket.handshake.auth.token) next(new Error("Invalid token"));
    next();
  });

  if (mongoose.connection.readyState === 0) {
      await mongoose.connect("mongodb://localhost:27017/GeoDB", {
        serverSelectionTimeoutMS: 5000,
      });
  }

  const managers = await AUSManagerFactory(
    {
      Test: {
        class: ServerTypes.Test,
      },
      Company: {
        class: ServerClasses.Company,
      },
      Construction: {
        class: ServerClasses.Construction,
      },
      Subordinate: {
        class: ServerClasses.Subordinate,
        options: {
          accessDefinitions: {
            startupMiddleware: async (objects, managers, socket) => {
              const returns =
                socket.handshake.auth.token == "Client1"
                  ? objects
                  : objects.filter(
                      (obj) =>
                        obj.name &&
                        obj.name !== "Redacted" &&
                        obj.name !== "Secret",
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
  return { managers, io, server };
};

export const initClientManagers = async (id: string) => {
  const socket = io("http://localhost:3001", {
    auth: {
      token: id,
    },
    reconnection: false,
  });

  const managers = await AUCManagerFactory(
    {
      Test: ClientTypes.Test,
      Subordinate: ClientClasses.Subordinate,
      Company: ClientClasses.Company,
      Construction: ClientClasses.Construction,
    },
    {
      debug: (msg: string) => console.log("CLIENT " + msg),
      error: (msg: string) => console.error("CLIENT " + msg),
      info: (msg: string) => console.log("CLIENT " + msg),
      warn: (msg: string) => console.log("CLIENT " + msg),
    },
    socket,
  );
  return { managers, socket };
};

export const initFullServerManagers = async (port: number = 3002) => {
  const server = new Server();
  server.listen(port);
  const io = new SocketServer(server, { cors: { origin: "*" } });

  io.use(async (socket, next) => {
    next();
  });

  if (mongoose.connection.readyState === 0) {
      await mongoose.connect("mongodb://localhost:27017/GeoDB_Full", {
        serverSelectionTimeoutMS: 5000,
      });
  }
  
  const defs: any = {};
  for (const [name, cls] of Object.entries(ServerClasses)) {
    if (typeof cls === 'function' && cls.prototype instanceof (ServerClasses as any).AutoUpdatedServerObject) {
       defs[name] = { class: cls as any };
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
    reconnection: false,
  });

  const defs: Record<string, Constructor<AutoUpdatedClientObject<any>>> = {};
  for (const [name, cls] of Object.entries(ClientClasses)) {
    if (typeof cls === 'function' && cls.prototype instanceof (ClientClasses as any).AutoUpdatedClientObject) {
       defs[name] = cls as Constructor<AutoUpdatedClientObject<any>>;
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
