import { jest } from '@jest/globals';
import "reflect-metadata";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { EventEmitter } from "eventemitter3";

describe("AutoUpdatedClientObjectClass Comprehensive Tests", () => {
  class TestObject extends AutoUpdatedClientObject<TestObject> {
    public prop1: string = "";
    public prop2: number = 0;
    public ref1: string = "";
    public _id: string = "";
  }

  let mockSocket: any;
  let mockManager: any;
  let mockEmitter: any;
  let mockCallback: any;
  let loggers: any;

  beforeEach(() => {
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    mockManager = {
      managers: {},
      cache: { references: {} },
      deleteObject: jest.fn().mockResolvedValue({ success: true }),
      isLoaded: true
    };
    mockEmitter = new EventEmitter();
    mockCallback = {
      update: jest.fn(),
      delete: jest.fn(),
      new: jest.fn(),
      progress: jest.fn()
    };
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    Reflect.defineMetadata("props", ["prop1", "prop2", "ref1", "_id"], TestObject.prototype);
    Reflect.defineMetadata("isRef", true, TestObject.prototype, "ref1");
  });

  test("loadReferencesAsync success path", async () => {
    const data = { _id: "id1" };
    const obj = new (TestObject as any)(
        TestObject, mockSocket, data, loggers, "TestObject", mockManager, mockCallback, mockEmitter
    );
    (obj as any).toChangeOnParents = [];
    (obj as any).loadMissingReferences = jest.fn().mockResolvedValue(undefined);
    
    await (obj as any).loadReferencesAsync();
    expect((obj as any).isLoadingReferences).toBe(false);
  });

  test("setValue__ with 1:1 relationship (refsTo)", async () => {
    Reflect.defineMetadata("refsTo", "ParentClass:childProp", TestObject.prototype, "ref1");
    const data = { _id: "id1", ref1: "parent1" };
    const obj = new (TestObject as any)(
        TestObject, mockSocket, data, loggers, "TestObject", mockManager, mockCallback, mockEmitter
    );

    const mockParent = {
        getValue: jest.fn().mockReturnValue(null),
        setValue__: jest.fn().mockResolvedValue({ success: true, msg: "OK" }),
        _id: "parent1"
    };
    const parentManager = { getObject: jest.fn().mockReturnValue(mockParent) };
    mockManager.managers = { ParentClass: parentManager };

    (obj as any).isServer = true;
    (obj as any).data = data;
    const res = await (obj as any).setValue__("ref1", "parent1");
    expect(res).toEqual({ success: true, msg: "Successfully set ref1 to parent1" });
  });

  test("handleUpdateRequest error path", async () => {
    const data = { _id: "id1" };
    const obj = new (TestObject as any)(
        TestObject, mockSocket, data, loggers, "TestObject", mockManager, mockCallback, mockEmitter
    );

    (obj as any).setValue__ = jest.fn().mockRejectedValue(new Error("Update Fail"));

    const updateHandler = mockSocket.on.mock.calls.find((c: any) => c[0] && c[0].includes("update"))[1];
    const res = await updateHandler({ key: "prop1", value: "val" });

    expect(res).toEqual({ success: false, message: "Error applying update: Update Fail" });
  });
});
