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

    test("Fix 6: populatedRef loading from DB when missing in child document", async () => {
        const constructionModel = getModelForClass(ServerClasses.Construction as any);
        const constructionObjectModel = getModelForClass(ServerClasses.ConstructionObject as any);

        const childId = new mongoose.Types.ObjectId();
        const parentId = new mongoose.Types.ObjectId();

        // Child document has NO parent field
        await constructionObjectModel.create({
            _id: childId,
            number: "SO 999",
            path: "Root/SO 999",
            siteManagers: []
        });

        // Parent document HAS childId in 'objects' array
        await constructionModel.create({
            _id: parentId,
            name: "Parent 999",
            objects: [childId]
        });

        // Create new managers to load from DB
        const initS = await initFullServerManagers(3010);
        const initC = await initFullClientManagers(3010);

        const cChild = initC.managers.ConstructionObject.getObject(childId.toString());
        
        const start = Date.now();
        while (!cChild.parent && Date.now() - start < 10000) {
            await new Promise(r => setTimeout(r, 100));
        }
        
        expect(cChild.parent).toBeDefined();
        expect(cChild.parent._id.toString()).toBe(parentId.toString());

        // Cleanup
        for (const m of Object.values(initC.managers)) (m as any).close();
        initC.socket.close();
        for (const m of Object.values(initS.managers)) (m as any).close();
        initS.io.close();
        initS.server.close();
    });

    test("Fix 7: Reference cache class-specificity (avoid collision)", async () => {
        const protocolModel = getModelForClass(ServerClasses.Protocol as any);
        const protocolTaskModel = getModelForClass(ServerClasses.ProtocolTask as any);
        const attachmentModel = getModelForClass(ServerClasses.Attachment as any);

        const protocolId = new mongoose.Types.ObjectId();
        const protocolTaskId = new mongoose.Types.ObjectId();
        const attachmentId = new mongoose.Types.ObjectId();

        // ProtocolTask.protocol -> Protocol
        await protocolTaskModel.create({
            _id: protocolTaskId,
            element: "TaskFix7",
            protocol: protocolId,
            constructionObject: new mongoose.Types.ObjectId(),
            createdBy: new mongoose.Types.ObjectId(),
            assignmentType: 0,
            complex: false,
            measurements: []
        });

        // Protocol.protocol -> Attachment
        await protocolModel.create({
            _id: protocolId,
            protocol: attachmentId,
            status: "WAITING",
            isControl: false,
            comments: [],
            supervisor_comments: [],
            hsvAprovement: -1,
            supervisorAprovement: -1,
            folderName: "test"
        });

        await attachmentModel.create({
            _id: attachmentId,
            name: "DocFix7",
            fileName: "fix7.doc",
            path: "/path",
            type: "Other",
            lastEdited: new Date()
        });

        const initS = await initFullServerManagers(3011);
        const initC = await initFullClientManagers(3011);

        const cProtocolTask = initC.managers.ProtocolTask.getObject(protocolTaskId.toString());
        const cProtocol = initC.managers.Protocol.getObject(protocolId.toString());

        const start = Date.now();
        while ((!cProtocolTask.protocol || !cProtocol.protocol) && Date.now() - start < 10000) {
            await new Promise(r => setTimeout(r, 100));
        }

        expect(cProtocolTask.protocol).toBeDefined();
        expect(cProtocolTask.protocol.className).toBe("Protocol");
        
        expect(cProtocol.protocol).toBeDefined();
        expect(cProtocol.protocol.className).toBe("Attachment");

        // Cleanup
        for (const m of Object.values(initC.managers)) (m as any).close();
        initC.socket.close();
        for (const m of Object.values(initS.managers)) (m as any).close();
        initS.io.close();
        initS.server.close();
    });
});
