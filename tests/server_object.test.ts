import { jest } from '@jest/globals';
import { Test } from "../ServerTypes.js";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";

describe("AutoUpdatedServerObjectClass Coverage", () => {
    let loggers: any;
    let mockSocket: any;
    let mockEmitter: any;
    let mockManager: any;

    beforeEach(() => {
        loggers = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
        mockSocket = { emit: jest.fn(), removeAllListeners: jest.fn() };
        mockEmitter = new EventEmitter();
        mockManager = {
            deleteObject: jest.fn(),
            managers: {
                Test: {
                    model: {
                        findOne: jest.fn(),
                        create: jest.fn(),
                        updateOne: jest.fn(),
                    }
                }
            },
            options: {
                onUpdate: jest.fn()
            }
        };
    });

    test("Constructor empty case", () => {
        const obj = new Test();
        expect(obj).toBeDefined();
    });

    test("Constructor missing arguments error", () => {
        expect(() => new Test(Test, {} as any, { _id: "123" } as any, null as any, "Test", null as any, null as any)).toThrow("Missing arguments???");
    });

    test("Constructor with ref objectId conversion", () => {
        const id = new ObjectId().toString();
        const obj = new Test(Test, mockSocket, { _id: "123", ref: id } as any, loggers, "Test", mockManager, mockEmitter);
        expect(obj['data'].ref).toBeInstanceOf(ObjectId);
    });

    test("Constructor with ref array objectId conversion", () => {
        const id = new ObjectId().toString();
        const obj = new Test(Test, mockSocket, { _id: "123", refarr: [id] } as any, loggers, "Test", mockManager, mockEmitter);
        expect(obj['data'].refarr[0]).toBeInstanceOf(ObjectId);
    });

    test("loadFromDB success findOne", async () => {
        const mockData = { _id: "123", active: true, toObject: () => ({ _id: "123", active: true }) };
        mockManager.managers.Test.model.findOne.mockResolvedValue(mockData);
        
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        await obj.loadFromDB();
        
        expect(mockManager.managers.Test.model.findOne).toHaveBeenCalled();
        expect(obj['data'].active).toBe(true);
    });

    test("loadFromDB success create", async () => {
        const mockData = { _id: "123", active: true, toObject: () => ({ _id: "123", active: true }) };
        mockManager.managers.Test.model.findOne.mockResolvedValue(null);
        mockManager.managers.Test.model.create.mockResolvedValue(mockData);
        
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        await obj.loadFromDB();
        
        expect(mockManager.managers.Test.model.create).toHaveBeenCalled();
        expect(obj['data'].active).toBe(true);
    });

    test("loadFromDB error", async () => {
        mockManager.managers.Test.model.findOne.mockRejectedValue(new Error("DB error"));
        
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        await expect(obj.loadFromDB()).rejects.toThrow("DB error");
        expect(loggers.error).toHaveBeenCalled();
    });

    test("setValue_ calls setValue__", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        const spy = jest.spyOn(obj as any, 'setValue__').mockResolvedValue({ success: true, msg: "OK" });
        
        const res = await (obj as any).setValue_("active", true);
        expect(res.success).toBe(true);
        expect(spy).toHaveBeenCalled();
    });

    test("handleNewObject throws", () => {
        const obj = new Test();
        expect(() => (obj as any).handleNewObject({})).toThrow("Cannot create new objects like this.");
    });

    test("setValueInternal success", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        mockManager.managers.Test.model.updateOne.mockResolvedValue({ acknowledged: true });
        
        const res = await (obj as any).setValueInternal("active", true);
        expect(res.success).toBe(true);
        expect(mockSocket.emit).toHaveBeenCalled();
    });

    test("setValueInternal failure", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        mockManager.managers.Test.model.updateOne.mockRejectedValue(new Error("Update failed"));
        
        const res = await (obj as any).setValueInternal("active", true);
        expect(res.success).toBe(false);
        expect(loggers.error).toHaveBeenCalled();
    });

    test("destroy(false) calls parentManager.deleteObject", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        mockManager.deleteObject.mockResolvedValue({ success: true, message: "Deleted" });
        
        const res = await obj.destroy(false);
        expect(res.success).toBe(true);
        expect(mockManager.deleteObject).toHaveBeenCalledWith("123");
    });

    test("destroy(true) success", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        const mockEntry = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
        (obj as any).entry = mockEntry;
        const spyWipe = jest.spyOn(obj as any, 'wipeSelf').mockResolvedValue(undefined);
        
        const res = await obj.destroy(true);
        expect(res.success).toBe(true);
        expect(mockSocket.emit).toHaveBeenCalledWith("deleteTest", "123");
        expect(spyWipe).toHaveBeenCalled();
    });

    test("destroy(true) failure", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        const mockEntry = { deleteOne: jest.fn().mockRejectedValue(new Error("DB error")) };
        (obj as any).entry = mockEntry;
        
        const res = await obj.destroy(true);
        expect(res.success).toBe(false);
        expect(res.message).toContain("Deletion uncussessful: DB error");
        expect(loggers.error).toHaveBeenCalled();
    });

    test("onUpdate method", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        const spySetValue = jest.spyOn(obj as any, 'setValue__').mockResolvedValue({ success: true, msg: "OK" });
        
        await obj.onUpdate();
        
        expect(mockManager.options.onUpdate).toHaveBeenCalled();
        // Trigger the callback
        const callback = mockManager.options.onUpdate.mock.calls[0][1];
        await callback("active", true);
        expect(spySetValue).toHaveBeenCalled();
    });
    
    test("onUpdate with noUpdate = true", async () => {
        const obj = new Test(Test, mockSocket, { _id: "123" } as any, loggers, "Test", mockManager, mockEmitter);
        await obj.onUpdate(true);
        expect(mockManager.options.onUpdate).not.toHaveBeenCalled();
    });
});
