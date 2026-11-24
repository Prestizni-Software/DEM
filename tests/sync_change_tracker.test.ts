import { ServerChangeTracker, estimateObjectSizeBytes } from "../sync/ServerChangeTracker.js";
import { ChangeEntry } from "../sync/types.js";

describe("ServerChangeTracker", () => {
  test("initializes with revision 0 and empty change log", () => {
    const tracker = new ServerChangeTracker("TestModel");
    expect(tracker.getCurrentRevision()).toBe(0);
    expect(tracker.getEstimatedSizeBytes()).toBe(0);
    expect(tracker.getEntryCount()).toBe(0);
  });

  test("records create, update, delete operations and increments monotonic revision", () => {
    const tracker = new ServerChangeTracker("TestModel");

    const rev1 = tracker.recordChange("create", "id1", { name: "First" });
    expect(rev1).toBe(1);
    expect(tracker.getCurrentRevision()).toBe(1);

    const rev2 = tracker.recordChange("update", "id1", { name: "Updated First" });
    expect(rev2).toBe(2);
    expect(tracker.getCurrentRevision()).toBe(2);

    const rev3 = tracker.recordChange("delete", "id1");
    expect(rev3).toBe(3);
    expect(tracker.getCurrentRevision()).toBe(3);
    expect(tracker.getEntryCount()).toBe(3);
  });

  test("retrieves changes since a given revision", () => {
    const tracker = new ServerChangeTracker("TestModel");

    tracker.recordChange("create", "id1", { name: "Item 1" }); // rev 1
    tracker.recordChange("create", "id2", { name: "Item 2" }); // rev 2
    tracker.recordChange("update", "id1", { name: "Item 1 Modified" }); // rev 3
    tracker.recordChange("delete", "id2"); // rev 4

    const changesFromZero = tracker.getChangesSince(0);
    expect(changesFromZero.isExpired).toBe(false);
    expect(changesFromZero.changes.length).toBe(4);
    expect(changesFromZero.changes.map((c: ChangeEntry) => c.revision)).toEqual([1, 2, 3, 4]);

    const changesFromRev2 = tracker.getChangesSince(2);
    expect(changesFromRev2.isExpired).toBe(false);
    expect(changesFromRev2.changes.length).toBe(2);
    expect(changesFromRev2.changes.map((c: ChangeEntry) => c.revision)).toEqual([3, 4]);

    const changesFromCurrent = tracker.getChangesSince(4);
    expect(changesFromCurrent.isExpired).toBe(false);
    expect(changesFromCurrent.changes.length).toBe(0);
  });

  test("filters changes by allowed IDs if provided (for access control / startupMiddleware)", () => {
    const tracker = new ServerChangeTracker("TestModel");

    tracker.recordChange("create", "id1", { name: "Item 1" });
    tracker.recordChange("create", "id2", { name: "Item 2" });
    tracker.recordChange("update", "id1", { name: "Item 1 v2" });

    const allowed = new Set(["id1"]);
    const res = tracker.getChangesSince(0, allowed);
    expect(res.changes.length).toBe(2);
    expect(res.changes.every((c: ChangeEntry) => c.id === "id1")).toBe(true);
  });

  test("prunes changes by TTL (maxAgeMs)", () => {
    const tracker = new ServerChangeTracker("TestModel", {
      maxAgeMs: 1000, // 1 second TTL
    });

    const oldTimestamp = Date.now() - 5000;
    tracker.recordChangeWithTimestamp("create", "id1", { name: "Old" }, oldTimestamp); // rev 1
    tracker.recordChange("create", "id2", { name: "New" }); // rev 2

    expect(tracker.getEntryCount()).toBe(1);
    expect(tracker.getLowestRetainedRevision()).toBe(2);

    // Client requesting rev 0 should be marked as expired because rev 1 was pruned
    const res = tracker.getChangesSince(0);
    expect(res.isExpired).toBe(true);

    // Client requesting rev 1 can receive changes because rev 2 is retained
    const res2 = tracker.getChangesSince(1);
    expect(res2.isExpired).toBe(false);
    expect(res2.changes.length).toBe(1);
    expect(res2.changes[0].id).toBe("id2");
  });

  test("prunes changes by size in bytes (maxSizeBytes)", () => {
    // 500 bytes max
    const tracker = new ServerChangeTracker("TestModel", {
      maxSizeBytes: 500,
    });

    // Add multiple entries that exceed 500 bytes
    for (let i = 1; i <= 20; i++) {
      tracker.recordChange("create", `id_${i}`, { data: "x".repeat(100) });
    }

    expect(tracker.getEntryCount()).toBeGreaterThan(0);
    expect(tracker.getEstimatedSizeBytes()).toBeGreaterThan(0);
    expect(tracker.getEstimatedSizeBytes()).toBeLessThanOrEqual(500);
    expect(tracker.getLowestRetainedRevision()).toBeGreaterThan(1);

    // Client asking for rev 0 must be expired
    expect(tracker.getChangesSince(0).isExpired).toBe(true);
  });

  test("supports pruneMode 'both' (only prunes when both TTL and size limits are violated)", () => {
    const tracker = new ServerChangeTracker("TestModel", {
      maxAgeMs: 1000,
      maxSizeBytes: 100,
      pruneMode: "both",
    });

    // Entry 1: Old timestamp, but total size is small (under 100 bytes)
    const oldTimestamp = Date.now() - 5000;
    tracker.recordChangeWithTimestamp("create", "id1", { n: 1 }, oldTimestamp);

    // Should NOT prune yet because size limit is not exceeded even though age is
    expect(tracker.getEntryCount()).toBe(1);
    expect(tracker.getLowestRetainedRevision()).toBe(1);

    // Add a large recent entry so total size exceeds 100 bytes; now Entry 1 violates BOTH age and size
    tracker.recordChange("create", "id2", { payload: "z".repeat(100) });
    expect(tracker.getEntryCount()).toBe(1);
    expect(tracker.getLowestRetainedRevision()).toBe(2);

    // Single constraint in "both" mode falls back to pruning on that constraint
    const ageOnlyBoth = new ServerChangeTracker("TestModel", {
      maxAgeMs: 1000,
      pruneMode: "both",
    });
    ageOnlyBoth.recordChangeWithTimestamp("create", "old1", { n: 1 }, oldTimestamp);
    expect(ageOnlyBoth.getEntryCount()).toBe(0);
    expect(ageOnlyBoth.getLowestRetainedRevision()).toBe(2);
    expect(ageOnlyBoth.getEstimatedSizeBytes()).toBe(0);
    expect(ageOnlyBoth.getChangesSince(0)).toEqual({ isExpired: true, changes: [] });
  });

  test("estimateObjectSizeBytes handles primitives, arrays, nested objects, and functions", () => {
    expect(estimateObjectSizeBytes(null)).toBe(8);
    expect(estimateObjectSizeBytes(undefined)).toBe(8);
    expect(estimateObjectSizeBytes(true)).toBe(4);
    expect(estimateObjectSizeBytes(42)).toBe(8);
    expect(estimateObjectSizeBytes("abcd")).toBe(8);
    expect(estimateObjectSizeBytes([1, "ab"])).toBe(16 + 8 + 4);
    expect(estimateObjectSizeBytes({ ab: true })).toBe(16 + 4 + 4);
    expect(estimateObjectSizeBytes(() => {})).toBe(16);
  });

  test("updateOptions, maxEntries, clear, and clientRevision boundary handling", () => {
    const tracker = new ServerChangeTracker("TestModel", { maxEntries: 2 });
    expect(tracker.pruneMode).toBe("either");
    tracker.recordChange("create", "id1", { a: 1 });
    tracker.recordChange("update", "id1", { a: 2 });
    tracker.recordChange("update", "id1", { a: 3 });

    expect(tracker.getEntryCount()).toBe(2);
    expect(tracker.getLowestRetainedRevision()).toBe(2);
    expect(tracker.getChangesSince(3)).toEqual({ isExpired: false, changes: [] });
    expect(tracker.getChangesSince(99)).toEqual({ isExpired: false, changes: [] });

    tracker.updateOptions({ maxEntries: 1, maxAgeMs: 5000, maxSizeBytes: 5000, pruneMode: "both" });
    expect(tracker.pruneMode).toBe("both");
    expect(tracker.getEntryCount()).toBe(1);
    expect(tracker.getLowestRetainedRevision()).toBe(3);

    tracker.clear();
    expect(tracker.getCurrentRevision()).toBe(0);
    expect(tracker.getLowestRetainedRevision()).toBe(1);
    expect(tracker.getEntryCount()).toBe(0);
    expect(tracker.getEstimatedSizeBytes()).toBe(0);
  });

  test("coalesceEntries and getChangesSince with coalesce=true compact entity transitions", () => {
    const tracker = new ServerChangeTracker<{ a?: number; b?: number }>("TestModel");
    tracker.recordChange("create", "id1", { a: 1 });
    tracker.recordChange("update", "id1", { b: 2 });
    tracker.recordChange("create", "id2", { a: 10 });
    tracker.recordChange("delete", "id2");
    tracker.recordChange("update", "id3", { a: 5 });
    tracker.recordChange("update", "id3", { b: 6 });
    tracker.recordChange("update", "id4", { a: 7 });
    tracker.recordChange("delete", "id4");
    tracker.recordChange("delete", "id5");
    tracker.recordChange("create", "id5", { a: 99 });
    tracker.recordChange("delete", "id6");
    tracker.recordChange("update", "id6", { a: 100 });

    const res = tracker.getChangesSince(0, undefined, true);
    expect(res.isExpired).toBe(false);
    const byId = new Map(res.changes.map((c) => [c.id, c]));

    expect(byId.get("id1")?.type).toBe("create");
    expect(byId.get("id1")?.data).toEqual({ a: 1, b: 2 });
    expect(byId.has("id2")).toBe(false);
    expect(byId.get("id3")?.type).toBe("update");
    expect(byId.get("id3")?.data).toEqual({ a: 5, b: 6 });
    expect(byId.get("id4")?.type).toBe("delete");
    expect(byId.get("id4")?.data).toBeUndefined();
    expect(byId.get("id5")?.type).toBe("create");
    expect(byId.get("id5")?.data).toEqual({ a: 99 });
    expect(byId.get("id6")?.type).toBe("update");
    expect(byId.get("id6")?.data).toEqual({ a: 100 });
  });
});
