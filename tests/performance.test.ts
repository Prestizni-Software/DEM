import { jest } from '@jest/globals';
import mongoose from "mongoose";
import { initFullServerManagers, initFullClientManagers } from "../test_lib.js";
import { loadTestData } from "./data_loader.js";

describe("Performance Loading Test", () => {
  beforeAll(async () => {
    // Connect to the DB used by full managers
    await mongoose.connect("mongodb://localhost:27017/GeoDB_Full", {
      timeoutMS: 5000,
    });
    await loadTestData();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test("Measure full system initialization with snapshot data", async () => {
    const startServer = performance.now();
    const { managers: serverManagers, io, server } = await initFullServerManagers(3005);
    const endServer = performance.now();
    console.log(`Server managers initialized in ${endServer - startServer}ms`);

    const startClient = performance.now();
    const { managers: clientManagers, socket } = await initFullClientManagers(3005);
    
    // Wait for all objects to be loaded on client
    // We can check if specific managers have objects
    const waitForLoading = async () => {
        return new Promise<void>((resolve) => {
            const check = () => {
                // Heuristic: check if Subordinate manager has some objects
                if (clientManagers.Subordinate && clientManagers.Subordinate.objectsAsArray.length > 0) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    };

    await waitForLoading();
    const endClient = performance.now();
    console.log(`Client managers initialized and loaded in ${endClient - startClient}ms`);

    expect(Object.keys(serverManagers).length).toBeGreaterThan(0);
    expect(Object.keys(clientManagers).length).toBeGreaterThan(0);

    // Cleanup
    for (const manager of Object.values(serverManagers)) (manager as any).close();
    for (const manager of Object.values(clientManagers)) (manager as any).close();
    socket.close();
    io.close();
    server.close();
  }, 60000); // 1 minute timeout for performance test
});
