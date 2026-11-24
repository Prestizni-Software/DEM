import { jest } from '@jest/globals';
import { Subordinate } from "./testData/ServerClasses/index.js";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";
import { DEMError, DEMErrorCode } from "../DEMErrors.js";
import { createAutoUpdatedClass } from "../AutoUpdatedServerObjectClass.js";

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
        
        const res = await obj.destroy(true);
        expect(res).toEqual({ success: true, message: "Deleted" });
        expect(mockManager.options.onDeletion).toHaveBeenCalledWith(obj);
        expect(mockEntry.deleteOne).toHaveBeenCalledTimes(1);
        expect(mockSocket.emit).toHaveBeenCalledWith("deleteSubordinate", "123");
    });

    test("Constructor throws DEMError when partial arguments are provided", () => {
        expect(() => new Subordinate(Subordinate as any, mockSocket, undefined as any, loggers, "Subordinate", mockManager, mockEmitter)).toThrow(DEMError);
    });

    test("loadFromDB rejects on missing _id or missing DB document and caches loadPromise", async () => {
        const noIdObj = new Subordinate(Subordinate, mockSocket, {} as any, loggers, "Subordinate", mockManager, mockEmitter);
        await expect(noIdObj.loadFromDB()).rejects.toThrow(DEMError);

        mockManager.model.findById.mockResolvedValueOnce(null);
        const missingObj = new Subordinate(Subordinate, mockSocket, { _id: "999" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        await expect(missingObj.loadFromDB()).rejects.toThrow(DEMError);

        mockManager.model.findById.mockClear();
        const doc = { _id: "123", name: "Once" };
        mockManager.model.findById.mockResolvedValueOnce(doc);
        const cachedObj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        await Promise.all([cachedObj.loadFromDB(), cachedObj.loadFromDB()]);
        expect(mockManager.model.findById).toHaveBeenCalledTimes(1);
        expect(cachedObj['data'].name).toBe("Once");
    });

    test("setValueInternal rejects prototype pollution keys including dotted paths", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        for (const badKey of ["__proto__", "constructor", "prototype", "nested.__proto__.x", "a.constructor.b"]) {
            const res = await (obj as any).setValueInternal(badKey, "evil");
            expect(res.success).toBe(false);
            expect(res.code).toBe(DEMErrorCode.INVALID_ARGUMENT);
        }
    });

    test("setValueInternal updates entry BEFORE calling entry.save() fallback and handles unset/dotted paths/errors", async () => {
        mockManager.model.updateOne = undefined;
        let savedNameAtSaveTime: any = null;
        const mockEntry: any = {
            _id: "123",
            name: "Old",
            nested: { a: 1 },
            save: jest.fn(async function (this: any) {
                savedNameAtSaveTime = this.name;
            }),
        };
        mockManager.model.findById.mockResolvedValue(mockEntry);
        mockManager.changeTracker = { recordChange: jest.fn(), getCurrentRevision: jest.fn(() => 5) };
        mockManager.checkPermissionBoundaries = jest.fn(async () => {});

        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123", name: "Old", nested: { a: 1 } } as any, loggers, "Subordinate", mockManager, mockEmitter);
        const res = await (obj as any).setValueInternal("name", "Updated");
        expect(res).toEqual({ success: true, msg: "Success" });
        expect(savedNameAtSaveTime).toBe("Updated");
        expect(mockManager.changeTracker.recordChange).toHaveBeenCalledWith("update", "123", { name: "Updated" });
        expect(mockManager.checkPermissionBoundaries).toHaveBeenCalledWith(obj);

        // Dotted set and unset
        await (obj as any).setValueInternal("nested.a", 2);
        expect(mockEntry.nested.a).toBe(2);
        expect((obj as any).data.nested.a).toBe(2);

        await (obj as any).setValueInternal("nested.a", undefined);
        expect(mockEntry.nested.a).toBeUndefined();
        expect((obj as any).data.nested.a).toBeUndefined();

        // Error path when DB findById returns null
        const missingObj = new Subordinate(Subordinate, mockSocket, { _id: "404" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        mockManager.model.findById.mockResolvedValueOnce(null);
        const failRes = await (missingObj as any).setValueInternal("name", "X");
        expect(failRes.success).toBe(false);
        expect(failRes.code).toBe(DEMErrorCode.OBJECT_NOT_FOUND);
    });

    test("mutateArray executes push, pop, shift, unshift, splice, set, reverse, sort, clear, and tracks revisions", async () => {
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123", tags: ["b", "a"] } as any, loggers, "Subordinate", mockManager, mockEmitter);
        (obj as any).entry = { _id: "123", tags: ["b", "a"] };
        mockManager.changeTracker = {
            rev: 10,
            recordChange: jest.fn(function (this: any) { this.rev += 1; }),
            getCurrentRevision: jest.fn(function (this: any) { return this.rev; }),
        };

        let res = await obj.mutateArray("tags", { op: "push", items: ["c"] } as any, false);
        expect(res.success).toBe(true);
        expect(res.updatedArray).toEqual(["b", "a", "c"]);
        expect(res.newRevision).toBe(11);
        expect(res.newHash).toBe("b,a,c");

        res = await obj.mutateArray("tags", { op: "sort" } as any, false);
        expect(res.updatedArray).toEqual(["a", "b", "c"]);

        res = await obj.mutateArray("tags", { op: "reverse" } as any, false);
        expect(res.updatedArray).toEqual(["c", "b", "a"]);

        res = await obj.mutateArray("tags", { op: "pop" } as any, false);
        expect(res.updatedArray).toEqual(["c", "b"]);

        res = await obj.mutateArray("tags", { op: "shift" } as any, false);
        expect(res.updatedArray).toEqual(["b"]);

        res = await obj.mutateArray("tags", { op: "unshift", items: ["x", "y"] } as any, false);
        expect(res.updatedArray).toEqual(["x", "y", "b"]);

        // Element-anchored set (found and not found)
        res = await obj.mutateArray("tags", { op: "set", targetId: "y", items: ["Y"] } as any, false);
        expect(res.updatedArray).toEqual(["x", "Y", "b"]);

        res = await obj.mutateArray("tags", { op: "set", targetId: "missing", index: 0, items: ["NOOP"] } as any, false);
        expect(res.updatedArray).toEqual(["x", "Y", "b"]);

        // Element-anchored splice (found and not found)
        res = await obj.mutateArray("tags", { op: "splice", targetId: "Y", deleteCount: 1, items: ["Z"] } as any, false);
        expect(res.updatedArray).toEqual(["x", "Z", "b"]);

        res = await obj.mutateArray("tags", { op: "splice", targetId: "missing", index: 1, deleteCount: 1, items: ["INS"] } as any, false);
        expect(res.updatedArray).toEqual(["x", "INS", "Z", "b"]);

        res = await obj.mutateArray("tags", { op: "clear" } as any, false);
        expect(res.updatedArray).toEqual([]);
        expect(res.newHash).toBe("");
    });

    test("destroy handles missing _id, once=false delegation, and DB error", async () => {
        const noId = new Subordinate(Subordinate, mockSocket, {} as any, loggers, "Subordinate", mockManager, mockEmitter);
        expect(await noId.destroy(true)).toEqual({ success: false, message: "Missing _id" });

        mockManager.deleteObject.mockResolvedValueOnce({ success: true, message: "Delegated" });
        const obj = new Subordinate(Subordinate, mockSocket, { _id: "123" } as any, loggers, "Subordinate", mockManager, mockEmitter);
        expect(await obj.destroy(false)).toEqual({ success: true, message: "Delegated" });
        expect(mockManager.deleteObject).toHaveBeenCalledWith("123");

        (obj as any).entry = { deleteOne: jest.fn(async () => { throw new Error("DB crash"); }) };
        const errRes = await obj.destroy(true);
        expect(errRes.success).toBe(false);
        expect(errRes.message).toContain("DB crash");
    });

    test("save(), getRawExtractedData(), extractedData, onUpdate(), and createAutoUpdatedClass()", async () => {
        const docSave = jest.fn(async () => {});
        const doc: any = { _id: "507f1f77bcf86cd799439011", name: "DocName", toObject: () => ({ _id: "507f1f77bcf86cd799439011", name: "DocName" }), save: docSave };
        const obj = await createAutoUpdatedClass(Subordinate, "Subordinate", mockSocket, { _id: "507f1f77bcf86cd799439011" } as any, loggers, mockManager, mockEmitter, doc);
        expect((obj as any).data.name).toBe("DocName");

        await obj.save();
        expect(docSave).toHaveBeenCalledTimes(1);

        const raw1 = obj.getRawExtractedData();
        const raw2 = obj.getRawExtractedData();
        expect(raw1).toBe(raw2);
        const cloned = obj.extractedData;
        expect(cloned).toEqual(raw1);
        expect(cloned).not.toBe(raw1);

        mockManager.checkPermissionBoundaries = jest.fn(async () => {});
        await (obj as any).onUpdate(true, "name");
        expect(mockManager.options.onUpdate).not.toHaveBeenCalled();

        await (obj as any).onUpdate(false, "name");
        expect(mockManager.options.onUpdate).toHaveBeenCalledTimes(1);
        expect(mockManager.checkPermissionBoundaries).toHaveBeenCalledWith(obj);
    });
});
