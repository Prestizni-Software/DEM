import { jest } from '@jest/globals';
import { EventEmitter } from "eventemitter3";
import "reflect-metadata";

// Mock dependencies
const mockSocketServer: any = {
    use: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
    disconnectSockets: jest.fn()
};

const emitter = new EventEmitter();

jest.unstable_mockModule("@typegoose/typegoose", () => ({
    getModelForClass: jest.fn()
}));

const { AUSManagerFactory } = await import("../AutoUpdateServerManagerClass.js");
const { AutoUpdatedServerObject } = await import("../AutoUpdatedServerObjectClass.js");
const { populatedRef, globalCache } = await import("../CommonTypes.js");
const { getModelForClass } = await import("@typegoose/typegoose");

class Parent extends AutoUpdatedServerObject<Parent> {
    constructor(...args: any[]) {
        if (args.length === 0) { super(); return; }
        // @ts-ignore
        super(...args);
    }
    get _id() { return this.data?._id; }
    @populatedRef("Child:parent")
    public children?: string[];
}

class Child extends AutoUpdatedServerObject<Child> {
    constructor(...args: any[]) {
        if (args.length === 0) { super(); return; }
        // @ts-ignore
        super(...args);
    }
    get _id() { return this.data?._id; }
    @populatedRef("Parent:children")
    public parent?: string;
}

describe("Reproduction: Reference Synchronization", () => {
    let logMock: any;

    beforeEach(() => {
        jest.clearAllMocks();
        globalCache.objects = {};
        logMock = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };
    });

    test("References should be resolved even if managers load in parallel", async () => {
        const defs = { 
            Child: { class: Child as any },
            Parent: { class: Parent as any }
        };

        const parentId = "60f7b1b1b1b1b1b1b1b1b1b1";
        const childId = "60f7b1b1b1b1b1b1b1b1b1b2";

        const parentDoc = { _id: parentId, toObject: () => ({ _id: parentId, children: [] }), save: jest.fn().mockResolvedValue(undefined) };
        const childDoc = { _id: childId, toObject: () => ({ _id: childId, parent: parentId }), save: jest.fn().mockResolvedValue(undefined) };

        const parentModel: any = {
            find: jest.fn().mockImplementation(async () => {
                // Delay parent loading slightly to increase chance of race condition
                await new Promise(resolve => setTimeout(resolve, 50));
                return [parentDoc];
            }),
            findById: jest.fn().mockResolvedValue(parentDoc)
        };

        const childModel: any = {
            find: jest.fn().mockImplementation(async () => {
                return [childDoc];
            }),
            findById: jest.fn().mockResolvedValue(childDoc)
        };

        (getModelForClass as jest.Mock).mockImplementation((cls) => {
            if (cls === Parent) return parentModel;
            if (cls === Child) return childModel;
            return {};
        });

        const managers = await AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter);

        const parentObj = managers.Parent.getObject(parentId) as Parent;
        const childObj = managers.Child.getObject(childId) as Child;

        expect(parentObj).toBeDefined();
        expect(childObj).toBeDefined();

        // Check if Child's parent is set correctly (this usually works via dynamic getter)
        expect(childObj.parent).toBe(parentObj);

        // Check if Parent's children array contains the Child (this relies on createdWithParent)
        // If the bug exists, this might be empty because Child tried to sync to Parent before Parent was created.
        expect(parentObj.children).toContain(childObj);
    });
});
