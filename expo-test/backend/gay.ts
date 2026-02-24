
import { io } from "socket.io-client";
import { AUCManagerFactory } from "@prestizni-software/client-dem/dist/AutoUpdateClientManagerClass.js";
import { Test, Test2 } from "./ClientTypes";

export const initClientManagers = async (id: string) => {
  const socket = io("http://localhost:3001", {
    auth: {
      token: id,
    },
  });

  const managers = await AUCManagerFactory(
    {
      Test: Test,
      Test2: Test2,
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


export const DEM = await initClientManagers("GayClient");