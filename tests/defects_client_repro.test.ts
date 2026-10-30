import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { Socket } from "socket.io-client";
import {
  AUCManagerFactory,
  AutoUpdateClientManager,
} from "../AutoUpdateClientManagerClass.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import {
  DEMError,
  DEMErrorCode,
} from "../DEMErrors.js";
import {
  LoggersType,
  MongoId,
  ServerResponse,
} from "../CommonTypes.js";

interface TestData {
  _id: MongoId;
  name?: string;
}

class TestClientObject extends AutoUpdatedClientObject<TestData> {
  get _id(): MongoId {
    return (this.data as TestData)?._id;
  }
}

describe("DEM Client Library Defects Reproduction", () => {
  let mockSocket: Socket;
  let loggers: LoggersType;
  let errorLogs: string[];
  let emitter: EventEmitter;
  const managersToClose: AutoUpdateClientManager<any>[] = [];

  beforeEach(() => {
    errorLogs = [];
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn((msg: string) => {
        errorLogs.push(msg);
      }),
      warn: jest.fn(),
    };

    emitter = new EventEmitter();

    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
  });

  afterEach(() => {
    for (const manager of managersToClose) {
      manager.close();
    }
    managersToClose.length = 0;
  });

  test("Defect 1: AUCManagerFactory must reject on startup network/server error instead of swallowing it", async () => {
    (mockSocket.emit as unknown as jest.Mock).mockImplementation(
      (event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
        if (event === "startupTest") {
          cb({
            success: false,
            code: DEMErrorCode.STARTUP_FAILED,
            message: "Database connection failed during startup",
            data: undefined,
          });
        }
      },
    );

    // Prior to fix, AUCManagerFactory swallowed this error and resolved with empty managers.
    // It must reject with the startup error.
    await expect(
      AUCManagerFactory(
        { Test: TestClientObject },
        loggers,
        mockSocket,
        false,
        emitter,
      ),
    ).rejects.toThrow("Database connection failed during startup");
  });

  test("Defect 1 (Timeout): AUCManagerFactory must reject on startup timeout instead of swallowing it", async () => {
    // Socket emit never acknowledges, causing timeout
    (mockSocket.emit as unknown as jest.Mock).mockImplementation(() => {});

    const manager = new AutoUpdateClientManager(
      TestClientObject,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      {
        new: () => {},
        update: () => {},
        delete: () => {},
        progress: () => {},
      },
    );
    managersToClose.push(manager);

    // When loadFromServer times out, AUCManagerFactory must reject with TIMEOUT error
    await expect(
      AUCManagerFactory(
        { Test: TestClientObject },
        loggers,
        mockSocket,
        false,
        emitter,
        {},
        undefined,
        undefined,
        undefined,
        { startupTimeoutMs: 100 },
      ),
    ).rejects.toThrow("Timeout waiting for startup data");
  });

  test("Defect 2: Elapsed duration in failure log must not be negative", async () => {
    (mockSocket.emit as unknown as jest.Mock).mockImplementation(
      (event: string, _data: unknown, cb: (res: ServerResponse<unknown>) => void) => {
        if (event === "startupTest") {
          cb({
            success: false,
            code: DEMErrorCode.STARTUP_FAILED,
            message: "Server load failed",
            data: undefined,
          });
        }
      },
    );

    try {
      await AUCManagerFactory(
        { Test: TestClientObject },
        loggers,
        mockSocket,
        false,
        emitter,
      );
    } catch {
      // Expected rejection
    }

    // Inspect error logs for "Failed in -...ms"
    const failureLog = errorLogs.find((l) => l.includes("Failed in "));
    expect(failureLog).toBeDefined();

    // Must not contain negative duration like "Failed in -1793361648316ms"
    expect(failureLog).not.toMatch(/Failed in -\d+ms/);
    expect(failureLog).toMatch(/Failed in \d+ms/);
  });

  test("Defect 3: loadFromServer timeout must be configurable via options and manager property", async () => {
    // Socket emit never responds
    (mockSocket.emit as unknown as jest.Mock).mockImplementation(() => {});

    const manager = new AutoUpdateClientManager(
      TestClientObject,
      "Test",
      mockSocket,
      loggers,
      {},
      emitter,
      {
        new: () => {},
        update: () => {},
        delete: () => {},
        progress: () => {},
      },
      undefined,
      undefined,
      undefined,
      { startupTimeoutMs: 80 },
    );
    managersToClose.push(manager);

    const startTime = Date.now();
    await expect(manager.loadFromServer()).rejects.toThrow(DEMError);
    const elapsed = Date.now() - startTime;

    // Must have timed out according to the configured 80ms (with reasonable buffer), not 5000ms
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(1500);
  });
});
