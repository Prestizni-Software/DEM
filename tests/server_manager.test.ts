import { jest } from '@jest/globals';
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { EventEmitter } from "eventemitter3";
import { LoggersType, globalCache, classProp, classRef } from "../CommonTypes.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import "reflect-metadata";

describe("AutoUpdateManager base class tests", () => {
    let loggers: LoggersType;
    let mockSocket: any;
    let mockEmitter: any;
    let mockModel: any;
    let manager: any;

    beforeEach(() => {
        loggers = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        mockSocket = {
            disconnect: jest.fn(),
            disconnectSockets: jest.fn(),
            on: jest.fn(),
            onAny: jest.fn(),
            emit: jest.fn(),
        };
        mockEmitter = new EventEmitter();
        mockModel = {
            find: jest.fn().mockResolvedValue([]),
            findById: jest.fn(),
        };
        manager = new AutoUpdateServerManager(
            class { } as any,
            "TestClass",
            mockSocket,
            loggers,
            mockModel,
            {},
            mockEmitter
        );
    });

    test("isLoaded getter", () => {
        expect(manager.isLoaded).toBe(false);
        manager['isLoaded_'] = true;
        expect(manager.isLoaded).toBe(true);
    });

    test("objectIDs getter", () => {
        manager['objects_'] = { "id1": {}, "id2": {} };
        expect(manager.objectIDs).toEqual(["id1", "id2"]);
    });

    test("close method", () => {
        manager['objects_'] = { "id1": {} };
        globalCache.objects["id1"] = { className: "TestClass", object: {} as any };
        
        manager.close();
        
        expect(manager['objects_']["id1"]).toBeUndefined();
        expect(globalCache.objects["id1"]).toBeUndefined();
        expect(mockSocket.disconnect).toHaveBeenCalled();
        expect(loggers.info).toHaveBeenCalled();
    });

    test("loadReferences method", async () => {
        const mockObj = { 
            loadMissingReferences: jest.fn().mockResolvedValue(undefined),
            isPreLoadedAsync: jest.fn().mockResolvedValue(true)
        };
        // We need to mock objectsAsArray because it's abstract in base but implemented in server manager
        Object.defineProperty(manager, 'objectsAsArray', {
            get: jest.fn().mockReturnValue([mockObj])
        });
        
        await manager.loadReferences();
        
        expect(mockObj.loadMissingReferences).toHaveBeenCalled();
        expect(manager.isLoaded).toBe(true);
    });

    test("deleteObject - object exists and success", async () => {
        const mockObj = { 
            destroy: jest.fn().mockResolvedValue({ success: true, message: "Deleted" }),
            callbacks: { delete: jest.fn().mockResolvedValue(undefined) }
        };
        manager['objects_'] = { "id1": mockObj };
        globalCache.objects["id1"] = { className: "TestClass", object: mockObj as any };
        
        const res = await manager.deleteObject("id1");
        
        expect(res.success).toBe(true);
        expect(manager['objects_']["id1"]).toBeUndefined();
        expect(globalCache.objects["id1"]).toBeUndefined();
        expect(mockObj.callbacks.delete).toHaveBeenCalled();
    });

    test("deleteObject - object does not exist", async () => {
        const res = await manager.deleteObject("nonexistent");
        expect(res.success).toBe(true);
        expect(res.message).toBe("Already gone");
    });
    
    test("Loggers should be correctly prefixed", () => {
        manager['loggers'].debug("test debug");
        expect(loggers.debug).toHaveBeenCalledWith("[DEM - TestClass MANAGER] test debug");
        
        manager['loggers'].info("test info");
        expect(loggers.info).toHaveBeenCalledWith("[DEM - TestClass MANAGER] test info");
        
        manager['loggers'].error("test error");
        expect(loggers.error).toHaveBeenCalledWith("[DEM - TestClass MANAGER] test error");
        
        manager['loggers'].warn("test warn");
        expect(loggers.warn).toHaveBeenCalledWith("[DEM - TestClass MANAGER] test warn");
    });
    test("createObject does not flatten embedded object containing _id when property is not a reference", async () => {
        let createdData: any = null;
        mockModel.create = jest.fn().mockImplementation((dataRec: any) => {
            createdData = dataRec;
            return Promise.resolve({
                _id: "created-doc-id-123",
                ...dataRec
            });
        });

        class TestEntity extends AutoUpdatedServerObject<TestEntity> {
            @classProp
            public snapshot!: any;

            @classProp
            public subdocs!: any[];

            @classRef()
            @classProp
            public companyRef!: any;
        }

        const testManager = new AutoUpdateServerManager(
            TestEntity,
            "TestEntity",
            mockSocket,
            loggers,
            mockModel,
            {},
            mockEmitter
        );
        (testManager as any).managers = { TestEntity: testManager };

        const payload = {
            snapshot: {
                _id: "snap-id-1",
                title: "Original Snapshot",
                status: "ACTIVE"
            },
            subdocs: [
                { _id: "sub-1", label: "First" },
                { _id: "sub-2", label: "Second" }
            ],
            companyRef: {
                _id: "comp-ref-1",
                name: "Company Name"
            }
        };

        await testManager.createObject(payload as any);

        expect(createdData).toBeDefined();
        expect(createdData.snapshot).toEqual({
            _id: "snap-id-1",
            title: "Original Snapshot",
            status: "ACTIVE"
        });
        expect(createdData.subdocs).toEqual([
            { _id: "sub-1", label: "First" },
            { _id: "sub-2", label: "Second" }
        ]);
        expect(createdData.companyRef).toBe("comp-ref-1");
    });
});
