import {
  ApplyDeltaOptions,
  ChangeEntry,
  DeltaBatchSummary,
  DeltaSyncPayload,
  StoredManagerState,
} from "./types.js";
import { IClientStorageAdapter } from "./storage/IClientStorageAdapter.js";
import { EntityDescriptor, globalCache, IAutoUpdatedClientObjectBase } from "../CommonTypes.js";

export interface ReconcilableClientManager<T extends IAutoUpdatedClientObjectBase = IAutoUpdatedClientObjectBase> {
  className: string;
  classParam: any;
  socket: any;
  loggers: any;
  callbacks: any;
  emitter: any;
  objects_: { [id: string]: T };
  objectsAsArray: T[];
  totalObjects: number;
  loadedObjects: number;
  isLoaded_: boolean;
  manifest?: EntityDescriptor[];
  isLazyLoadingEnabled?: boolean;
  getObject(id: string): T | undefined;
  deleteObject(id: any): Promise<any>;
  evictObject?(id: any): Promise<any>;
  registerDynamicProperty?(prop: string): void;
  properties?: string[];
}

export class ClientStateReconciler {
  /**
   * Restores client manager objects in-memory from a persistent storage adapter.
   *
   * @param manager - Reconcilable client manager instance.
   * @param storageAdapter - Storage adapter implementing IClientStorageAdapter.
   * @returns Object indicating restoration success, stored revision, and restored entity count.
   */
  public static async restoreFromStorage<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    storageAdapter: IClientStorageAdapter,
  ): Promise<{ restored: boolean; revision: number; count: number }> {
    try {
      const state = await storageAdapter.loadManagerState<any>(manager.className);
      return this.restoreFromState(manager, state);
    } catch (err) {
      manager.loggers?.warn?.(
        `Failed to restore ${manager.className} from storage: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { restored: false, revision: 0, count: 0 };
    }
  }

  /**
   * Restores client manager state from storage immediately and runs delta revalidation in the background.
   * Implements stale-while-revalidate loading so the caller can publish restored state without blocking on network I/O.
   *
   * @param manager - Reconcilable client manager instance.
   * @param storageAdapter - Storage adapter implementing IClientStorageAdapter.
   * @param fetchDelta - Async callback that fetches a DeltaSyncPayload for the restored revision.
   * @returns Restoration metadata along with a background revalidation promise.
   */
  public static async restoreAndRevalidate<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    storageAdapter: IClientStorageAdapter,
    fetchDelta: (revision: number) => Promise<DeltaSyncPayload<any> | null | undefined>,
  ): Promise<{
    restored: boolean;
    revision: number;
    count: number;
    revalidation: Promise<{
      reconciled: boolean;
      fullResyncRequired: boolean;
      revision: number;
    }>;
  }> {
    const restoredResult = await this.restoreFromStorage(manager, storageAdapter);

    const revalidation = (async () => {
      try {
        const payload = await fetchDelta(restoredResult.revision);
        if (!payload || payload.status === "full") {
          return {
            reconciled: false,
            fullResyncRequired: true,
            revision: payload?.revision ?? restoredResult.revision,
          };
        }
        if (payload.status === "delta") {
          await this.applyDelta(manager, payload, storageAdapter);
        }
        return {
          reconciled: true,
          fullResyncRequired: false,
          revision: payload.revision,
        };
      } catch (err) {
        manager.loggers?.warn?.(
          `Failed to revalidate ${manager.className}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          reconciled: false,
          fullResyncRequired: true,
          revision: restoredResult.revision,
        };
      }
    })();

    return {
      ...restoredResult,
      revalidation,
    };
  }

  /**
   * Restores client manager objects in-memory from a stored state object.
   * Needs no storage adapter. Use it to hydrate from a snapshot that the application owns.
   *
   * @param manager - Reconcilable client manager instance.
   * @param state - Stored manager state. Can be null.
   * @returns Object indicating restoration success, stored revision, and restored entity count.
   * @throws Never. Errors are logged and reported as restored false.
   */
  public static restoreFromState<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    state: StoredManagerState<any> | null | undefined,
  ): { restored: boolean; revision: number; count: number } {
    try {
      if (!state || !Array.isArray(state.ids) || state.ids.length === 0) {
        return { restored: false, revision: state?.revision ?? 0, count: 0 };
      }

      // Clear existing in-memory objects for this manager
      for (const oldId of Object.keys(manager.objects_)) {
        if (manager.socket && typeof manager.socket.off === "function") {
          manager.socket.off("update" + manager.className + oldId);
        }
        const oldObj = manager.objects_[oldId];
        if (oldObj && typeof (oldObj as any).destroyImmediate === "function") {
          (oldObj as any).destroyImmediate();
        }
        delete globalCache.objects[oldId];
      }
      manager.objects_ = {};

      let objectMap: Map<string, any> | null = null;
      const getObjData = (id: string, index: number): any => {
        if (!state.objects) return undefined;
        const candidate = state.objects[index];
        if (candidate && String(candidate._id) === id) return candidate;
        if (!objectMap) {
          objectMap = new Map<string, any>();
          for (const obj of state.objects) {
            if (obj?._id) {
              objectMap.set(obj._id.toString(), obj);
            }
          }
        }
        return objectMap.get(id);
      };

      if (state.manifest && Array.isArray(state.manifest)) {
        manager.manifest = [...state.manifest];
      }

      for (let i = 0; i < state.ids.length; i++) {
        const id = state.ids[i];
        const objData = getObjData(id, i);
        const instance = new manager.classParam(
          manager.classParam,
          manager.socket,
          objData || id,
          manager.loggers,
          manager.className,
          manager,
          manager.callbacks,
          manager.emitter,
        );
        if (objData && objData.__isLazyStub) {
          instance.isLazyStub = true;
          instance.descriptor = objData.descriptor;
        }
        manager.objects_[id] = instance;
        globalCache.objects[id] = {
          className: manager.className,
          object: instance,
        };
      }

      manager.totalObjects = state.ids.length;
      manager.loadedObjects = state.ids.length;
      manager.isLoaded_ = true;
      if ("_cachedObjectsArray" in manager) {
        (manager as any)._cachedObjectsArray = null;
      }

      return {
        restored: true,
        revision: state.revision,
        count: state.ids.length,
      };
    } catch (err) {
      manager.loggers?.warn?.(
        `Failed to restore ${manager.className} from storage: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { restored: false, revision: 0, count: 0 };
    }
  }

  /**
   * Builds a storable snapshot of the manager in-memory state.
   * Reads the cached raw data of each object. Does not clone objects.
   * The `extractedData` getter of an object runs a deep clone. Avoid it for bulk reads.
   *
   * @param manager - Reconcilable client manager instance.
   * @param revision - Monotonic revision number to record with the snapshot.
   * @returns Serializable manager state. Lazy stubs stay stubs.
   */
  public static serializeState<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    revision: number,
  ): StoredManagerState<any> {
    const ids: string[] = [];
    const objects: any[] = [];
    for (const element of manager.objectsAsArray) {
      const o: any = element;
      const idStr = o._id ? o._id.toString() : (o.data?._id?.toString() ?? "unknown");
      if (idStr !== "unknown") {
        ids.push(idStr);
      }
      if (o.isLazyStub) {
        objects.push({
          _id: idStr,
          __isLazyStub: true,
          descriptor: o.descriptor,
        });
        continue;
      }
      const extracted = o.getRawExtractedData?.() ?? o.extractedData ?? o.data;
      if (extracted) {
        if (!extracted._id && idStr !== "unknown") {
          objects.push({ ...extracted, _id: idStr });
        } else {
          objects.push(extracted);
        }
      } else {
        objects.push({ _id: idStr });
      }
    }

    return {
      className: manager.className,
      revision,
      ids,
      objects,
      properties: (manager.properties as string[]) || [],
      manifest: manager.manifest ? [...manager.manifest] : undefined,
      savedAt: Date.now(),
    };
  }

  /**
   * Persists current manager in-memory state to storage adapter.
   *
   * @param manager - Reconcilable client manager instance.
   * @param revision - Monotonic revision number to record with the snapshot.
   * @param storageAdapter - Storage adapter to receive the persisted state.
   */
  public static async persistToStorage<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    revision: number,
    storageAdapter: IClientStorageAdapter,
  ): Promise<void> {
    try {
      const state = this.serializeState(manager, revision);
      await storageAdapter.saveManagerState(manager.className, state);
    } catch (err) {
      manager.loggers?.warn?.(
        `Failed to persist ${manager.className} to storage: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Coalesces a chronological list of change entries into at most one net entry per entity ID.
   * Reduces redundant property updates from O(C * K) to O(U * K) where U is unique mutated entities.
   *
   * @param changes - Chronological array of change entries.
   * @param preserveCreateDeleteLifecycle - When true, keeps create, update, and delete steps distinct when a created entity is also updated or deleted in the same payload.
   * @returns Compacted array of change entries.
   */
  public static coalesceChanges<T = unknown>(
    changes: ChangeEntry<T>[],
    preserveCreateDeleteLifecycle = false,
  ): ChangeEntry<T>[] {
    if (changes.length <= 1) return changes;
    const byId = new Map<string, ChangeEntry<T>>();
    const extraEntries: ChangeEntry<T>[] = [];
    for (const change of changes) {
      const prev = byId.get(change.id);
      if (!prev) {
        byId.set(change.id, {
          ...change,
          data: change.data ? { ...change.data } : undefined,
        });
        continue;
      }
      if (change.type === "delete") {
        if (prev.type === "create") {
          if (preserveCreateDeleteLifecycle) {
            extraEntries.push(prev);
            byId.set(change.id, { ...change, data: undefined });
          } else {
            byId.delete(change.id);
          }
        } else if (prev.type === "update" && preserveCreateDeleteLifecycle) {
          extraEntries.push(prev);
          byId.set(change.id, { ...change, data: undefined });
        } else {
          byId.set(change.id, { ...change, data: undefined });
        }
      } else if (change.type === "create") {
        byId.set(change.id, {
          ...change,
          data: change.data ? { ...change.data } : undefined,
        });
      } else if (change.type === "update") {
        if (prev.type === "create" && preserveCreateDeleteLifecycle) {
          extraEntries.push(prev);
          byId.set(change.id, {
            ...change,
            data: change.data ? { ...change.data } : undefined,
          });
        } else if (prev.type === "create" || prev.type === "update") {
          byId.set(change.id, {
            ...prev,
            revision: change.revision,
            timestamp: change.timestamp,
            data: { ...(prev.data ?? {}), ...(change.data ?? {}) } as Partial<T>,
          });
        } else {
          byId.set(change.id, {
            ...change,
            data: change.data ? { ...change.data } : undefined,
          });
        }
      }
    }
    if (extraEntries.length === 0) {
      return Array.from(byId.values());
    }
    return [...extraEntries, ...byId.values()].sort((a, b) => a.revision - b.revision);
  }

  /**
   * Applies a delta changes payload to the in-memory client manager.
   * Coalesces redundant per-entity mutations by default and supports optional callback batching.
   *
   * @param manager - Reconcilable client manager instance.
   * @param payload - Delta sync payload containing status, revision, and changes array.
   * @param storageAdapter - Optional storage adapter to persist reconciled state.
   * @param options - Optional settings for change coalescing and callback batching.
   */
  public static async applyDelta<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    payload: DeltaSyncPayload<any>,
    storageAdapter?: IClientStorageAdapter,
    options?: ApplyDeltaOptions,
  ): Promise<void> {
    const rawChanges = payload.changes ?? [];
    const shouldCoalesce = options?.coalesce !== false;
    const batchCallbacks = options?.batchCallbacks === true;
    const changes = shouldCoalesce
      ? this.coalesceChanges(rawChanges, !batchCallbacks && options?.coalesce !== true)
      : rawChanges;

    const batchSummary: DeltaBatchSummary<T> = {
      created: [],
      updated: [],
      deletedIds: [],
    };
    const itemCallbacks = batchCallbacks ? undefined : manager.callbacks;

    for (const change of changes) {
      const id = change.id;

      if (change.type === "delete") {
        const existing = manager.getObject(id);
        if (existing) {
          if (typeof manager.evictObject === "function") {
            await manager.evictObject(id);
          } else {
            await manager.deleteObject(id);
          }
          manager.totalObjects = Math.max(0, manager.totalObjects - 1);
          manager.loadedObjects = Math.max(0, manager.loadedObjects - 1);
          if ("_cachedObjectsArray" in manager) {
            (manager as any)._cachedObjectsArray = null;
          }
          if (manager.manifest && Array.isArray(manager.manifest)) {
            manager.manifest = manager.manifest.filter(
              (m) => String(m._id) !== String(id),
            );
          }
          batchSummary.deletedIds.push(id);
          itemCallbacks?.delete?.(manager as any);
        }
      } else if (change.type === "create") {
        let existing = manager.getObject(id);
        if (!existing) {
          const instance = new manager.classParam(
            manager.classParam,
            manager.socket,
            change.data || id,
            manager.loggers,
            manager.className,
            manager,
            manager.callbacks,
            manager.emitter,
          );
          manager.objects_[id] = instance;
          if ("_cachedObjectsArray" in manager) {
            (manager as any)._cachedObjectsArray = null;
          }
          globalCache.objects[id] = {
            className: manager.className,
            object: instance,
          };
          if (manager.manifest && Array.isArray(manager.manifest)) {
            let desc: string;
            if (typeof (manager.classParam as any)?.getDescriptor === "function") {
              try {
                desc = (manager.classParam as any).getDescriptor(change.data ?? {});
              } catch {
                desc = id;
              }
            } else {
              desc = id;
            }
            if (!manager.manifest.some((m) => String(m._id) === String(id))) {
              manager.manifest.push({ _id: id, description: desc });
            }
          }
          manager.totalObjects += 1;
          manager.loadedObjects += 1;
          batchSummary.created.push(instance);
          itemCallbacks?.new?.(instance);
        } else if (change.data) {
          // Object already exists, apply properties
          const keys = Object.keys(change.data).filter((k) => k !== "_id");
          await this.patchObjectProperties(existing, change.data, itemCallbacks);
          if (keys.length > 0) {
            batchSummary.updated.push({ object: existing, keys });
          }
        }
      } else if (change.type === "update") {
        let existing = manager.getObject(id);
        if (existing && change.data) {
          const keys = Object.keys(change.data).filter((k) => k !== "_id");
          await this.patchObjectProperties(existing, change.data, itemCallbacks);
          if (keys.length > 0) {
            batchSummary.updated.push({ object: existing, keys });
          }
        } else if (!existing && change.data) {
          // Object was updated but client did not have it, create it
          const instance = new manager.classParam(
            manager.classParam,
            manager.socket,
            change.data,
            manager.loggers,
            manager.className,
            manager,
            manager.callbacks,
            manager.emitter,
          );
          manager.objects_[id] = instance;
          if ("_cachedObjectsArray" in manager) {
            (manager as any)._cachedObjectsArray = null;
          }
          globalCache.objects[id] = {
            className: manager.className,
            object: instance,
          };
          manager.totalObjects += 1;
          manager.loadedObjects += 1;
          batchSummary.created.push(instance);
          itemCallbacks?.new?.(instance);
        }
      }
    }

    if (
      batchCallbacks &&
      (batchSummary.created.length > 0 ||
        batchSummary.updated.length > 0 ||
        batchSummary.deletedIds.length > 0)
    ) {
      if (typeof manager.callbacks?.batchUpdate === "function") {
        await manager.callbacks.batchUpdate(batchSummary);
      } else {
        if (batchSummary.updated.length > 0) {
          const first = batchSummary.updated[0];
          await manager.callbacks?.update?.(first.object, first.keys[0] ?? "*");
        }
        if (batchSummary.created.length > 0) {
          await manager.callbacks?.new?.(batchSummary.created[batchSummary.created.length - 1]);
        }
        if (batchSummary.deletedIds.length > 0) {
          await manager.callbacks?.delete?.(manager as any);
        }
      }
    }

    if (storageAdapter) {
      await this.persistToStorage(manager, payload.revision, storageAdapter);
    }
  }

  /**
   * Patches changed fields onto an existing client object instance and triggers update callback.
   *
   * @param targetObj - Target client object to patch.
   * @param patchData - Key-value map of properties to apply.
   * @param callbacks - Optional manager callbacks interface.
   */
  private static async patchObjectProperties(
    targetObj: any,
    patchData: Record<string, any>,
    callbacks?: any,
  ): Promise<void> {
    const suppressObjectCallback = !callbacks && targetObj.callbacks;
    const savedCallbacks = suppressObjectCallback ? targetObj.callbacks : undefined;
    if (suppressObjectCallback) {
      targetObj.callbacks = { ...savedCallbacks, update: () => {} };
    }
    try {
      for (const key of Object.keys(patchData)) {
        if (key === "_id") continue;
        const val = patchData[key];
        if (typeof targetObj.setValue__ === "function") {
          await targetObj.setValue__(key, val, true);
          if (!targetObj.isLoaded) {
            callbacks?.update?.(targetObj, key);
          }
        } else {
          if (targetObj.data) {
            targetObj.data[key] = val;
          }
          targetObj[key] = val;
          callbacks?.update?.(targetObj, key);
        }
        if ("_cachedExtractedData" in targetObj) {
          targetObj._cachedExtractedData = null;
        }
      }
    } finally {
      if (suppressObjectCallback) {
        targetObj.callbacks = savedCallbacks;
      }
    }
  }
}
