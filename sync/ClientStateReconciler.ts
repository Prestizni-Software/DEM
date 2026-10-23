import { ChangeEntry, DeltaSyncPayload, StoredManagerState } from "./types.js";
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
  deleteObject(id: any, isRemote?: boolean): Promise<any>;
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

      const objectMap = new Map<string, any>();
      if (state.objects) {
        for (const objData of state.objects) {
          if (objData?._id) {
            objectMap.set(objData._id.toString(), objData);
          }
        }
      }

      if (state.manifest && Array.isArray(state.manifest)) {
        manager.manifest = [...state.manifest];
      }

      for (const id of state.ids) {
        const objData = objectMap.get(id);
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
      const objectsAsArray = manager.objectsAsArray;
      const ids = objectsAsArray.map((o) => (o._id ? o._id.toString() : (o as any).data?._id?.toString())).filter(Boolean);
      const objects = objectsAsArray.map((o: any) => {
        const idStr = o._id ? o._id.toString() : (o.data?._id?.toString() ?? "unknown");
        if (o.isLazyStub) {
          return {
            _id: idStr,
            __isLazyStub: true,
            descriptor: o.descriptor,
          };
        }
        if (typeof o.extractedData !== "undefined") {
          const extracted = { ...o.extractedData };
          if (!extracted._id && idStr !== "unknown") {
            extracted._id = idStr;
          }
          return extracted;
        }
        const data = o.data ? { ...o.data } : { _id: idStr };
        if (!data._id && idStr !== "unknown") {
          data._id = idStr;
        }
        return data;
      });

      const state: StoredManagerState<any> = {
        className: manager.className,
        revision,
        ids,
        objects,
        properties: (manager.properties as string[]) || [],
        manifest: manager.manifest ? [...manager.manifest] : undefined,
        savedAt: Date.now(),
      };

      await storageAdapter.saveManagerState(manager.className, state);
    } catch (err) {
      manager.loggers?.warn?.(
        `Failed to persist ${manager.className} to storage: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Applies a delta changes payload to the in-memory client manager.
   * Handles creates, updates, and deletes with callback dispatch and local state persistence.
   *
   * @param manager - Reconcilable client manager instance.
   * @param payload - Delta sync payload containing status, revision, and changes array.
   * @param storageAdapter - Optional storage adapter to persist reconciled state.
   */
  public static async applyDelta<T extends IAutoUpdatedClientObjectBase>(
    manager: ReconcilableClientManager<T>,
    payload: DeltaSyncPayload<any>,
    storageAdapter?: IClientStorageAdapter,
  ): Promise<void> {
    const changes = payload.changes ?? [];

    for (const change of changes) {
      const id = change.id;

      if (change.type === "delete") {
        const existing = manager.getObject(id);
        if (existing) {
          await manager.deleteObject(id, true);
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
          manager.callbacks?.delete?.(manager as any);
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
          manager.callbacks?.new?.(instance);
        } else if (change.data) {
          // Object already exists, apply properties
          await this.patchObjectProperties(existing, change.data, manager.callbacks);
        }
      } else if (change.type === "update") {
        let existing = manager.getObject(id);
        if (existing && change.data) {
          await this.patchObjectProperties(existing, change.data, manager.callbacks);
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
          manager.callbacks?.new?.(instance);
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
    for (const key of Object.keys(patchData)) {
      if (key === "_id") continue;
      const val = patchData[key];
      if (targetObj.data) {
        targetObj.data[key] = val;
      }
      if (typeof targetObj.setValue__ === "function") {
        await targetObj.setValue__(key, val, true);
      } else {
        targetObj[key] = val;
      }
      callbacks?.update?.(targetObj, key);
    }
  }
}
