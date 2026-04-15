import { jest } from '@jest/globals';
import { EventEmitter } from "eventemitter3";

// Mocking dependencies before importing the module
jest.unstable_mockModule("@typegoose/typegoose", () => ({
    getModelForClass: jest.fn(),
    prop: jest.fn(),
}));

jest.unstable_mockModule("node-machine-id", () => ({
    default: {
        machineIdSync: jest.fn().mockReturnValue("534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2")
    },
    machineIdSync: jest.fn().mockReturnValue("534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2")
}));

jest.unstable_mockModule("../AutoUpdatedServerObjectClass.js", () => ({
    createAutoUpdatedClass: jest.fn(),
    AutoUpdatedServerObject: class {
        constructor() {}
        isPreLoadedAsync = jest.fn().mockResolvedValue(undefined);
        contactChildren = jest.fn().mockResolvedValue(undefined);
        loadMissingReferences = jest.fn().mockResolvedValue(undefined);
        onUpdate = jest.fn().mockResolvedValue(undefined);
        setValue = jest.fn().mockResolvedValue({ success: true, msg: "OK" });
        waitForPreloaded = jest.fn().mockResolvedValue(undefined);
        extractedData = { _id: "123" };
        _id = "123";
        className = "Test";
        callbacks = { delete: jest.fn() };
        destroy = jest.fn().mockResolvedValue({ success: true });
    }
}));

const { AUSManagerFactory, AutoUpdateServerManager } = await import("../AutoUpdateServerManagerClass.js");
const { createAutoUpdatedClass } = await import("../AutoUpdatedServerObjectClass.js");
const { getModelForClass } = await import("@typegoose/typegoose");

describe("AutoUpdateServerManagerClass Full Coverage", () => {
    let loggers: any;
    let originalLoggers: any;
    let mockSocketServer: any;
    let emitter: any;
    let mockModel: any;

    beforeEach(() => {
        originalLoggers = { 
            info: jest.fn(), 
            debug: jest.fn(), 
            error: jest.fn(), 
            warn: jest.fn() 
        };
        loggers = { ...originalLoggers };
        emitter = new EventEmitter();
        mockSocketServer = {
            use: jest.fn(),
            on: jest.fn(),
            emit: jest.fn(),
            eventNames: jest.fn().mockReturnValue([])
        };
        mockModel = {
            find: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue(null),
        };
        (getModelForClass as jest.Mock).mockReset();
        (getModelForClass as jest.Mock).mockReturnValue(mockModel);
    });

    test("AUSManagerFactory success and error paths", async () => {
        const defs = {
            Test: { 
                class: class TestClass {} as any,
                options: {
                    accessDefinitions: {
                        eventMiddleware: jest.fn()
                    }
                }
            }
        };

        (getModelForClass as jest.Mock).mockReturnValue(mockModel);

        const managers = await AUSManagerFactory(defs, loggers, mockSocketServer, false, emitter);
        expect(managers.Test).toBeDefined();

        // Trigger connection
        const connectionHandler = mockSocketServer.on.mock.calls.find(c => c[0] === "connection")?.[1];
        if (connectionHandler) {
            const mockSocket: any = { id: "s1", on: jest.fn(), onAny: jest.fn(), handshake: { auth: {}, address: "127.0.0.1" } };
            await connectionHandler(mockSocket);
            expect(originalLoggers.debug).toHaveBeenCalledWith(expect.stringContaining("Client connected: s1"));
            
            const disconnectHandler = mockSocket.on.mock.calls.find(c => c[0] === "disconnect")?.[1];
            disconnectHandler();
            expect(originalLoggers.debug).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
        }
    });

    test("AutoUpdateServerManager.preLoad exhaustive", async () => {
        const mockObj = {
            isPreLoadedAsync: jest.fn().mockResolvedValue(undefined),
            contactChildren: jest.fn().mockResolvedValue(undefined),
            loadMissingReferences: jest.fn().mockResolvedValue(undefined),
            waitForPreloaded: jest.fn().mockResolvedValue(undefined),
            _id: "doc1"
        };
        (createAutoUpdatedClass as jest.Mock).mockResolvedValue(mockObj);

        const manager = new AutoUpdateServerManager(
            class {} as any, "Test", loggers, mockSocketServer, mockModel, {}, emitter
        );
        
        mockModel.find.mockResolvedValue([
            { _id: { toString: () => "doc1" } },
            { _id: { toString: () => "" } }
        ]);

        await manager.preLoad();
        expect(manager.getObject("doc1")).toBe(mockObj);
    });

    test("setupSocketMiddleware exhaustive paths", async () => {
        const id24 = "obj123456789012345678901234";
        const mockObj = { _id: id24, extractedData: { data: 1 } };
        const mockManager: any = {
            getObject: jest.fn().mockReturnValue(mockObj),
            options: {
                accessDefinitions: {
                    eventMiddleware: jest.fn().mockResolvedValue(undefined)
                }
            }
        };
        const managers = { Test: mockManager };
        
        const defs = { Test: { class: class {} as any } };
        await AUSManagerFactory(defs, loggers, mockSocketServer, false, emitter);

        const middleware = mockSocketServer.use.mock.calls.find(c => c[0].length === 2 && c[0].toString().includes("setupSocketMiddleware"))?.[0] || mockSocketServer.use.mock.calls[1]?.[0];
        
        const mockSocket: any = { 
            id: "s1", 
            use: jest.fn(), 
            on: jest.fn(), 
            onAny: jest.fn(),
            eventNames: jest.fn().mockReturnValue(["newTest", "updateTest", "deleteTest", "getTest", "startupTest"]),
            handshake: { auth: { user: "admin" }, address: "1.1.1.1" }
        };
        
        if (middleware) {
            middleware(mockSocket, jest.fn());
            const innerMiddleware = mockSocket.use.mock.calls[0]?.[0];
            const next = jest.fn();

            if (innerMiddleware) {
                // 1. Invalid event format
                await innerMiddleware(["event"], next);
                expect(originalLoggers.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid event"));

                // 2. Undefined event
                const ack2 = jest.fn();
                await innerMiddleware(["unknownEvent", {}, ack2], next);
                expect(ack2).toHaveBeenCalledWith(expect.objectContaining({ success: false }));

                // 3. EVENT_NEW
                const ack3 = jest.fn();
                await innerMiddleware(["newTest", { name: "n" }, ack3], next);
                expect(next).toHaveBeenCalled();

                // 4. EVENT_UPDATE
                const ack4 = jest.fn();
                await innerMiddleware(["updateTest" + id24, { k: "v" }, ack4], next);
                expect(next).toHaveBeenCalled();

                // 5. EVENT_DELETE (success)
                const ack5 = jest.fn();
                await innerMiddleware(["deleteTest", id24, ack5], next);
                expect(next).toHaveBeenCalled();

                // 6. EVENT_DELETE (already deleted)
                const ack6 = jest.fn();
                mockManager.getObject.mockReturnValueOnce(null);
                await innerMiddleware(["deleteTest", "absent", ack6], next);
                expect(ack6).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: "Object already deleted" }));

                // 7. EVENT_GET
                const ack7 = jest.fn();
                await innerMiddleware(["getTest" + id24, {}, ack7], next);
                expect(next).toHaveBeenCalled();

                // 8. EVENT_STARTUP
                const ack8 = jest.fn();
                await innerMiddleware(["startupTest", {}, ack8], next);
                expect(next).toHaveBeenCalled();

                // 9. Access Denied in eventMiddleware
                const ack9 = jest.fn();
                mockManager.options.accessDefinitions.eventMiddleware.mockRejectedValueOnce(new Error("No Way"));
                await innerMiddleware(["newTest", {}, ack9], next);
                expect(ack9).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("No Way") }));

                // 10. Unknown event type in switch
                const ack10 = jest.fn();
                mockSocket.eventNames.mockReturnValue(["badTest"]);
                await innerMiddleware(["badTest", {}, ack10], next);
                expect(originalLoggers.error).toHaveBeenCalledWith(expect.stringContaining("Error with event: badTest"));
            }
        }
    });

    test("AutoUpdateServerManager.registerSocket events", async () => {
        const mockManager: any = {
            className: "Test",
            objectsAsArray: [{ _id: "o1" }],
            objectIDs: ["o1"],
            properties: ["p1"],
            options: {
                accessDefinitions: {
                    startupMiddleware: jest.fn()
                }
            },
            deleteObject: jest.fn().mockResolvedValue(undefined),
            createObject: jest.fn().mockResolvedValue({ extractedData: { _id: "new" } }),
            objects_: { "o1": { setValue: jest.fn().mockResolvedValue({ success: true, msg: "OK" }), extractedData: { _id: "o1" } } }
        };

        const manager = new AutoUpdateServerManager(
            class {} as any, "Test", loggers, mockSocketServer, mockModel, { Test: mockManager } as any, emitter, mockManager.options
        );
        
        const mockUpdateObj = { 
            setValue: jest.fn().mockResolvedValue({ success: true, msg: "Updated" }), 
            extractedData: { _id: "o1" },
            destroy: jest.fn().mockResolvedValue({ success: true }),
            callbacks: { delete: jest.fn() }
        };
        (manager as any).objects_ = { "o1": mockUpdateObj };

        const mockSocket: any = {
            on: jest.fn(),
            onAny: jest.fn(),
            emit: jest.fn(),
            id: "s1"
        };

        manager.registerSocket(mockSocket);

        // EVENT_STARTUP success
        const startupHandler = mockSocket.on.mock.calls.find(c => c[0] === "startupTest")?.[1];
        const ack1 = jest.fn();
        await startupHandler({}, ack1);
        expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // EVENT_DELETE success
        const ack4 = jest.fn();
        const deleteHandler = mockSocket.on.mock.calls.find(c => c[0] === "deleteTest")?.[1];
        await deleteHandler("o1", ack4);
        expect(ack4).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // EVENT_UPDATE via onAny
        const onAnyHandler = mockSocket.onAny.mock.calls.find(c => typeof c[0] === "function" || typeof c[1] === "function");
        const actualOnAny = typeof onAnyHandler[0] === "function" ? onAnyHandler[0] : onAnyHandler[1];
        
        const ack8 = jest.fn();
        const id24 = "123456789012345678901234";
        (manager as any).objects_[id24] = mockUpdateObj;
        await actualOnAny("updateTest" + id24, { key: "p1", value: "v1" }, ack8);
        expect(ack8).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: "Updated" }));

        // EVENT_GET via onAny
        const ack10 = jest.fn();
        await actualOnAny("getTest" + id24, {}, ack10);
        expect(ack10).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test("Misc methods and error paths", async () => {
        const manager = new AutoUpdateServerManager(
            class {} as any, "Test", loggers, mockSocketServer, mockModel, {} as any, emitter
        );
        
        // getObject
        expect(manager.getObject()).toBeNull();
        expect(manager.getObject("o1")).toBeUndefined();
        
        // objects and objectsAsArray
        expect(manager.objects).toEqual({});
        expect(manager.objectsAsArray).toEqual([]);

        // handleGetMissingObject error: No managers
        mockModel.findById.mockResolvedValueOnce({ _id: "someid" });
        (manager as any).managers = null;
        await expect(manager.handleGetMissingObject("someid")).rejects.toThrow("No managers.");

        // createObject error: No managers
        (manager as any).managers = null;
        await expect(manager.createObject({})).rejects.toThrow("No managers.");
    });

    test("readyLoggers compromise message", async () => {
        await AUSManagerFactory({}, loggers, mockSocketServer);
        loggers.warn("-_-");
        expect(originalLoggers.warn).toHaveBeenCalledWith("WE HAVE BEEN COMPROMISED!!!!!");
    });
});
