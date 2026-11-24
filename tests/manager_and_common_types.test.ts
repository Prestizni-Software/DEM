import { jest } from "@jest/globals";
import EventEmitter3 from "eventemitter3";
import { AutoUpdateManager } from "../AutoUpdateManagerClass.js";
import {
  compareSemVer,
  DEMGlobalCache,
  globalCache,
  parseSemVer,
  safeStringify,
  verifyDEMVersion,
} from "../CommonTypes.js";
import { DEMError, DEMErrorCode } from "../DEMErrors.js";

class ConcreteManager extends AutoUpdateManager<any, any> {
  protected objects_: { [_id: string]: any } = {};
  public get objectsAsArray(): any[] {
    return Object.values(this.objects_);
  }
  public getObject(_id: any): any {
    return this.objects_[_id.toString()];
  }
  public async handleGetMissingObject(_id: any): Promise<any> {
    return this.objects_[_id.toString()];
  }
  public setObject(id: string, obj: any) {
    this.objects_[id] = obj;
  }
  public getLoggers() {
    return this.loggers;
  }
}

describe("AutoUpdateManagerClass and CommonTypes", () => {
  beforeEach(() => {
    globalCache.clear();
  });

  describe("AutoUpdateManager", () => {
    test("throws DEMError with MISSING_ARGUMENT when classParam is missing", () => {
      expect(
        () =>
          new ConcreteManager(
            null as any,
            "Sample",
            {},
            {},
            {},
            new EventEmitter3(),
          ),
      ).toThrow(DEMError);

      try {
        new ConcreteManager(
          undefined as any,
          "Sample",
          {},
          {},
          {},
          new EventEmitter3(),
        );
      } catch (err: any) {
        expect(err).toBeInstanceOf(DEMError);
        expect(err.code).toBe(DEMErrorCode.MISSING_ARGUMENT);
        expect(err.message).toContain("Missing required argument: classParam");
      }
    });

    test("initializes defaults, prefixes logger messages, and loads references", async () => {
      const info = jest.fn();
      const debug = jest.fn();
      const warn = jest.fn();
      const error = jest.fn();

      class DummyEntity {}
      const manager = new ConcreteManager(
        DummyEntity,
        "Widget",
        {},
        { info, debug, warn, error },
        {},
        new EventEmitter3(),
      );

      expect(manager.isLoaded).toBe(false);
      expect(manager.cache.references).toEqual({});

      manager.getLoggers().info!("hello");
      manager.getLoggers().debug!("dbg");
      manager.getLoggers().warn!("wrn");
      manager.getLoggers().error!("err");
      expect(info).toHaveBeenCalledWith("[DEM - Widget MANAGER] hello");
      expect(debug).toHaveBeenCalledWith("[DEM - Widget MANAGER] dbg");
      expect(warn).toHaveBeenCalledWith("[DEM - Widget MANAGER] wrn");
      expect(error).toHaveBeenCalledWith("[DEM - Widget MANAGER] err");

      const loadMissingReferences = jest.fn(async () => {});
      manager.setObject("w1", { loadMissingReferences });
      await manager.loadReferences();
      expect(loadMissingReferences).toHaveBeenCalledTimes(1);
      expect(manager.isLoaded).toBe(true);
    });

    test("close clears objects, globalCache, and disconnects client or server socket", () => {
      const disconnect = jest.fn();
      const info = jest.fn();
      const manager = new ConcreteManager(
        class {},
        "Widget",
        { disconnect },
        { info },
        {},
        new EventEmitter3(),
      );
      const obj = { _id: "id1" };
      manager.setObject("id1", obj);
      globalCache.objects["id1"] = { className: "Widget", object: obj as any };

      manager.close();
      expect(manager.objectIDs).toEqual([]);
      expect(globalCache.objects["id1"]).toBeUndefined();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(
        "[DEM - Widget MANAGER] Goodbye, see you next time!",
      );

      const disconnectSockets = jest.fn();
      const serverManager = new ConcreteManager(
        class {},
        "Widget",
        { disconnectSockets },
        {},
        {},
        new EventEmitter3(),
      );
      serverManager.close();
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    test("deleteObject does NOT invoke delete callback or remove cache when destroy fails", async () => {
      const manager = new ConcreteManager(
        class {},
        "Widget",
        {},
        {},
        {},
        new EventEmitter3(),
      );

      const onDeleteFail = jest.fn();
      const failingObj = {
        _id: "id1",
        destroy: jest.fn(async () => ({ success: false, message: "Denied" })),
        callbacks: { delete: onDeleteFail },
      };
      manager.setObject("id1", failingObj);
      globalCache.objects["id1"] = { className: "Widget", object: failingObj as any };

      const failRes = await manager.deleteObject("id1");
      expect(failRes).toEqual({ success: false, message: "Denied" });
      expect(manager.getObject("id1")).toBe(failingObj);
      expect(globalCache.objects["id1"]).toBeDefined();
      expect(onDeleteFail).not.toHaveBeenCalled();

      const onDeleteOk = jest.fn();
      const okObj = {
        _id: "id2",
        destroy: jest.fn(async () => ({ success: true, message: "Deleted" })),
        callbacks: { delete: onDeleteOk },
      };
      manager.setObject("id2", okObj);
      globalCache.objects["id2"] = { className: "Widget", object: okObj as any };

      const okRes = await manager.deleteObject("id2");
      expect(okRes).toEqual({ success: true, message: "Deleted" });
      expect(manager.getObject("id2")).toBeUndefined();
      expect(globalCache.objects["id2"]).toBeUndefined();
      expect(onDeleteOk).toHaveBeenCalledWith(manager);

      const missingRes = await manager.deleteObject("nonexistent");
      expect(missingRes).toEqual({ success: true, message: "Already gone" });
    });

    test("evictObject supports destroyImmediate, wipeSelf, and missing objects", async () => {
      const manager = new ConcreteManager(
        class {},
        "Widget",
        {},
        {},
        {},
        new EventEmitter3(),
      );

      const destroyImmediate = jest.fn();
      const onDelete1 = jest.fn();
      const obj1 = { _id: "e1", destroyImmediate, callbacks: { delete: onDelete1 } };
      manager.setObject("e1", obj1);
      globalCache.objects["e1"] = { className: "Widget", object: obj1 as any };

      const res1 = await manager.evictObject("e1");
      expect(res1).toEqual({ success: true, message: "Cleaned locally" });
      expect(destroyImmediate).toHaveBeenCalledTimes(1);
      expect(onDelete1).toHaveBeenCalledWith(manager);
      expect(manager.getObject("e1")).toBeUndefined();
      expect(globalCache.objects["e1"]).toBeUndefined();

      const wipeSelf = jest.fn(async () => {});
      const obj2 = { _id: "e2", wipeSelf };
      manager.setObject("e2", obj2);
      globalCache.objects["e2"] = { className: "Widget", object: obj2 as any };

      const res2 = await manager.evictObject("e2");
      expect(res2).toEqual({ success: true, message: "Cleaned locally" });
      expect(wipeSelf).toHaveBeenCalledTimes(1);
      expect(manager.getObject("e2")).toBeUndefined();

      const resMissing = await manager.evictObject("missing");
      expect(resMissing).toEqual({ success: true, message: "Cleaned locally" });
    });
  });

  describe("CommonTypes utilities", () => {
    test("parseSemVer parses valid versions and rejects invalid inputs", () => {
      expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
      expect(parseSemVer("v12.34.56-beta.1")).toEqual({ major: 12, minor: 34, patch: 56, prerelease: "beta.1" });
      expect(parseSemVer("2.5")).toEqual({ major: 2, minor: 5, patch: 0, prerelease: undefined });
      expect(parseSemVer("")).toBeNull();
      expect(parseSemVer("invalid")).toBeNull();
      expect(parseSemVer("1.2.3 extra")).toBeNull();
      expect(parseSemVer(null as any)).toBeNull();
    });

    test("compareSemVer orders versions correctly including invalid strings", () => {
      expect(compareSemVer("1.0.0", "1.0.0")).toBe(0);
      expect(compareSemVer("2.0.0", "1.9.9")).toBe(1);
      expect(compareSemVer("1.0.0", "2.0.0")).toBe(-1);
      expect(compareSemVer("1.2.0", "1.1.9")).toBe(1);
      expect(compareSemVer("1.1.0", "1.2.0")).toBe(-1);
      expect(compareSemVer("1.2.4", "1.2.3")).toBe(1);
      expect(compareSemVer("1.2.3", "1.2.4")).toBe(-1);
      expect(compareSemVer("bad", "bad")).toBe(0);
      expect(compareSemVer("bad", "1.0.0")).toBe(-1);
      expect(compareSemVer("1.0.0", "bad")).toBe(1);
    });

    test("verifyDEMVersion covers exact match, patch, minor, major, minServerVersion, non-semver, and custom validator", () => {
      const exact = verifyDEMVersion("1.2.3", "1.2.3");
      expect(exact).toEqual({
        compatible: true,
        clientVersion: "1.2.3",
        serverVersion: "1.2.3",
        status: "match",
        message: "DEM versions match (1.2.3).",
      });

      const patch = verifyDEMVersion("1.2.3", "1.2.4");
      expect(patch.compatible).toBe(true);
      expect(patch.status).toBe("compatible_patch");
      expect(patch.message).toContain("1.2.3");
      expect(patch.message).toContain("1.2.4");

      const minor = verifyDEMVersion("1.2.3", "1.3.3");
      expect(minor.compatible).toBe(false);
      expect(minor.status).toBe("mismatch_minor");

      const major = verifyDEMVersion("1.2.3", "2.2.3");
      expect(major.compatible).toBe(false);
      expect(major.status).toBe("mismatch_major");

      const belowMin = verifyDEMVersion("1.2.3", "1.2.3", { minServerVersion: "1.3.0" });
      expect(belowMin.compatible).toBe(false);
      expect(belowMin.status).toBe("below_min_version");

      const meetsMin = verifyDEMVersion("1.2.3", "1.2.3", { minServerVersion: "1.2.3" });
      expect(meetsMin.compatible).toBe(true);
      expect(meetsMin.status).toBe("match");

      const nonSemverMatch = verifyDEMVersion("custom", "custom");
      expect(nonSemverMatch.compatible).toBe(true);
      expect(nonSemverMatch.status).toBe("match");

      const nonSemverLax = verifyDEMVersion("custom1", "custom2");
      expect(nonSemverLax.compatible).toBe(true);
      expect(nonSemverLax.status).toBe("unknown");

      const nonSemverStrict = verifyDEMVersion("custom1", "custom2", { strictVersionMatch: true });
      expect(nonSemverStrict.compatible).toBe(false);
      expect(nonSemverStrict.status).toBe("unknown");

      const customOk = verifyDEMVersion("1.0.0", "2.0.0", { validateVersion: () => true });
      expect(customOk.compatible).toBe(true);
      expect(customOk.status).toBe("match");

      const customFalse = verifyDEMVersion("1.0.0", "1.0.0", { validateVersion: () => false });
      expect(customFalse.compatible).toBe(false);
      expect(customFalse.status).toBe("custom_rejected");
      expect(customFalse.message).toContain("Custom version validator rejected");

      const customMsg = verifyDEMVersion("1.0.0", "1.0.0", { validateVersion: () => "Blocked by policy" });
      expect(customMsg.compatible).toBe(false);
      expect(customMsg.status).toBe("custom_rejected");
      expect(customMsg.message).toBe("Blocked by policy");
    });

    test("safeStringify handles normal and circular objects", () => {
      expect(safeStringify({ a: 1 })).toBe('{"a":1}');
      const circular: any = {};
      circular.self = circular;
      expect(safeStringify(circular)).toBe("[Circular or non-serializable object]");
    });

    test("DEMGlobalCache tracks size and clears entries", () => {
      const cache = new DEMGlobalCache();
      expect(cache.size).toBe(0);
      cache.objects["a"] = { className: "Test", object: {} as any };
      cache.objects["b"] = { className: "Test", object: {} as any };
      expect(cache.size).toBe(2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.objects).toEqual({});
    });
  });
});
