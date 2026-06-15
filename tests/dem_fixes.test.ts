import { initFullClientManagers, initFullServerManagers } from "../test_lib.js";
import mongoose from "mongoose";
import { getModelForClass, prop } from "@typegoose/typegoose";
import * as ServerClasses from "./testData/ServerClasses/index.js";
import { jest } from '@jest/globals';
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { classProp, safeStringify } from "../CommonTypes.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";

import { SubordinateType, TaskStatus, Priority, AssignmentType } from "./testData/types.js";

// Increase Jest timeout
jest.setTimeout(60000);

let serverManagers: any;
let serverIo: any;
let server: any;
let clientManagers: any;
let socket: any;

beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect("mongodb://localhost:27017/GeoDB_Fixes_Test", {
          serverSelectionTimeoutMS: 5000,
        });
    }

    const init = await initFullServerManagers(3005);
    serverManagers = init.managers;
    serverIo = init.io;
    server = init.server;

    const c1 = await initFullClientManagers(3005);
    clientManagers = c1.managers;
    socket = c1.socket;
});

afterAll(async () => {
    if (clientManagers) for (const manager of Object.values(clientManagers)) (manager as any).close();
    if (socket) socket.close();
    if (serverManagers) for (const manager of Object.values(serverManagers)) (manager as any).close();
    if (serverIo) serverIo.close();
    if (server) server.close();
    await mongoose.disconnect();
});

describe("DEM Fixes Verification", () => {

    test("Fix 1: Parallel Save serialization", async () => {
        const sub = await serverManagers.Subordinate.createObject({
            name: "ParallelTest",
            login: "parallel",
            phone: "1",
            company: [],
            type: SubordinateType.GEODET,
        });

        // Trigger multiple saves in parallel
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(sub.setValue("phone", i.toString()));
        }

        const results = await Promise.all(promises);
        
        // All should succeed
        for (const res of results) {
            expect(res.success).toBe(true);
        }

        // Final value should be the last one set (or at least one of them, but definitely not crashed)
        expect(sub.phone).toBeDefined();
        
        // Check DB state
        const model = getModelForClass(ServerClasses.Subordinate);
        const doc = await model.findById(sub._id);
        expect(doc?.phone).toBe(sub.phone);
    });

    test("Fix 2: Circular structure safeStringify", () => {
        const obj: any = { name: "Test" };
        obj.self = obj; // Circular ref

        expect(() => JSON.stringify(obj)).toThrow("Converting circular structure to JSON");
        
        const stringified = safeStringify(obj);
        expect(stringified).toBe("[Circular or non-serializable object]");
    });

    test("Fix 5: Infinite recursion prevention in onUpdate", async () => {
        // We need a class that updates itself in onUpdate
        // Let's monkey patch the manager's options for Subordinate
        const originalOnUpdate = serverManagers.Subordinate.options?.onUpdate;
        
        let updateCount = 0;
        serverManagers.Subordinate.options = {
            ...serverManagers.Subordinate.options,
            onUpdate: async (obj: any, set: any) => {
                updateCount++;
                if (updateCount > 100) {
                    throw new Error("Infinite recursion detected!");
                }
                // Update another property
                await set("login", "updated_" + updateCount);
            }
        };

        const sub = await serverManagers.Subordinate.createObject({
            name: "RecursionTest",
            login: "initial",
            phone: "000",
            company: [],
            type: SubordinateType.GEODET,
        });

        // Reset count for the actual test
        updateCount = 0;
        await sub.setValue("phone", "111");

        // If fix 5 works, updateCount should be 1 (for phone update) 
        // and the 'set' call inside onUpdate should NOT trigger onUpdate again.
        expect(updateCount).toBe(1);
        expect(sub.login).toBe("updated_1");
        expect(sub.phone).toBe("111");

        // Restore original
        serverManagers.Subordinate.options.onUpdate = originalOnUpdate;
    });

    test("Fix 4: Virtual reference resolution on creation", async () => {
        // This tests that virtual properties (populatedRef) are handled correctly
        
        // 1. Create a Construction
        const construction = await serverManagers.Construction.createObject({
            name: "VirtualRefTest Construction",
            objects: [],
        });

        // 2. Create a ConstructionObject (it has a @populatedRef('Construction:objects') parent property)
        // Note: ConstructionObject in testData has:
        // @populatedRef("Construction:objects")
        // public parent: Construction;
        
        const constructionObject = await serverManagers.ConstructionObject.createObject({
            number: "SO-VIRTUAL",
            path: "Root/SO-VIRTUAL",
            parent: construction._id,
            siteManagers: [],
        });

        // Verify that construction.objects contains constructionObject._id
        // This is handled by createdWithParent which is called during loadMissingReferences/loadForceReferences
        
        // Wait a bit for async links
        await new Promise(r => setTimeout(r, 500));

        expect(construction.objects.map((o: any) => o._id.toString())).toContain(constructionObject._id.toString());
    });
});
