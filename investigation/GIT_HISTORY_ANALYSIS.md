# Git History Investigation & Defect Origin Analysis

## 1. Overview & Purpose

This document records findings from the git commit histories of:
1. Primary Synchronization Engine: [`DEM`](file:///E:/destop/_data/projects/DEM/src)
2. Consumer Implementation: [`ukolnicek-geodeta/mobile`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile)

---

## 2. Commit Timeline & Defect Introductions

### Commit `817f29b` — "Preserve non-relational embedded objects with _id in createObject"
- **Date**: 2026-10-22 19:03
- **Context**: Mobile app introduced `ArchivedTask` snapshot objects storing embedded subdocuments with `_id`.
- **Finding**: Server sanitization in [`AutoUpdateServerManagerClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1384) checked `isRef` before converting objects with `_id` into string IDs.
- **Related Defect**: While embedded objects were preserved, [`AutoUpdatedServerObjectClass.ts`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedServerObjectClass.ts#L391) still failed to handle nested dotted paths (`settings.theme`) during `setValue`, creating literal dotted top-level keys ([`BUG-07`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_07_SERVER_SETVALUE_DOTTED_KEY.md)).

### Commit `31abca1` — "Implement smart lazy loading and static snapshot hydration"
- **Date**: 2026-10-21 10:35
- **Context**: Introduced Smart Lazy Loading with descriptors and two-phase graph hydration ([`ADR 0001`](file:///E:/destop/_data/projects/DEM/src/docs/adr/0001-smart-lazy-loading-and-static-snapshots.md)).
- **Finding**:
  1. [`collectEntityGraph`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L717) was written synchronously. It only checked `targetManager.getObject(refId)`, skipping all unhydrated database relations ([`BUG-10`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_10_SERVER_LAZY_GRAPH_UNHYDRATED_DROP.md)).
  2. Lazy stub hydration in [`AutoUpdatedClientObjectClass.ts:484`](file:///E:/destop/_data/projects/DEM/src/AutoUpdatedClientObjectClass.ts#L484) called `openSockets()` without calling `off()`, causing duplicate update listeners on re-hydration ([`BUG-06`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_06_LAZY_STUB_DUPLICATE_LISTENERS.md)).
  3. Deletion of unhydrated lazy entities bypassed MongoDB deletion ([`BUG-01`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_01_SERVER_DELETE_OBJECT_BYPASS.md)).

### Commit `db6b343` — "Implement modular delta synchronization and change-tracking system"
- **Date**: 2026-10-07 21:55
- **Context**: Added `ClientStateReconciler.ts` and `ServerChangeTracker.ts`.
- **Finding**:
  1. Line 155 in `ClientStateReconciler.ts` calls `manager.deleteObject(id)`, which triggers `obj.destroy(true)` and emits `EVENT_DELETE` back to the server, creating client-to-server delete echo loops on delta sync ([`BUG-03`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_03_CLIENT_DELETE_ECHO_STORM.md)).
  2. Line 161 calls `manager.callbacks?.delete?.(existing)` after line 155 already invoked callbacks via `super.deleteObject`, triggering duplicate deletion callbacks.

### Commit `87cc55b` — "Fix dynamic permission boundary sync and writeQueue deadlock"
- **Date**: 2026-10-05 11:54
- **Context**: Fixed permissions boundary sync and internal `_isUpdating` writeQueue deadlock.
- **Finding**:
  1. The commit added `this.knownObjectIdsBySocket`. However, in [`AutoUpdateServerManager.deleteObject`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1275), `known.delete(idStr)` executes before verifying database deletion.
  2. If database deletion fails, permission tracking becomes permanently desynchronized.

### Commit `1333b05` — "Optimize real production dataset initialization and client load time"
- **Date**: 2026-09-16 11:13
- **Context**: Introduced `this.socket.onAny` in [`AutoUpdateServerManagerClass.ts:1106`](file:///E:/destop/_data/projects/DEM/src/AutoUpdateServerManagerClass.ts#L1106).
- **Finding**: Added hardcoded `.length === 24` checks on `EVENT_UPDATE` and `EVENT_GET`. This broke compatibility with any non-hex 24-character identifiers (UUIDs, custom string keys) ([`BUG-02`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_02_HARDCODED_24_CHAR_ID_DROP.md)).

---

## 3. Summary of Consumer Workarounds in Mobile Application

Inspecting `ukolnicek-geodeta/mobile` revealed defensive application-level wrappers:
1. [`demWorkerBridge.ts`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile/backend/demWorkerBridge.ts): Workaround for lack of multi-tab socket connection sharing.
2. [`syncInit.ts`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile/backend/dbClasses/system/syncInit.ts): Implements candidate manager staging (`candidateDBHandler`) to avoid rendering UI with partially hydrated managers.
3. [`transmittor.ts`](file:///E:/destop/_data/projects/ukolnicek-geodeta/mobile/backend/transmittor.ts): Intercepts 401 errors and manually iterates DEM managers to invoke `.close()` because DEM does not have an automatic auth teardown listener.
