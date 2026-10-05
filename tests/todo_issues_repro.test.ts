import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import mongoose from "mongoose";
import { io as socketIOClient } from "socket.io-client";
import { jest } from "@jest/globals";
import { AUSManagerFactory } from "../AutoUpdateServerManagerClass.js";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import * as ServerClasses from "./testData/ServerClasses/index.js";
import * as ClientClasses from "./testData/ClientClasses/index.js";
import { SubordinateType } from "./testData/types.js";

jest.setTimeout(30000);

describe("TODO.md Issues Reproduction & Verification", () => {
  let server: Server;
  let io: SocketServer;
  let serverManagers: any;
  let client1: any;
  let client2: any;
  const PORT = 3015;

  const noopLoggers = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect("mongodb://localhost:27017/GeoDB_Todo_Test", {
        serverSelectionTimeoutMS: 5000,
      });
    }
  });

  afterAll(async () => {
    if (client1?.socket) client1.socket.close();
    if (client2?.socket) client2.socket.close();
    if (client1?.managers) {
      for (const m of Object.values(client1.managers)) (m as any).close();
    }
    if (client2?.managers) {
      for (const m of Object.values(client2.managers)) (m as any).close();
    }
    if (serverManagers) {
      for (const m of Object.values(serverManagers)) (m as any).close();
    }
    if (io) io.close();
    if (server) server.close();
    await mongoose.disconnect();
  });

  describe("Bug B: writeQueue Recursive Self-Deadlock", () => {
    let deadlockServer: Server;
    let deadlockIo: SocketServer;
    let deadlockServerManagers: any;
    const DEADLOCK_PORT = 3016;

    beforeAll(async () => {
      deadlockServer = new Server();
      deadlockServer.listen(DEADLOCK_PORT);
      deadlockIo = new SocketServer(deadlockServer, { cors: { origin: "*" } });

      deadlockServerManagers = await AUSManagerFactory(
        {
          Subordinate: {
            class: ServerClasses.Subordinate,
            options: {
              onUpdate: async (obj: any, _set: any, key: any) => {
                if (key === "phone") {
                  // Direct call to obj.setValue inside onUpdate or nested workflow
                  await obj.setValue("name", "DeadlockResolvedName");
                }
              },
            },
          },
        },
        noopLoggers,
        deadlockIo,
        false,
      );
    });

    afterAll(async () => {
      if (deadlockServerManagers) {
        for (const m of Object.values(deadlockServerManagers)) (m as any).close();
      }
      if (deadlockIo) deadlockIo.close();
      if (deadlockServer) deadlockServer.close();
    });

    test("Calling setValue on the same object inside onUpdate should not deadlock", async () => {
      const sub = await deadlockServerManagers.Subordinate.createObject({
        name: "InitialName",
        login: "deadlock_test_" + Date.now(),
        phone: "000000",
        company: [],
        type: SubordinateType.GEODET,
      });

      // Wrap in a 3s timeout to catch deadlocks as test failures rather than infinite hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DEADLOCK_DETECTED: setValue hung permanently")), 3000)
      );

      const updatePromise = sub.setValue("phone", "999999");
      const result = await Promise.race([updatePromise, timeoutPromise]) as any;

      expect(result.success).toBe(true);
      expect(sub.phone).toBe("999999");
      expect(sub.name).toBe("DeadlockResolvedName");
    });
  });

  describe("Bug A: Dynamic Permission Boundary Subscription Gap", () => {
    let permServer: Server;
    let permIo: SocketServer;
    let permServerManagers: any;
    let adminClient: any;
    let restrictedClient: any;
    const PERM_PORT = 3017;

    beforeAll(async () => {
      permServer = new Server();
      permServer.listen(PERM_PORT);
      permIo = new SocketServer(permServer, { cors: { origin: "*" } });

      permServerManagers = await AUSManagerFactory(
        {
          Subordinate: {
            class: ServerClasses.Subordinate,
            options: {
              accessDefinitions: {
                startupMiddleware: async (objects, _managers, socket) => {
                  const token = socket.handshake.auth.token;
                  if (token === "Admin") return objects;
                  // Restricted client only receives objects with phone === "APPROVED"
                  return objects.filter((o: any) => o.phone === "APPROVED");
                },
              },
            },
          },
        },
        noopLoggers,
        permIo,
        false,
      );

      // Connect Admin Client
      const adminSocket = socketIOClient(`http://localhost:${PERM_PORT}`, {
        auth: { token: "Admin" },
        reconnection: false,
      });
      const adminManagers = await AUCManagerFactory(
        { Subordinate: ClientClasses.Subordinate },
        noopLoggers,
        adminSocket,
      );
      adminClient = { socket: adminSocket, managers: adminManagers };

      // Connect Restricted Client
      const restrictedSocket = socketIOClient(`http://localhost:${PERM_PORT}`, {
        auth: { token: "Restricted" },
        reconnection: false,
      });
      const restrictedManagers = await AUCManagerFactory(
        { Subordinate: ClientClasses.Subordinate },
        noopLoggers,
        restrictedSocket,
      );
      restrictedClient = { socket: restrictedSocket, managers: restrictedManagers };
    });

    afterAll(async () => {
      if (adminClient?.socket) adminClient.socket.close();
      if (restrictedClient?.socket) restrictedClient.socket.close();
      if (adminClient?.managers) {
        for (const m of Object.values(adminClient.managers)) (m as any).close();
      }
      if (restrictedClient?.managers) {
        for (const m of Object.values(restrictedClient.managers)) (m as any).close();
      }
      if (permServerManagers) {
        for (const m of Object.values(permServerManagers)) (m as any).close();
      }
      if (permIo) permIo.close();
      if (permServer) permServer.close();
    });

    test("Mutating object to qualify for startupMiddleware dynamically emits new and registers listener on restricted client", async () => {
      // 1. Create subordinate with phone = "PENDING" (not visible to restricted client)
      const sub = await permServerManagers.Subordinate.createObject({
        name: "PermissionTest",
        login: "perm_test_" + Date.now(),
        phone: "PENDING",
        company: [],
        type: SubordinateType.GEODET,
      });
      const subId = sub._id.toString();

      // Wait for async creation socket event propagation
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify Admin has it
      expect(adminClient.managers.Subordinate.getObject(subId)).toBeDefined();

      // Verify Restricted Client does NOT have it initially
      expect(restrictedClient.managers.Subordinate.getObject(subId)).toBeUndefined();

      // 2. Mutate subordinate to phone = "APPROVED"
      await sub.setValue("phone", "APPROVED");

      // Wait for socket event propagation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Restricted client MUST now have the object loaded in memory
      const restrictedObj = restrictedClient.managers.Subordinate.getObject(subId);
      expect(restrictedObj).toBeDefined();
      expect(restrictedObj?.phone).toBe("APPROVED");

      // 3. Further mutation should now be received in real-time by the restricted client
      await sub.setValue("name", "UpdatedAfterGrantedAccess");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(restrictedObj?.name).toBe("UpdatedAfterGrantedAccess");

      // 4. Mutate back to "PENDING" (permission revoked)
      await sub.setValue("phone", "PENDING");
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Restricted client should have removed the object
      expect(restrictedClient.managers.Subordinate.getObject(subId)).toBeUndefined();
    });
  });
});
