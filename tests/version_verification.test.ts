import { jest } from "@jest/globals";
import {
  DEM_VERSION,
  DEM_PROTOCOL_VERSION,
  parseSemVer,
  compareSemVer,
  verifyDEMVersion,
  DEMVersionOptions,
  ServerResponse,
} from "../CommonTypes.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { EventEmitter } from "eventemitter3";

describe("DEM Version Verification System", () => {
  describe("parseSemVer", () => {
    test("parses standard semantic versions", () => {
      expect(parseSemVer("0.6.5")).toEqual({ major: 0, minor: 6, patch: 5, prerelease: undefined });
      expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
      expect(parseSemVer("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30, prerelease: undefined });
    });

    test("handles 'v' prefix and whitespace", () => {
      expect(parseSemVer("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
      expect(parseSemVer("  v2.0.0  ")).toEqual({ major: 2, minor: 0, patch: 0, prerelease: undefined });
    });

    test("handles 2-part versions (defaulting patch to 0)", () => {
      expect(parseSemVer("1.0")).toEqual({ major: 1, minor: 0, patch: 0, prerelease: undefined });
    });

    test("handles prerelease tags", () => {
      expect(parseSemVer("1.0.0-alpha.1")).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: "alpha.1",
      });
    });

    test("returns null for invalid strings", () => {
      expect(parseSemVer("")).toBeNull();
      expect(parseSemVer("invalid")).toBeNull();
      expect(parseSemVer(null as any)).toBeNull();
      expect(parseSemVer(undefined as any)).toBeNull();
    });
  });

  describe("compareSemVer", () => {
    test("correctly identifies equal versions", () => {
      expect(compareSemVer("1.0.0", "1.0.0")).toBe(0);
      expect(compareSemVer("v1.2.3", "1.2.3")).toBe(0);
    });

    test("correctly compares major, minor, and patch", () => {
      expect(compareSemVer("2.0.0", "1.9.9")).toBe(1);
      expect(compareSemVer("1.0.0", "2.0.0")).toBe(-1);
      expect(compareSemVer("1.2.0", "1.1.9")).toBe(1);
      expect(compareSemVer("1.1.0", "1.2.0")).toBe(-1);
      expect(compareSemVer("1.1.2", "1.1.1")).toBe(1);
      expect(compareSemVer("1.1.1", "1.1.2")).toBe(-1);
    });

    test("handles invalid versions safely", () => {
      expect(compareSemVer("invalid", "1.0.0")).toBe(-1);
      expect(compareSemVer("1.0.0", "invalid")).toBe(1);
      expect(compareSemVer("invalid1", "invalid2")).toBe(0);
    });
  });

  describe("verifyDEMVersion", () => {
    test("accepts exact version match", () => {
      const res = verifyDEMVersion("0.6.5", "0.6.5");
      expect(res.compatible).toBe(true);
      expect(res.status).toBe("match");
    });

    test("accepts compatible patch difference", () => {
      const res = verifyDEMVersion("0.6.5", "0.6.2");
      expect(res.compatible).toBe(true);
      expect(res.status).toBe("compatible_patch");
    });

    test("accepts compatible minor difference in default (loose) mode", () => {
      const res = verifyDEMVersion("0.7.0", "0.6.5");
      expect(res.compatible).toBe(true);
      expect(res.status).toBe("compatible_minor");
    });

    test("rejects minor difference when strictVersionMatch is true", () => {
      const res = verifyDEMVersion("0.7.0", "0.6.5", { strictVersionMatch: true });
      expect(res.compatible).toBe(false);
      expect(res.status).toBe("mismatch_minor");
      expect(res.message).toContain("Strict version check failed");
    });

    test("rejects incompatible major difference", () => {
      const res = verifyDEMVersion("1.0.0", "2.0.0");
      expect(res.compatible).toBe(false);
      expect(res.status).toBe("mismatch_major");
      expect(res.message).toContain("Incompatible major DEM version");
    });

    test("checks minServerVersion", () => {
      const options: DEMVersionOptions = { minServerVersion: "0.6.0" };
      const resPass = verifyDEMVersion("0.6.5", "0.6.2", options);
      expect(resPass.compatible).toBe(true);

      const resFail = verifyDEMVersion("0.6.5", "0.5.9", options);
      expect(resFail.compatible).toBe(false);
      expect(resFail.status).toBe("below_min_version");
      expect(resFail.message).toContain("lower than required minimum");
    });

    test("supports custom validateVersion callback", () => {
      const customValidatorPass = (_client: string, _server: string) => true;
      const res1 = verifyDEMVersion("1.0.0", "2.0.0", { validateVersion: customValidatorPass });
      expect(res1.compatible).toBe(true);
      expect(res1.status).toBe("match");

      const customValidatorFail = (_client: string, _server: string) =>
        "Custom policy: client version too old";
      const res2 = verifyDEMVersion("0.6.0", "0.6.5", { validateVersion: customValidatorFail });
      expect(res2.compatible).toBe(false);
      expect(res2.status).toBe("custom_rejected");
      expect(res2.message).toBe("Custom policy: client version too old");
    });
  });

  describe("Client Manager loadFromServer Version Verification", () => {
    class MockClientItem {
      public _id!: string;
      public name!: string;
    }
    Reflect.defineMetadata("props", ["_id", "name"], MockClientItem.prototype);

    const mockLoggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("handles matching server version gracefully", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: any, cb: (res: any) => void) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["_id", "name"],
                version: DEM_VERSION,
                protocolVersion: DEM_PROTOCOL_VERSION,
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      } as any;

      const clientManager = new AutoUpdateClientManager(
        MockClientItem as any,
        "MockItem",
        mockSocket,
        mockLoggers as any,
        {} as any,
        new EventEmitter(),
        {},
      );

      await expect(clientManager.loadFromServer()).resolves.toBeUndefined();
      expect(mockLoggers.error).not.toHaveBeenCalled();
    });

    test("logs warning on minor version difference and triggers onVersionMismatch callback", async () => {
      const onMismatch = jest.fn();
      const mockSocket = {
        emit: jest.fn((event: string, _data: any, cb: (res: any) => void) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["_id", "name"],
                version: "0.5.0",
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      } as any;

      const clientManager = new AutoUpdateClientManager(
        MockClientItem as any,
        "MockItem",
        mockSocket,
        mockLoggers as any,
        {} as any,
        new EventEmitter(),
        {},
        {
          onVersionMismatch: onMismatch,
        },
      );

      await expect(clientManager.loadFromServer()).resolves.toBeUndefined();
      expect(mockLoggers.warn).toHaveBeenCalled();
      expect(onMismatch).toHaveBeenCalledWith(
        DEM_VERSION,
        "0.5.0",
        expect.stringContaining("DEM minor version notice"),
      );
    });

    test("rejects startup when strictVersionMatch is enabled and versions differ", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: any, cb: (res: any) => void) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["_id", "name"],
                version: "0.5.0",
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      } as any;

      const clientManager = new AutoUpdateClientManager(
        MockClientItem as any,
        "MockItem",
        mockSocket,
        mockLoggers as any,
        {} as any,
        new EventEmitter(),
        {},
        {
          strictVersionMatch: true,
        },
      );

      await expect(clientManager.loadFromServer()).rejects.toThrow(
        /Strict version check failed/,
      );
      expect(mockLoggers.error).toHaveBeenCalled();
    });

    test("allows connection to legacy server without version in loose mode, rejects in strict mode", async () => {
      const mockSocket = {
        emit: jest.fn((event: string, _data: any, cb: (res: any) => void) => {
          if (event.startsWith("startup")) {
            cb({
              success: true,
              data: {
                ids: [],
                properties: ["_id", "name"],
              },
            });
          }
        }),
        off: jest.fn(),
        on: jest.fn(),
      } as any;

      // Loose mode
      const looseManager = new AutoUpdateClientManager(
        MockClientItem as any,
        "MockItem",
        mockSocket,
        mockLoggers as any,
        {} as any,
        new EventEmitter(),
        {},
      );
      await expect(looseManager.loadFromServer()).resolves.toBeUndefined();

      // Strict mode
      const strictManager = new AutoUpdateClientManager(
        MockClientItem as any,
        "MockItem",
        mockSocket,
        mockLoggers as any,
        {} as any,
        new EventEmitter(),
        {},
        {
          strictVersionMatch: true,
        },
      );
      await expect(strictManager.loadFromServer()).rejects.toThrow(
        /Strict DEM version match required/,
      );
    });
  });
});
