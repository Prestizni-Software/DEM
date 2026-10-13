import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";

const mockModel: any = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  db: {
    readyState: 0, // Disconnected initially
    name: "testdb",
    host: "localhost",
  },
};

const mockSocketServer: any = {
  use: jest.fn(),
  on: jest.fn(),
  emit: jest.fn(),
  disconnectSockets: jest.fn(),
};

jest.unstable_mockModule("@typegoose/typegoose", () => ({
  getModelForClass: jest.fn().mockReturnValue(mockModel),
}));

const {
  AUSManagerFactory,
  AutoUpdateServerManager,
  checkServerDbStates,
} = await import("../AutoUpdateServerManagerClass.js");
const { AutoUpdateClientManager } = await import(
  "../AutoUpdateClientManagerClass.js"
);
const {
  DEMError,
  DEMErrorCode,
  getDEMErrorDescription,
  toDEMError,
} = await import("../CommonTypes.js");

describe("DEM Server DB State Check and Error Codes System", () => {
  let logMock: any;
  let emitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockModel.find.mockResolvedValue([]);
    emitter = new EventEmitter();
    logMock = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  describe("Server DB State Checking Before Loading", () => {
    test("AUSManagerFactory throws DEM_ERR_DB_NOT_CONNECTED if database is disconnected (readyState 0)", async () => {
      mockModel.db.readyState = 0;
      const defs = { TestClass: { class: class {} as any } };

      await expect(
        AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter),
      ).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );

      // Crucial: find() must NOT have been called because loading should never start before DB state check
      expect(mockModel.find).not.toHaveBeenCalled();
    });

    test("AUSManagerFactory throws DEM_ERR_DB_NOT_CONNECTED if database is connecting (readyState 2)", async () => {
      mockModel.db.readyState = 2;
      const defs = { TestClass: { class: class {} as any } };

      await expect(
        AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter),
      ).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );

      expect(mockModel.find).not.toHaveBeenCalled();
    });

    test("AUSManagerFactory throws DEM_ERR_DB_NOT_CONNECTED if database is disconnecting (readyState 3)", async () => {
      mockModel.db.readyState = 3;
      const defs = { TestClass: { class: class {} as any } };

      await expect(
        AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter),
      ).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );

      expect(mockModel.find).not.toHaveBeenCalled();
    });

    test("AutoUpdateServerManager.preLoad throws DEM_ERR_DB_NOT_CONNECTED when called directly with disconnected DB", async () => {
      mockModel.db.readyState = 0;
      const manager = new AutoUpdateServerManager(
        class {} as any,
        "TestClass",
        mockSocketServer,
        logMock,
        mockModel,
        {},
        emitter,
      );

      await expect(manager.preLoad()).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );

      expect(mockModel.find).not.toHaveBeenCalled();
    });

    test("AUSManagerFactory succeeds and loads when database is connected (readyState 1)", async () => {
      mockModel.db.readyState = 1;
      const defs = { TestClass: { class: class {} as any } };

      const managers = await AUSManagerFactory(
        defs,
        logMock,
        mockSocketServer,
        true,
        emitter,
      );
      expect(managers.TestClass).toBeDefined();
      expect(mockModel.find).toHaveBeenCalled();
    });

    test("checkServerDbStates utility correctly inspects managers", async () => {
      mockModel.db.readyState = 1;
      const manager = new AutoUpdateServerManager(
        class {} as any,
        "TestClass",
        mockSocketServer,
        logMock,
        mockModel,
        {},
        emitter,
      );

      const status = manager.checkDbState();
      expect(status.connected).toBe(true);
      expect(status.stateName).toBe("connected");
      expect(status.readyState).toBe(1);

      mockModel.db.readyState = 0;
      const disconnectedStatus = manager.checkDbState();
      expect(disconnectedStatus.connected).toBe(false);
      expect(disconnectedStatus.stateName).toBe("disconnected");
      expect(disconnectedStatus.readyState).toBe(0);

      expect(() =>
        checkServerDbStates({ TestClass: manager }, logMock, emitter),
      ).toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );
    });
  });

  describe("Error Code Propagation and Communication", () => {
    test("DEMError includes code, message description, and timestamp", () => {
      const err = new DEMError(
        DEMErrorCode.MISSING_ARGUMENT,
        "Missing required argument: classParam",
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DEMError);
      expect(err.code).toBe(DEMErrorCode.MISSING_ARGUMENT);
      expect(err.message).toContain("Missing required argument: classParam");
      expect(err.message).toContain(DEMErrorCode.MISSING_ARGUMENT);
      expect(typeof err.timestamp).toBe("number");
    });

    test("getDEMErrorDescription returns human-readable description for any code", () => {
      const desc = getDEMErrorDescription(DEMErrorCode.DB_NOT_CONNECTED);
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    });

    test("Server manager emits 'error' on emitter for host systems to intercept", async () => {
      mockModel.db.readyState = 0;
      const errorListener = jest.fn();
      emitter.on("error", errorListener);

      const defs = { TestClass: { class: class {} as any } };
      await expect(
        AUSManagerFactory(defs, logMock, mockSocketServer, true, emitter),
      ).rejects.toThrow();

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          code: DEMErrorCode.DB_NOT_CONNECTED,
        }),
      );
    });

    test("Client manager constructor throws DEMError with MISSING_ARGUMENT", () => {
      expect(() => {
        new AutoUpdateClientManager(
          null as any,
          "TestClass",
          {} as any,
          logMock,
          {},
          emitter,
          {} as any,
        );
      }).toThrow(
        expect.objectContaining({
          code: DEMErrorCode.MISSING_ARGUMENT,
        }),
      );
    });

    test("Server manager handleGetMissingObject throws DEMError with DOCUMENT_NOT_FOUND", async () => {
      mockModel.findById.mockResolvedValueOnce(null);
      mockModel.db.readyState = 1;
      const manager = new AutoUpdateServerManager(
        class {} as any,
        "TestClass",
        mockSocketServer,
        logMock,
        mockModel,
        {},
        emitter,
      );

      await expect(
        manager.handleGetMissingObject("missing-id"),
      ).rejects.toThrow(
        expect.objectContaining({
          code: DEMErrorCode.DOCUMENT_NOT_FOUND,
        }),
      );
    });

    test("toDEMError wraps standard Error and preserves DEMError", () => {
      const standardErr = new Error("Something went wrong");
      const wrapped = toDEMError(standardErr, DEMErrorCode.INTERNAL_ERROR);
      expect(wrapped).toBeInstanceOf(DEMError);
      expect(wrapped.code).toBe(DEMErrorCode.INTERNAL_ERROR);
      expect(wrapped.message).toContain("Something went wrong");

      const existingDEMErr = new DEMError(
        DEMErrorCode.ACCESS_DENIED,
        "Unauthorized action",
      );
      const returned = toDEMError(existingDEMErr);
      expect(returned).toBe(existingDEMErr);
      expect(returned.code).toBe(DEMErrorCode.ACCESS_DENIED);
    });
  });
});
