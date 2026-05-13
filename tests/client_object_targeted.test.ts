import { jest } from '@jest/globals';
import "reflect-metadata";
import { Subordinate } from "./testData/ClientClasses/index.js";
import { EventEmitter } from "eventemitter3";

describe("AutoUpdatedClientObjectClass Comprehensive Tests with Subordinate", () => {
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
  });

  test("loadReferencesAsync success path", async () => {
    const data = { _id: "id1" };
    const obj = new (Subordinate as any)(
        Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );
    (obj as any).toChangeOnParents = [];
    (obj as any).loadMissingReferences = jest.fn().mockResolvedValue(undefined);
    
    await (obj as any).loadReferencesAsync();
    expect((obj as any).isLoadingReferences).toBe(false);
  });

  test("setValue__ from client success", async () => {
    const data = { _id: "id1", name: "OldName" };
    const obj = new (Subordinate as any)(
        Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );

    mockSocket.emit.mockImplementation((event: string, data: any, ack: any) => {
        if (ack) ack({ success: true, data: "NewName" });
    });

    const res = await obj.setValue("name", "NewName");
    expect(res).toBe(true);
    expect(obj.name).toBe("NewName");
  });

  test("destroy from client calls parentManager.deleteObject", async () => {
    const data = { _id: "id1" };
    const obj = new (Subordinate as any)(
        Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );
    
    await obj.destroy();
    expect(mockManager.deleteObject).toHaveBeenCalledWith("id1");
  });
});
