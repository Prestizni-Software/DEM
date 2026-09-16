import { jest } from '@jest/globals';
import { Subordinate } from "./testData/ServerClasses/index.js";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";

describe("AutoUpdatedServerObjectClass Coverage with Subordinate", () => {
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
            model: {
                findOne: jest.fn(),
                findById: jest.fn(),
                create: jest.fn(),
                updateOne: jest.fn(),
            },
            managers: {
                Subordinate: null as any
            },
            options: {
                onUpdate: jest.fn(),
                onDeletion: jest.fn()
            }
        };
        mockManager.managers.Subordinate = mockManager;
    });

    test("Constructor empty case", () => {
        const obj = new Subordinate();
        expect(obj).toBeDefined();
    });

    test("Constructor with ref objectId conversion", () => {
        const id = new ObjectId().toString();
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123", onSite: id } as any, loggers, "Subordinate", mockManager, mockEmitter);
        expect(obj['data'].onSite).toBeInstanceOf(ObjectId);
    });

    test("Constructor with ref array objectId conversion", () => {
        const id = new ObjectId().toString();
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123", company: [id] } as any, loggers, "Subordinate", mockManager, mockEmitter);
        expect(obj['data'].company[0]).toBeInstanceOf(ObjectId);
    });

    test("loadFromDB success findOne", async () => {
        const mockData = { _id: "123", name: "TestSub", toObject: () => ({ _id: "123", name: "TestSub" }) };
        mockManager.model.findById.mockResolvedValue(mockData);
        
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        await obj.loadFromDB();
        
        expect(mockManager.model.findById).toHaveBeenCalled();
        expect(obj['data'].name).toBe("TestSub");
    });

    test("setValueInternal success", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        const mockEntry = { save: jest.fn().mockResolvedValue({}) };
        mockManager.model.findById.mockResolvedValue(mockEntry);
        
        const res = await (obj as any).setValueInternal("name", "NewName");
        expect(res.success).toBe(true);
        expect(mockSocket.emit).toHaveBeenCalled();
    });

    test("destroy(true) calls onDeletion", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        const mockEntry = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
        (obj as any).entry = mockEntry;
        jest.spyOn(obj as any, 'wipeSelf').mockResolvedValue(undefined);
        
        await obj.destroy(true);
        expect(mockManager.options.onDeletion).toHaveBeenCalledWith(obj);
    });
});
