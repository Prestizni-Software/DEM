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
jest.unstable_mockModule("../AutoUpdatedServerObjectClass.js", () => ({
    createAutoUpdatedClass: jest.fn()
}));

const { AUSManagerFactory, AutoUpdateServerManager, DEMEventTypes } = await import("../AutoUpdateServerManagerClass.js");
const { getModelForClass } = await import("@typegoose/typegoose");
const { createAutoUpdatedClass } = await import("../AutoUpdatedServerObjectClass.js");

describe("AutoUpdateServerManagerClass Full Coverage", () => {
    let logMock: any;
    let mockSocketServer: any;

    beforeEach(() => {
        jest.clearAllMocks();
        logMock = {
            info: (s: string) => {},
            debug: (s: string) => {},
            error: (s: string) => {},
            warn: (s: string) => {}
        };
        mockSocketServer = {
            use: jest.fn(),
            on: jest.fn(),
            emit: jest.fn(),
            disconnectSockets: jest.fn()
        };
    });

    test("AUSManagerFactory success and error paths", async () => {
        const defs = { Test: { class: class {} as any } };
        const errorSpy = jest.spyOn(logMock, 'error');
        const debugSpy = jest.spyOn(logMock, 'debug');
        
        // 1. Preload error
        mockModel.find.mockRejectedValueOnce(new Error("Preload Fail"));
        await AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Preload Fail"));

        // 2. Success path
        mockModel.find.mockResolvedValue([]);
        (getModelForClass as jest.Mock).mockReturnValue(mockModel);

        const managers = await AUSManagerFactory(defs, logMock, mockSocketServer, false, emitter);
        expect(managers.Test).toBeDefined();

        // Trigger connection
        const connectionHandler = mockSocketServer.on.mock.calls.find(c => c[0] === "connection")?.[1];
        if (connectionHandler) {
            const mockSocket: any = { id: "s1", on: jest.fn(), onAny: jest.fn(), handshake: { auth: {}, address: "127.0.0.1" } };
            await connectionHandler(mockSocket);
            expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Client connected: s1"));
            
            const disconnectHandlers = mockSocket.on.mock.calls.filter(c => c[0] === "disconnect").map(c => c[1]);
            disconnectHandlers.forEach(h => h());
            expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
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
            class {} as any, "Test", logMock, mockSocketServer, mockModel, {}, emitter
        );
        
        mockModel.find.mockResolvedValue([
            { _id: { toString: () => "doc1" } },
            { _id: { toString: () => "" } }
        ]);

        await manager.preLoad();
        expect(manager.getObject("doc1")).toBe(mockObj as any);
    });

    test("setupSocketMiddleware exhaustive paths", async () => {
        const id24 = "obj123456789012345678901234";
        const defs = { Test: { class: class { properties = []; } as any } };
        const mockModel: any = {
            find: jest.fn().mockResolvedValue([]),
        };
        (getModelForClass as jest.Mock).mockReturnValue(mockModel);

        const actualManagers = await AUSManagerFactory(defs, logMock, mockSocketServer, false, emitter);
        const manager = actualManagers.Test;
        
        const warnSpy = jest.spyOn(logMock, 'warn');
        const errorSpy = jest.spyOn(logMock, 'error');

        // Mock getObject on manager
        const mockObj = { _id: id24, extractedData: { data: 1 }, properties: [] };
        jest.spyOn(manager, 'getObject').mockReturnValue(mockObj as any);

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
                expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid event"));

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
                jest.spyOn(manager, 'getObject').mockReturnValueOnce(null);
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

                // 9. Access denied in eventMiddleware
                const ack9 = jest.fn();
                manager.options = {
                    accessDefinitions: {
                        eventMiddleware: jest.fn().mockRejectedValueOnce(new Error("No Way"))
                    }
                };
                await innerMiddleware(["newTest", {}, ack9], next);
                expect(ack9).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("No Way") }));

                // 10. Unknown event type in switch
                const ack10 = jest.fn();
                mockSocket.eventNames.mockReturnValue(["badTest"]);
                await innerMiddleware(["badTest", {}, ack10], next);
                expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error with event: badTest"));
            }
        }
    });

    test("AutoUpdateServerManager.registerSocket events", async () => {
        const manager = new AutoUpdateServerManager(
            class { properties = []; } as any, "Test", logMock, mockSocketServer, mockModel, {}, emitter
        );
        const mockSocket: any = { id: "s1", on: jest.fn(), onAny: jest.fn(), emit: jest.fn() };
        manager.registerSocket(mockSocket);

        // 1. EVENT_STARTUP success
        const startupHandler = mockSocket.on.mock.calls.find(c => c[0] === "startupTest")?.[1];
        const ack1 = jest.fn();
        await startupHandler({}, ack1);
        expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // 2. EVENT_STARTUP failure (startupMiddleware)
        const startupHandler2 = mockSocket.on.mock.calls.find(c => c[0] === "startupTest")?.[1];
        const ack2 = jest.fn();
        manager.options = { accessDefinitions: { startupMiddleware: jest.fn().mockRejectedValueOnce(new Error("Startup Fail")) } };
        await startupHandler2({}, ack2);
        expect(ack2).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Startup Fail" }));

        // 3. EVENT_DELETE handler (success in registerSocket)
        const deleteHandler = mockSocket.on.mock.calls.find(c => c[0] === "deleteTest")?.[1];
        const ack3 = jest.fn();
        jest.spyOn(manager, 'deleteObject').mockResolvedValueOnce({ success: true, message: "OK" });
        await deleteHandler("id1", ack3);
        expect(ack3).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // 4. EVENT_DELETE handler (failure)
        const deleteHandler2 = mockSocket.on.mock.calls.find(c => c[0] === "deleteTest")?.[1];
        const ack4 = jest.fn();
        jest.spyOn(manager, 'deleteObject').mockRejectedValueOnce(new Error("Delete Fail"));
        await deleteHandler2("id1", ack4);
        expect(ack4).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Delete Fail" }));

        // 5. EVENT_NEW handler (success)
        const newHandler = mockSocket.on.mock.calls.find(c => c[0] === "newTest")?.[1];
        const ack5 = jest.fn();
        const mockNewObj = { extractedData: { id: "new" } };
        jest.spyOn(manager, 'createObject').mockResolvedValueOnce(mockNewObj as any);
        await newHandler({}, ack5);
        expect(ack5).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // 6. EVENT_NEW handler (failure)
        const newHandler2 = mockSocket.on.mock.calls.find(c => c[0] === "newTest")?.[1];
        const ack6 = jest.fn();
        jest.spyOn(manager, 'createObject').mockRejectedValueOnce(new Error("New Fail"));
        await newHandler2({}, ack6);
        expect(ack6).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "New Fail" }));
    });

    test("Misc methods and error paths", async () => {
        const manager = new AutoUpdateServerManager(
            class {} as any, "Test", logMock, mockSocketServer, mockModel, {} as any, emitter
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
    });
});
