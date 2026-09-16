import { jest } from '@jest/globals';
import { EventEmitter } from "eventemitter3";

// Mock dependencies
const mockModel: any = {
    find: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn()
};
const mockSocketServer: any = {
    use: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
    disconnectSockets: jest.fn()
};

const emitter = new EventEmitter();

jest.unstable_mockModule("@typegoose/typegoose", () => ({
    getModelForClass: jest.fn().mockReturnValue(mockModel)
}));

const { AUSManagerFactory, AutoUpdateServerManager } = await import("../AutoUpdateServerManagerClass.js");
const { getModelForClass } = await import("@typegoose/typegoose");
const { AutoUpdatedServerObject } = await import("../AutoUpdatedServerObjectClass.js");

class MockAutoUpdatedObject extends AutoUpdatedServerObject<any> {
    constructor(...args: any[]) {
        if (args.length === 0) {
            super();
            return;
        }
        // @ts-ignore
        super(...args);
    }
    get _id() { return this.data?._id; }
}

describe("Reproduction: Server Manager Synchronous Loading", () => {
    let logMock: any;

    beforeEach(() => {
        jest.clearAllMocks();
        logMock = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };
    });

    test("Managers and objects should be fully loaded when AUSManagerFactory is awaited", async () => {
        const defs = { 
            Test1: { class: MockAutoUpdatedObject as any },
            Test2: { class: MockAutoUpdatedObject as any }
        };

        // Mock find to return some documents
        const doc1 = { _id: "60f7b1b1b1b1b1b1b1b1b1b1", toObject: () => ({ _id: "60f7b1b1b1b1b1b1b1b1b1b1" }) };
        const doc2 = { _id: "60f7b1b1b1b1b1b1b1b1b1b2", toObject: () => ({ _id: "60f7b1b1b1b1b1b1b1b1b1b2" }) };
        
        mockModel.find.mockImplementation(async () => {
            // Simulate delay to test race conditions
            await new Promise(resolve => setTimeout(resolve, 10));
            return [doc1, doc2];
        });
        mockModel.findById.mockImplementation(async (id: any) => {
            if (id === "60f7b1b1b1b1b1b1b1b1b1b1") return doc1;
            if (id === "60f7b1b1b1b1b1b1b1b1b1b2") return doc2;
            return null;
        });

        const managers = await AUSManagerFactory(defs, logMock, mockSocketServer, false, emitter);

        expect(managers.Test1.isLoaded).toBe(true);
        expect(managers.Test2.isLoaded).toBe(true);
        
        expect(managers.Test1.objectIDs).toContain("60f7b1b1b1b1b1b1b1b1b1b1");
        expect(managers.Test1.objectIDs).toContain("60f7b1b1b1b1b1b1b1b1b1b2");
        
        const obj1 = managers.Test1.getObject("60f7b1b1b1b1b1b1b1b1b1b1");
        expect(obj1).toBeDefined();
        expect(obj1?.isLoaded).toBe(true);
    });
});
