import { initFullClientManagers, initFullServerManagers } from "../test_lib.js";
import mongoose from "mongoose";
import { getModelForClass } from "@typegoose/typegoose";
import * as ServerClasses from "./testData/ServerClasses/index.js";
import { jest } from '@jest/globals'

jest.setTimeout(60000);

describe("Reference Integrity and Data Cleanup", () => {
    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect("mongodb://localhost:27017/GeoDB_Test_RefIntegrity");
        }

        // Clear DB
        await getModelForClass(ServerClasses.Protocol as any).deleteMany({});
        await getModelForClass(ServerClasses.Attachment as any).deleteMany({});
        await getModelForClass(ServerClasses.Subordinate as any).deleteMany({});
    });

    afterAll(async () => {
        await mongoose.disconnect();
    });

    test("Creating Attachment with full Protocol instance should clean data and update back-reference", async () => {
        const initS = await initFullServerManagers(3007);
        const serverManagers = initS.managers;

        // 1. Create a Protocol
        const protocol = await serverManagers.Protocol.createObject({
            isControl: false,
            status: "WAITING",
            protocolNumber: 100,
            hsvAprovement: -1,
            supervisorAprovement: -1,
            folderName: "test",
            uploadedToAspehub: false,
            lastUpdate: Date.now()
        } as any);

        // 2. Create an Admin Subordinate (needed for Attachment creator)
        const admin = await serverManagers.Subordinate.createObject({
            name: "Admin",
            login: "admin",
            type: "Admin", // SubordinateType.Admin
            company: [],
            phone: "123"
        } as any);

        // 3. Create an Attachment passing the full protocol instance
        // This simulates the user's code
        const attachment = await serverManagers.Attachment.createObject({
            creator: admin,
            lastEdited: new Date(),
            path: "---",
            type: "Protocol",
            fileName: "test.pdf",
            size: -1,
            protocolParent: protocol, // PASSING FULL OBJECT
        } as any);

        // 4. Verify Attachment data integrity
        const rawData = (attachment as any).data;
        console.log("Attachment raw data protocolParent:", rawData.protocolParent);
        
        // It should be a string (the ID), not the whole object
        expect(rawData.protocolParent.toString() === {}.toString()).toBe(false);
        expect(rawData.protocolParent.toString()).toBe(protocol._id.toString());

        // 5. Verify Back-Reference on Protocol
        // Wait a bit for the async update from createdWithParent
        const start = Date.now();
        while (!protocol.protocol && Date.now() - start < 5000) {
            await new Promise(r => setTimeout(r, 100));
        }

        expect(protocol.protocol).toBeDefined();
        expect(protocol.protocol._id.toString()).toBe(attachment._id.toString());

        // Cleanup
        for (const m of Object.values(serverManagers)) (m as any).close();
        initS.io.close();
        initS.server.close();
    });
});
