import { ServerChangeTracker } from "../sync/ServerChangeTracker.js";
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
  });
});
