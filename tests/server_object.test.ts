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
            managers: {
                Subordinate: {
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
        mockManager.managers.Subordinate.model.findOne.mockResolvedValue(mockData);
        
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        await obj.loadFromDB();
        
        expect(mockManager.managers.Subordinate.model.findOne).toHaveBeenCalled();
        expect(obj['data'].name).toBe("TestSub");
    });

    test("setValueInternal success", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        mockManager.managers.Subordinate.model.updateOne.mockResolvedValue({ acknowledged: true });
        
        const res = await (obj as any).setValueInternal("name", "NewName");
        expect(res.success).toBe(true);
        expect(mockSocket.emit).toHaveBeenCalled();
    });

    test("destroy(true) success", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        const mockEntry = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
        (obj as any).entry = mockEntry;
        const spyWipe = jest.spyOn(obj as any, 'wipeSelf').mockResolvedValue(undefined);
        
        const res = await obj.destroy(true);
        expect(res.success).toBe(true);
        expect(mockSocket.emit).toHaveBeenCalledWith("deleteSubordinate", "123");
        expect(spyWipe).toHaveBeenCalled();
    });
});
