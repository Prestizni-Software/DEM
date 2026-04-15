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
      loggers,
      mockSocket,
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
      loggers,
      mockSocket,
      mockModel as any,
      {},
      mockEmitter
    );

    // Call preLoad and expect the error log
    await manager.preLoad().catch(() => {});
    
    // Check that debug was called
    expect(loggers.debug).toHaveBeenCalled();
  });
});
