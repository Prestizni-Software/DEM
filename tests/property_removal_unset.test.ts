import { jest } from "@jest/globals";
import { Subordinate } from "./testData/ServerClasses/index.js";
import { EventEmitter } from "eventemitter3";

describe("Property Removal via setValue(key, undefined) with MongoDB $unset", () => {
  let loggers: any;
  let mockSocket: any;
  let mockEmitter: any;
  let mockManager: any;

  beforeEach(() => {
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    mockSocket = { emit: jest.fn(), removeAllListeners: jest.fn() };
    mockEmitter = new EventEmitter();
    mockManager = {
      deleteObject: jest.fn(),
      model: {
        findOne: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
      },
      managers: {},
      options: {
        onUpdate: jest.fn(),
        onDeletion: jest.fn(),
      },
    };
    mockManager.managers.Subordinate = mockManager;
  });

  test("setValueInternal with undefined top-level property translates to MongoDB $unset", async () => {
    const obj = new Subordinate(
      Subordinate,
      mockSocket,
      { _id: "sub-1", name: "InitialName" } as any,
      loggers,
      "Subordinate",
      mockManager,
      mockEmitter,
    );
    const mockEntry = { name: "InitialName", save: jest.fn().mockResolvedValue({}) };
    mockManager.model.findById.mockResolvedValue(mockEntry);

    const res = await (obj as any).setValueInternal("name", undefined);
    expect(res.success).toBe(true);

    // Verify $unset was passed to updateOne
    expect(mockManager.model.updateOne).toHaveBeenCalledWith(
      { _id: "sub-1" },
      { $unset: { name: "" } },
    );

    // Verify data and entry no longer have 'name'
    expect("name" in (obj as any).data).toBe(false);
    expect((obj as any).data.name).toBeUndefined();
    expect("name" in mockEntry).toBe(false);
  });

  test("setValueInternal with undefined nested property translates to MongoDB $unset with dot notation", async () => {
    const obj = new Subordinate(
      Subordinate,
      mockSocket,
      { _id: "sub-2", metadata: { label: "OldLabel", active: true } } as any,
      loggers,
      "Subordinate",
      mockManager,
      mockEmitter,
    );
    const mockEntry = {
      metadata: { label: "OldLabel", active: true },
      save: jest.fn().mockResolvedValue({}),
    };
    mockManager.model.findById.mockResolvedValue(mockEntry);

    const res = await (obj as any).setValueInternal("metadata.label", undefined);
    expect(res.success).toBe(true);

    // Verify dot-notation $unset
    expect(mockManager.model.updateOne).toHaveBeenCalledWith(
      { _id: "sub-2" },
      { $unset: { "metadata.label": "" } },
    );

    // Verify nested property removed, sibling property preserved
    expect((obj as any).data.metadata.label).toBeUndefined();
    expect((obj as any).data.metadata.active).toBe(true);
    expect(mockEntry.metadata.label).toBeUndefined();
    expect(mockEntry.metadata.active).toBe(true);
  });
});
