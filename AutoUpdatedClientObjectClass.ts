import "reflect-metadata";
import _ from "lodash";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  PathValueOf,
  ServerResponse,
  ServerUpdateRequest,
  ExtractedData,
  EVENT_INTERNAL_PRE_LOADED,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_NEW,
  EVENT_UPDATE,
  globalCache,
  MongoId,
  IDEMSocket,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";

export type DEMClientCallbacks<T extends AutoUpdatedClientObject<T, any>> = {
  new: (obj: T) => Promise<void> | void;
  update: (obj: T, key: string) => Promise<void> | void;
  delete: (obj: T) => Promise<void> | void;
  progress: (percent: number) => void;
  onUpdate?: (
    obj: T,
    set: <K extends keyof IsData<T> & string>(
      key: K,
      val: PathValueOf<IsData<T>, K>,
    ) => Promise<{ success: boolean; msg: string }>,
  ) => Promise<void>;
};

export abstract class AutoUpdatedClientObject<
  T extends AutoUpdatedClientObject<T, any>,
  M extends Record<string, any> = any,
> {
  protected entry: unknown;
  public preLoad: unknown;
  public registerSocket: unknown;
  public readyLoggers: unknown;
  public loadFromDB(a: unknown): unknown {
    return a;
  }

  protected readonly socket: IDEMSocket;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  public abstract readonly _id: MongoId;
  protected readonly loggers: LoggersType;
  protected isLoading = true;
  protected isLoadingReferences = true;
  protected checkedMissingRefs = false;
  protected isDestroyed = false;
  protected readonly emitter: EventEmitter3;
  public readonly properties: (keyof IsData<T> & string)[];
  public readonly classParam: Constructor<T>;
  public readonly className: string;
  public parentManager: AutoUpdateManager<T, M>;
  private readonly EmitterID = new ObjectId().toHexString();
  protected readonly toChangeOnParents: { key: string; value: unknown }[] = [];
  public callbacks: DEMClientCallbacks<T>;
  private readonly preloadTimers = new Set<NodeJS.Timeout>();

  private readonly loadReferencesAsync = async (): Promise<void> => {
    try {
      if (!this.isLoaded) {
        await this.waitForPreloaded();
      }
      this.generateSettersAndGetters();
      await this.loadForceReferences();
      for (const thing of this.toChangeOnParents) {
        await this.setValue(thing.key as any, thing.value as any, {
          silent: true,
          isParentUpdate: true,
        });
      }
    } catch (error: any) {
      // this.loggers?.error?.("Error loading references: " + error.message);
    } finally {
      this.isLoadingReferences = false;
    }
  };

  /** @deprecated Use loadReferencesAsync instead */
  private readonly loadShit = this.loadReferencesAsync;

  constructor(
    classParam?: Constructor<T>,
    socket?: IDEMSocket,
    data?: string | IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateManager<T, M>,
    callback?: DEMClientCallbacks<T>,
    emitter?: EventEmitter3,
    isServer: boolean = false,
  ) {
    if (
      !classParam ||
      !socket ||
      !data ||
      !loggers ||
      !className ||
      !parentManager ||
      !emitter
    ) {
      this.classParam = classParam!;
      this.socket = socket!;
      this.data = data as any;
      this.loggers = loggers!;
      this.className = className!;
      this.parentManager = parentManager!;
      this.callbacks = callback!;
      this.emitter = emitter!;
      this.properties = [];
      return;
    }
    this.classParam = classParam;
    this.socket = socket;
    this.isServer = isServer;
    this.emitter = emitter;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.parentManager = parentManager;
    this.className = className;

    const allProps = new Set<string>();
    let proto = classParam.prototype;
    while (proto && proto !== Object.prototype) {
      const props = Reflect.getOwnMetadata("props", proto) as
        | string[]
        | undefined;
      if (props) {
        for (const p of props) allProps.add(p);
      }
      proto = Object.getPrototypeOf(proto);
    }
    this.properties = Array.from(allProps) as (keyof IsData<T> & string)[];

    this.callbacks = callback || {
      new: () => {},
      update: () => {},
      delete: () => {},
      progress: () => {},
    };

    try {
      if (typeof data === "string") {
        this.data = { _id: data } as any;
      } else {
        this.data = data as IsData<T>;
      }

      const currentId = this.data?._id?.toString() ?? "not loaded";
      this.loggers = {
        debug: (s: string) =>
          loggers.debug?.(`[${this.className}: ${currentId}] ${s}`),
        info: (s: string) =>
          loggers.info?.(`[${this.className}: ${currentId}] ${s}`),
        warn: (s: string) =>
          loggers.warn?.(`[${this.className}: ${currentId}] ${s}`),
        error: (s: string) =>
          loggers.error?.(`[${this.className}: ${currentId}] ${s}`),
      };

      if (typeof data === "string") {
        if (this.isServer) {
          this.isLoading = false;
          this.generateSettersAndGetters();
          this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
          return;
        }
        this.socket.emit(
          EVENT_GET + this.className + data,
          null,
          async (res: ServerResponse<T>) => {
            if (this.isDestroyed) return;
            if (!res.success) {
              this.isLoading = false;
              this.emitter.emit(
                EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
                true,
                res.message,
              );
              return;
            }
            this.data = res.data as IsData<T>;
            this.generateSettersAndGetters();
            this.isLoading = false;
            await this.onUpdate();
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
            this.openSockets();
          },
        );
      } else {
        const currentDataRec = this.data as Record<string, unknown>;
        for (const key of this.properties) {
          const isRef = getMetadataRecursive("isRef", this, key);
          if (isRef && currentDataRec[key]) {
            if (Array.isArray(currentDataRec[key])) {
              currentDataRec[key] = (currentDataRec[key] as any[]).map(
                (obj) => obj._id?.toString() ?? obj?.toString(),
              );
            } else {
              currentDataRec[key] =
                (currentDataRec[key] as any)?._id?.toString() ??
                currentDataRec[key]?.toString();
            }
          }
        }

        if (
          (!currentDataRec["_id"] || currentDataRec["_id"] === "") &&
          !this.isServer
        ) {
          this.isLoading = true;
          this.handleNewObject(this.data);
        } else {
          this.isLoading = false;
          this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
          if (!this.isServer) {
            this.openSockets();
            this.onUpdate();
          }
        }
      }

      this.generateSettersAndGetters();
      // Ensure setters/getters are set after child constructor
      Promise.resolve().then(() => {
        if (!this.isDestroyed) this.generateSettersAndGetters();
      });

      if (!this.isServer && !this.isLoaded) {
          this.loadShit();
      }
    } catch (e) {
      this.destroyImmediate();
      throw e;
    }
    }

    public async waitForPreloaded() {
    if (this.isLoaded) return;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
          this.preloadTimers.delete(timer);
          this.emitter.off(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, onPreloaded);
          reject(new Error(`Timeout waiting for preloaded: ${this.className}`));
      }, 10000);
      this.preloadTimers.add(timer);

      const onPreloaded = (failed: boolean, reason: string) => {
          clearTimeout(timer);
          this.preloadTimers.delete(timer);
          if (failed) reject(new Error(reason));
          else resolve();
      };

      this.emitter.once(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, onPreloaded);
    });
    }
  protected handleNewObject(data: IsData<T>) {
    this.isLoading = true;
    if (!this.socket || typeof this.socket.emit !== "function") {
      this.isLoading = false;
      this.emitter.emit(
        EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
        true,
        "Socket not available",
      );
      return;
    }
    this.socket.emit(
      EVENT_NEW + this.className,
      data,
      (res: ServerResponse<T>) => {
        if (!res.success) {
          this.isLoading = false;
          this.emitter.emit(
            EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
            true,
            res.message,
          );
          return;
        }
        this.data = res.data as IsData<T>;
        this.generateSettersAndGetters();
        this.isLoading = false;
        this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
        if (!this.isServer) this.openSockets();
      },
    );
  }

  public get extractedData(): { [K in keyof IsData<T>]: unknown } {
    const extracted = processIsRefProperties(
      this.data as any,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData;
    return extracted as { [K in keyof IsData<T>]: unknown };
  }

  public get isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isPreLoadedAsync(): Promise<boolean> {
    await this.waitForPreloaded();
    return true;
  }

  public async loadMissingReferences(): Promise<void> {
    await this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const dataRec = this.data as Record<string, unknown>;
    const id = dataRec["_id"] as MongoId | undefined;
    if (!id || !this.socket || typeof this.socket.on !== "function") return;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.on(
      event,
      async (
        update: ServerUpdateRequest<T>,
        ack?: (res: ServerResponse<unknown>) => void,
      ) => {
        const res = await this.handleUpdateRequest(update);
        if (ack) ack(res as any);
        return res;
      },
    );
  }

  private async handleUpdateRequest(
    update: ServerUpdateRequest<T>,
  ): Promise<ServerResponse<unknown>> {
    try {
      await this.setValue(update.key as any, update.value as any, {
        silent: true,
      });
      if (this.isLoaded)
        this.callbacks.update(this as unknown as T, update.key);
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      const dataRec = this.data as Record<string, unknown>;
      this.loggers.error?.(
        `[${(dataRec["_id"] as MongoId)?.toString()}] Error applying patch: ${error.message}`,
      );
      return {
        success: false,
        message: "Error applying update: " + error.message,
      };
    }
  }

  protected generateSettersAndGetters() {
    if (!this.properties) return;

    for (const key of this.properties) {
      if (typeof key !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, key);

      Object.defineProperty(this, key, {
        get: () => {
          const dataRec = this.data as Record<string, unknown>;
          let val = dataRec ? dataRec[key] : undefined;

          if (isRef && val) {
            if (Array.isArray(val)) {
              return val
                .map((id: string) => this.findReference(id, key))
                .filter(Boolean);
            } else {
              return this.findReference(val as string, key);
            }
          }
          return val;
        },
        set: (v: any) => {
          if (this.data) (this.data as any)[key] = v;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  public getValue(key_: keyof IsData<T> & string): unknown {
    const key = key_ as keyof this;
    const dataRec = this.data as Record<string, unknown>;
    return this[key] === undefined
      ? dataRec
        ? dataRec[key_]
        : undefined
      : (this as any)[key_];
  }

  protected findReference(id: string | MongoId, key: string): unknown {
    if (!id || !this.parentManager) return undefined;
    const idStr = id.toString();
    const cacheRec = this.parentManager.cache.references as Record<string, any>;
    if (cacheRec[key]) return cacheRec[key].getObject(idStr);
    for (const manager of Object.values(this.parentManager.managers)) {
      const result = (manager as any).getObject(idStr);
      if (result) {
        cacheRec[key] = manager;
        return result;
      }
    }
    return undefined;
  }

  public async setValue<K extends keyof IsData<T> & string>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
    options: {
      silent?: boolean;
      noGet?: boolean;
      noUpdate?: boolean;
      isParentUpdate?: boolean;
    } = {},
  ): Promise<{ success: boolean; msg: string }> {
    const {
      silent = false,
      noUpdate = false,
      isParentUpdate = false,
    } = options;
    try {
      const isRef = getMetadataRecursive("isRef", this, key as string);
      const pointer = getMetadataRecursive("refsTo", this, key as string);

      if (pointer && !isParentUpdate && !silent && !this.isServer) {
        throw new Error("Cannot set value of a reference pointer directly.");
      }

      let valueToStore = val as any;
      if (isRef) {
        valueToStore = Array.isArray(val)
          ? (val as any[]).map(
              (v: any) => (v as any)._id?.toString() ?? v.toString(),
            )
          : ((val as any)?._id?.toString() ?? val?.toString() ?? val);
      }

      const dataRec = this.data as Record<string, unknown>;
      const currentVal = dataRec ? dataRec[key as string] : undefined;

      if (_.isEqual(currentVal, valueToStore))
        return { success: true, msg: "Successfully set " + key + " to " + val };

      const res = await this.setValueInternal(
        key as string,
        valueToStore,
        silent,
        noUpdate,
      );
      if (res.success) {
        if (this.data) (this.data as any)[key as string] = valueToStore;

        await this.findAndLoadReferences(key as string, valueToStore);
        if (isRef && this.parentManager && this.parentManager.isLoaded)
          await this.contactChildren();
        if (this.isLoaded)
          this.callbacks.update(this as unknown as T, key as string);
      }
      return {
        ...res,
        msg: res.msg ?? "Successfully set " + key + " to " + val,
      };
    } catch (error: any) {
      this.loggers.error?.(`Error setting value ${key}: ${error.message}`);
      return { success: false, msg: error.message };
    }
  }

  protected async setValueInternal(
    key: string,
    value: unknown,
    silent: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (silent || noUpdate)
      return { success: true, msg: "Silent or no update" };
    return new Promise((resolve) => {
      const dataRec = this.data as Record<string, unknown>;
      const id = dataRec ? (dataRec["_id"] as MongoId | undefined) : undefined;
      if (!id) return resolve({ success: false, msg: "Missing _id" });

      if (!this.socket || typeof this.socket.emit !== "function") {
        return resolve({ success: false, msg: "Socket not available" });
      }

      const timeout = setTimeout(() => {
        resolve({ success: false, msg: "Timeout waiting for server response" });
      }, 5000);

      this.socket.emit(
        EVENT_UPDATE + this.className + id.toString(),
        { _id: id.toString(), key, value },
        (res: ServerResponse<never>) => {
          clearTimeout(timeout);
          resolve({
            success: res.success,
            msg: res.message ?? (res.success ? "Success" : "Error"),
          });
        },
      );
    });
  }

  protected makeUpdate(key: string, value: unknown): ServerUpdateRequest<T> {
    const dataRec = this.data as Record<string, unknown>;
    const id = dataRec ? (dataRec["_id"] as MongoId | undefined) : undefined;
    if (!id) {
      this.loggers.error?.(
        `Probably missing the identifier ['_id'] again: ${key} = ${value}`,
      );
      throw new Error(
        `Cannot make update for ${this.className} because _id is missing.`,
      );
    }
    return { _id: id, key, value };
  }

  protected async resolveReference(
    id: string,
  ): Promise<AutoUpdatedClientObject<any, any> | null> {
    if (!this.parentManager) return null;
    for (const manager of Object.values(this.parentManager.managers)) {
      const obj = (manager as any).getObject(id);
      if (obj) return obj as any;
    }
    return null;
  }

  private async findAndLoadReferences(lastPath: string, value: unknown) {
    const isRef = getMetadataRecursive("isRef", this, lastPath);
    if (isRef && this.parentManager) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (!id) continue;
        let result: any;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = (manager as any).getObject(id?.toString());
          if (result) break;
        }
        if (result && typeof result.loadMissingReferences === "function") {
          await result.loadMissingReferences();
        }
      }
    }
  }

  protected async wipeSelf() {
    const dataRec = this.data as Record<string, unknown>;
    if (!dataRec || dataRec["Wiped"]) return;
    const id = dataRec["_id"] as MongoId | undefined;
    const _id = id ? id.toString() : "unknown";
    for (const key of Object.keys(dataRec)) {
      delete dataRec[key];
    }
    dataRec["Wiped"] = true;
    this.loggers.info?.(`[${_id}] ${this.className} object wiped`);
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this,
    alreadySeen: string[] = [],
  ) {
    if (!obj) return;
    if (obj === this.data) {
      const dataRec = this.data as Record<string, unknown>;
      const myId = (dataRec["_id"] as MongoId | undefined)?.toString();
      if (myId && !alreadySeen.includes(myId)) alreadySeen.push(myId);
    }
    const props =
      (Reflect.getMetadata("props", proto) as string[] | undefined) || [];
    for (const key of props) {
      const isRef = Reflect.getMetadata("isRef", proto, key);
      const pointer = Reflect.getMetadata("refsTo", proto, key) as
        | string
        | undefined;
      const objRec = obj as Record<string, unknown>;
      if (
        pointer &&
        obj === this.data &&
        objRec[key] &&
        !alreadySeen.includes(JSON.stringify(obj))
      ) {
        await this.createdWithParent(pointer.split(":"), objRec[key] as any);
      }
      if (objRec[key] && !alreadySeen.includes(objRec[key] as string))
        alreadySeen.push(objRec[key] as string);
      if (isRef) await this.handleLoad(obj, key, alreadySeen);

      const val = objRec[key];
      if (val && typeof val === "object") {
        const nestedProto = Object.getPrototypeOf(val);
        if (
          nestedProto &&
          nestedProto !== Object.prototype &&
          !alreadySeen.includes(JSON.stringify(val))
        ) {
          alreadySeen.push(JSON.stringify(val));
          await this.loadForceReferences(val, nestedProto, alreadySeen);
        }
      }
    }
  }

  private async handleLoad(obj: unknown, key: string, alreadySeen: string[]) {
    if (!this.parentManager) return;
    const objRec = obj as Record<string, unknown>;
    const refIds = Array.isArray(objRec[key])
      ? (objRec[key] as unknown[])
      : [objRec[key]];
    for (const refId of refIds) {
      if (refId) {
        const idStr = refId.toString();
        let result = globalCache.objects[idStr]?.object as any;
        if (!result) {
          for (const manager of Object.values(this.parentManager.managers)) {
            result = (manager as any).getObject(idStr);
            if (result) break;
          }
        }
        if (result && !alreadySeen.includes(idStr)) {
          alreadySeen.push(idStr);
          await result.loadForceReferences(undefined, undefined, alreadySeen);
        }
      }
    }
  }

  public async onUpdate(noUpdate: boolean = false) {
    if (noUpdate) return;
    await this.callbacks?.onUpdate?.(
      this as unknown as T,
      (key: any, val: any) => {
        return this.setValue(key, val, {
          silent: false,
          noGet: true,
          noUpdate: true,
        });
      },
    );
  }

  protected async createdWithParent(pointer: string[], parent: T | string) {
    if (pointer.length !== 2 || !this.parentManager) return;
    const parentId =
      (parent as any)._id?.toString() ?? (parent as string).toString();
    const ac = this.parentManager.managers[pointer[0]];
    if (!ac) return;
    const obj = (ac as any).getObject(parentId) as AutoUpdatedClientObject<
      any,
      any
    >;
    if (!obj) return;
    const val = obj.getValue(pointer[1] as any);
    const dataRec = this.data as Record<string, unknown>;
    const myId = (dataRec["_id"] as MongoId | undefined)?.toString();
    if (!myId) return;

    if (Array.isArray(val)) {
      const ids = (val as any[]).map(
        (v) => (v as any)._id?.toString() ?? v.toString(),
      );
      if (!ids.includes(myId)) {
        await (obj as any).setValue(
          pointer[1] as any,
          [...(val as any[]), myId],
          { silent: true, isParentUpdate: true },
        );
      }
    } else if (
      ((val as any)?._id?.toString() ?? (val as any)?.toString()) !== myId
    ) {
      await (obj as any).setValue(pointer[1] as any, myId, {
        silent: true,
        isParentUpdate: true,
      });
    }
  }

  public async destroy(
    once: boolean = false,
  ): Promise<{ success: boolean; message: string }> {
    for (const timer of this.preloadTimers) {
        clearTimeout(timer);
    }
    this.preloadTimers.clear();

    const dataRec = this.data as Record<string, unknown>;
    const id = dataRec ? (dataRec["_id"] as MongoId | undefined) : undefined;
    if (!id) return { success: false, message: "Missing _id" };
    if (!once && this.parentManager)
      return await this.parentManager.deleteObject(id);
    return new Promise((resolve) => {
      if (!this.socket || typeof this.socket.emit !== "function") {
        return resolve({ success: false, message: "Socket not available" });
      }

      const timeout = setTimeout(() => {
        resolve({
          success: false,
          message: "Timeout waiting for server deletion",
        });
      }, 5000);

      this.socket.emit(
        EVENT_DELETE + this.className,
        id.toString(),
        (res: ServerResponse<undefined>) => {
          clearTimeout(timeout);
          resolve({ success: res.success, message: res.message ?? "" });
        },
      );
    });
  }

  public destroyImmediate() {
    this.isDestroyed = true;
    for (const timer of this.preloadTimers) {
        clearTimeout(timer);
    }
    this.preloadTimers.clear();
    this.isLoading = false;
  }

  private async checkForMissingRefs() {
    for (const prop of this.properties) {
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (typeof pointer === "string") {
        const parts = pointer.split(":");
        if (parts.length === 2)
          await this.findMissingObjectReference(prop, parts);
      }
    }
  }

  private async findMissingObjectReference(
    prop: keyof IsData<T> & string,
    pointer: string[],
  ) {
    if (this.checkedMissingRefs || !this.parentManager) return;
    this.checkedMissingRefs = true;
    const ac = this.parentManager.managers[pointer[0]];
    if (!ac) return;

    const dataRec = this.data as Record<string, unknown>;
    const targetId = dataRec
      ? (dataRec["_id"] as MongoId | undefined)?.toString()
      : undefined;
    if (!targetId) return;
    const allObjects = Object.values(
      (ac as any).objects,
    ) as AutoUpdatedClientObject<any, any>[];

    for (const obj of allObjects) {
      if (!obj.isLoaded) await obj.waitForPreloaded();
      const val = obj.getValue(pointer[1] as any);
      if (!val) continue;

      const ids = Array.isArray(val)
        ? (val as any[]).map((v) => (v as any)._id?.toString() ?? v.toString())
        : [(val as any)._id?.toString() ?? (val as any).toString()];
      if (ids.includes(targetId)) {
        dataRec[prop] = (obj as any)._id;
        return;
      }
    }
  }

  public async contactChildren() {
    for (const prop of this.properties) {
      const isRef = getMetadataRecursive("isRef", this, prop.toString());
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (!isRef || pointer) continue;

      const obj = this.getValue(prop);
      if (!obj) continue;

      const children = Array.isArray(obj) ? obj : [obj];
      for (const child of children) {
        if (
          child &&
          typeof (child as any).loadMissingReferences === "function"
        ) {
          await (child as any).loadMissingReferences();
        }
      }
    }
    this.generateSettersAndGetters();
  }
}

export function processIsRefProperties(
  instance: Record<string, any>,
  target: object,
  prefix: string | null,
  allProps: string[],
  newData: Record<string, unknown>,
  loggers: LoggersType,
) {
  const props: string[] = Reflect.getMetadata("props", target) || [];
  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
    if (!instance) continue;

    newData[prop] = ObjectId.isValid(instance[prop])
      ? instance[prop]?.toString()
      : instance[prop];
    if (Reflect.getMetadata("isRef", target, prop)) {
      if (Array.isArray(instance[prop]))
        newData[prop] = (instance[prop] as any[])
          .map((item: any) => item?._id?.toString() ?? item?.toString())
          .filter(Boolean);
      else
        newData[prop] =
          instance[prop]?._id?.toString() ?? instance[prop]?.toString();
    }
    const type = Reflect.getMetadata("design:type", target, prop) as {
      prototype?: object;
    };
    if (type?.prototype) {
      // DO NOT RECURSE into nested prototypes to avoid circularity issues
    }
  }
  return { allProps, newData };
}

export function getMetadataRecursive(
  metaKey: string,
  target: object,
  prop: string,
): unknown {
  let proto = target;
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta !== undefined) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
