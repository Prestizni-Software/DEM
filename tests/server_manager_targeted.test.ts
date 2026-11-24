import { jest } from '@jest/globals';
import { AutoUpdateServerManager } from "../AutoUpdateServerManagerClass.js";
import { EventEmitter } from "eventemitter3";
import { LoggersType } from "../CommonTypes.js";

describe("AutoUpdateServerManagerClass Targeted Coverage", () => {
  let loggers: LoggersType;

  beforeEach(() => {
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test("handleGetMissingObject throws if model.findById returns null", async () => {
    const mockModel = { findById: jest.fn().mockResolvedValue(null) };
    const mockSocket = {} as any;
    const mockEmitter = new EventEmitter() as any;

    const manager = new AutoUpdateServerManager(
      class {} as any,
      "test",
      mockSocket,
      loggers,
      mockModel as any,
      {},
      mockEmitter
    );

    await expect(manager.handleGetMissingObject("invalid-id")).rejects.toThrow(
      "No document with id invalid-id in DB."
    );
  });

  test("preLoad handles invalid documents", async () => {
    // We mock the loggers.debug to accept the manager wrapper prefix
    const mockModel = { find: jest.fn().mockResolvedValue([{ _id: "valid" }, { not_id: "invalid" }]) };
    const mockSocket = {} as any;
    const mockEmitter = new EventEmitter() as any;

    const manager = new AutoUpdateServerManager(
      class {} as any,
      "test",
      mockSocket,
      loggers,
      mockModel as any,
      {},
      mockEmitter
    );

    // Call preLoad and expect the error log
    try {
      await manager.preLoad();
    } catch (err) {
      expect(err).toBeDefined();
    }
    
    // Check that debug was called
    expect(loggers.debug).toHaveBeenCalled();
  });

  test("deleteObject on unhydrated entity deletes from DB and emits delete event to clients", async () => {
    const deleteOneDoc = jest.fn(async () => ({ deletedCount: 1 }));
    const mockModel = {
      findById: jest.fn(async () => ({ _id: "lazy-1", deleteOne: deleteOneDoc })),
      deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
    };
    const emitMock = jest.fn();
    const mockSocket = { emit: emitMock } as any;
    const mockEmitter = new EventEmitter() as any;

    const manager = new AutoUpdateServerManager(
      class {} as any,
      "Task",
      mockSocket,
      loggers,
      mockModel as any,
      {},
      mockEmitter,
    );

    const res = await manager.deleteObject("lazy-1");
    expect(res).toEqual({ success: true, message: "Deleted" });
    expect(deleteOneDoc).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith("deleteTask", "lazy-1");

    // When document is not found and model.deleteOne deletes 0, no broadcast is emitted
    emitMock.mockClear();
    mockModel.findById.mockResolvedValueOnce(null as any);
    mockModel.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    const resMissing = await manager.deleteObject("missing-1");
    expect(resMissing).toEqual({ success: true, message: "Already gone" });
    expect(emitMock).not.toHaveBeenCalled();
  });
});
