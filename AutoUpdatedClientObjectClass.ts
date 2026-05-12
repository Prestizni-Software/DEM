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
  Paths,
  OnlyAddedKeys,
  ExtractedData,
  EVENT_INTERNAL_PRE_LOADED,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_NEW,
  EVENT_UPDATE,
  globalCache,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { stringSimilarity } from "string-similarity-js";

export type DEMClientCallbacks<T> = {
  new: (obj: T) => Promise<void> | void;
  update: (obj: T, key: string) => Promise<void> | void;
  delete: (obj: T) => Promise<void> | void;
  progress: (percent: number) => void;
};

type SocketType = Socket<any, any>;

export abstract class AutoUpdatedClientObject<T> {
  protected entry: any;
  public preLoad: any;
  public registerSocket: any;
  public readyLoggers: any;
  public loadFromDB(a: any): any {}
  public setValue_(a: any, b: any): any {}

  protected readonly socket: SocketType;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  public abstract readonly _id: any;
  protected readonly loggers: LoggersType;
  protected isLoading = true;
  protected isLoadingReferences = true;
  protected checkedMissingRefs = false;
  protected readonly emitter: EventEmitter3;
  public readonly properties: (keyof OnlyAddedKeys<
    T,
    AutoUpdatedClientObject<T>
  >)[];
  public readonly classParam: Constructor<T>;
  public readonly className: string;
  public parentManager: AutoUpdateManager<AutoUpdatedClientObject<T>>;
  private readonly EmitterID = new ObjectId().toHexString();
  protected readonly toChangeOnParents: { key: string; value: any }[] = [];
  public callbacks: DEMClientCallbacks<T>;

  private readonly loadReferencesAsync = async (): Promise<void> => {
    try {
        if (!this.isLoaded) {
            await this.waitForPreloaded();
        }
        this.generateSettersAndGetters();
        await this.loadForceReferences();
        for (const thing of this.toChangeOnParents) {
          await this.setValue__(thing.key as any, thing.value, true, false, false, true);
        }
    } catch (error: any) {
        this.loggers.error("Error loading references: " + error.message);
    } finally {
        this.isLoadingReferences = false;
    }
  };

  /** @deprecated Use loadReferencesAsync instead */
  private readonly loadShit = this.loadReferencesAsync;

  constructor(
    classParam?: Constructor<T>,
    socket?: SocketType,
    data?: string | IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateManager<any>,
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
      this.classParam = classParam as any;
      this.socket = socket as any;
      this.data = data as any;
      this.loggers = loggers as any;
      this.className = className as any;
      this.parentManager = parentManager as any;
      this.callbacks = callback as any;
      this.emitter = emitter as any;
      this.properties = undefined as any;
      if (
        !classParam &&
        !socket &&
        !data &&
        !loggers &&
        !className &&
        !parentManager &&
        !callback &&
        !emitter
      )
        return;
      else throw new Error("Missing arguments???");
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
    let proto_ = classParam.prototype;
    while (proto_ && proto_ !== Object.prototype) {
        const props = Reflect.getOwnMetadata("props", proto_) || [];
        for (const p of props) allProps.add(p);
        proto_ = Object.getPrototypeOf(proto_);
    }
    this.properties = Array.from(allProps) as any;
    this.callbacks = callback as any;
    
    this.loggers = {
       debug: (s: string) => loggers.debug(`[DEM - ${this.className}: ${this.data?._id ?? "not loaded"}] ${s}`),
       info: (s: string) => loggers.info(`[DEM - ${this.className}: ${this.data?._id ?? "not loaded"}] ${s}`),
       warn: (s: string) => loggers.warn(`[DEM - ${this.className}: ${this.data?._id ?? "not loaded"}] ${s}`),
       error: (s: string) => loggers.error(`[DEM - ${this.className}: ${this.data?._id ?? "not loaded"}] ${s}`),
    };

    if (typeof data === "string") {
      this.data = { _id: data } as IsData<T>;
      if (this.isServer) {
        this.isLoading = false;
        this.generateSettersAndGetters();
        return;
      }
      this.socket.emit(
        EVENT_GET + this.className + data,
        null,
        (res: ServerResponse<T>) => {
          if (!res.success) {
            this.isLoading = false;
            this.loggers.error("Could not load data from server: " + res.message);
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
            return;
          }
          this.data = res.data as IsData<T>;
          this.generateSettersAndGetters();
          this.isLoading = false;
          this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
          this.openSockets();
        },
      );
    } else {
      this.isLoading = true;
      this.data = data;
      for (const key of this.properties || []) {
        const isRef = getMetadataRecursive("isRef", this, key as string);
        if (isRef && (this.data as any)[key]) {
          if (Array.isArray((this.data as any)[key])) {
            (this.data as any)[key] = ((this.data as any)[key] as any[]).map(
              (obj) => obj._id?.toString() ?? obj?.toString(),
            ) as any;
          } else {
            (this.data as any)[key] = ((this.data as any)[key] as any)?._id?.toString() ?? (this.data as any)[key]?.toString();
          }
        }
      }

      if ((!this.data._id || this.data._id === "") && !this.isServer) {
        this.handleNewObject(data);
      } else {
        this.isLoading = false;
        if (!this.isServer) this.openSockets();
      }
    }
    
    this.generateSettersAndGetters();
    // Re-apply getters in a microtask to override any shadowing from subclass field initializers.
    Promise.resolve().then(() => {
        this.generateSettersAndGetters();
    });
  }

  public async waitForPreloaded() {
    if (this.isLoaded) return;
    await new Promise<void>((resolve, reject) => {
      this.emitter.once(
        EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
        (failed: boolean, reason: string) => {
          if (failed) reject(new Error(reason));
          else resolve();
        },
      );
    });
  }

  protected handleNewObject(data: IsData<T>) {
    this.isLoading = true;
    this.socket.emit(EVENT_NEW + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server: " + res.message);
        this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, true, res.message);
        return;
      }
      this.data = res.data as IsData<T>;
      this.generateSettersAndGetters();
      this.isLoading = false;
      this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
      if (!this.isServer) this.openSockets();
    });
  }

  public get extractedData(): ExtractedData<T, AutoUpdatedClientObject<T>> {
    const extracted = processIsRefProperties(this.data, this, null, [], {}, this.loggers).newData;
    return _.cloneDeep(extracted);
  }

  public get isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isPreLoadedAsync(): Promise<boolean> {
    await this.loadShit();
    return true;
  }

  public async loadMissingReferences(): Promise<void> {
    await this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const event = EVENT_UPDATE + this.className + this.data._id.toString();
    this.socket.on(
      event,
      async (update: ServerUpdateRequest<T>, ack: (res: ServerResponse<undefined>) => void) => {
        const res = await this.handleUpdateRequest(update);
        if (ack && typeof ack === "function") ack(res);
        return res;
      },
    );
  }

  private async handleUpdateRequest(update: ServerUpdateRequest<T>): Promise<ServerResponse<undefined>> {
    try {
      await this.setValue__(update.key as any, update.value, true);
      if (this.isLoaded) this.callbacks.update(this as any, update.key);
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      this.loggers.error(`[${this.data._id}] Error applying patch: ${error.message}`);
      return { success: false, message: "Error applying update: " + error.message };
    }
  }

  protected generateSettersAndGetters() {
    if (!this.properties) return;

    for (const key of this.properties) {
      if (typeof key !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, key);

      // CRITICAL: Delete any existing property on the instance to ensure our getter is used.
      delete (this as any)[key];

      Object.defineProperty(this, key, {
        get: () => {
          if (!this.data) return undefined;
          let val = (this.data as any)[key];
          if (val === null) val = undefined; // Fix for server-side MongoDB nulls
          
          if (isRef && val) {
            if (Array.isArray(val)) {
              return val.map((id: string) => this.findReference(id, key)).filter(Boolean);
            } else {
              return this.findReference(val, key);
            }
          }
          return val;
        },
        set: (v) => {
           if (this.data) (this.data as any)[key] = v;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  public getValue(key_: Paths<T, AutoUpdatedClientObject<unknown>>) {
    const key = key_ as string;
    const parts = key.split(".");
    let value: any = this;
    
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      // Try instance first (getters), then fallback to data
      const nextValue = value[part];
      if (nextValue !== undefined) {
          value = nextValue;
      } else if (value.data && (value.data as any)[part] !== undefined) {
          value = (value.data as any)[part];
      } else {
          return undefined;
      }
    }
    return value;
  }

  protected findReference(id: string | ObjectId, key: string): any {
    if (!id) return undefined;
    const idStr = id.toString();
    if (this.parentManager.cache.references[key])
      return this.parentManager.cache.references[key].getObject(idStr);
    for (const manager of Object.values(this.parentManager.managers)) {
      const result = manager.getObject(idStr);
      if (result) {
        this.parentManager.cache.references[key] = manager;
        return result;
      }
    }
    return undefined;
  }

  public async setValue<K extends Paths<T, AutoUpdatedClientObject<T>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key, val);
  }

  protected async setValue__(
    key: any,
    val: any,
    silent: boolean = false,
    noGet: boolean = false,
    noUpdate: boolean = false,
    isParentUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    try {
      const isRef = getMetadataRecursive("isRef", this, key as string);
      const pointer = getMetadataRecursive("refsTo", this, key as string);
      
      if (pointer && !isParentUpdate && !silent && !this.isServer) {
          throw new Error("Cannot set value of a reference pointer directly.");
      }

      let valueToStore = val;
      if (isRef) {
        valueToStore = Array.isArray(val)
          ? val.map((v: any) => v._id?.toString() ?? v.toString())
          : (val?._id ?? val?.toString() ?? val);
      }

      const currentVal = this.getValue(key as any);
      const currentValId = Array.isArray(currentVal) 
          ? (currentVal as any[]).map(v => v._id?.toString() ?? v.toString())
          : (currentVal?._id ?? currentVal?.toString());
      
      if (_.isEqual(currentValId, valueToStore)) return { success: true, msg: "Successfully set " + key + " to " + val };

      const path = (key as string).split(".");
      if (path.length > 1) {
          let obj = this.data as any;
          for (let i = 0; i < path.length - 1; i++) {
              const currentKey = path[i];
              if (typeof obj[currentKey] === 'string' || ObjectId.isValid(obj[currentKey])) {
                  const ref = await this.resolveReference(obj[currentKey].toString());
                  if (!ref) throw new Error("Could not resolve reference on path: " + key);
                  return await (ref as any).setValue(path.slice(i+1).join("."), val);
              }
              obj = obj[currentKey];
          }
      }

      const res = await this.setValueInternal(key as string, valueToStore, silent, noUpdate);
      if (res.success) {
        const pathArr = (key as string).split(".");
        let obj = this.data as any;
        for (let i = 0; i < pathArr.length - 1; i++) {
            obj = obj[pathArr[i]];
        }
        obj[pathArr[pathArr.length - 1]] = valueToStore;

        await this.findAndLoadReferences(key as string, valueToStore);
        if (isRef && this.parentManager.isLoaded) await this.contactChildren();
        if (this.isLoaded) this.callbacks.update(this as any, key as string);
      }
      return { ...res, msg: res.msg ?? "Successfully set " + key + " to " + val };
    } catch (error: any) {
      this.loggers.error(`Error setting value ${key}: ${error.message}`);
      return { success: false, msg: error.message };
    }
  }

  protected async setValueInternal(
    key: string,
    value: any,
    silent: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (silent) return { success: true, msg: "Silent" };
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_UPDATE + this.className + this.data._id,
        { _id: this.data._id.toString(), key, value },
        (res: ServerResponse<never>) => {
          resolve({ success: res.success, msg: res.message ?? (res.success ? "Success" : "Error") });
        }
      );
    });
  }

  protected makeUpdate(key: string, value: any): ServerUpdateRequest<T> {
    return { _id: this.data._id.toString(), key, value } as any;
  }

  protected async resolveReference(id: string): Promise<AutoUpdatedClientObject<any> | null> {
    for (const manager of Object.values(this.parentManager.managers)) {
      const obj = manager.getObject(id);
      if (obj) return obj as any;
    }
    return null;
  }

  private async findAndLoadReferences(lastPath: string, value: any) {
    const isRef = getMetadataRecursive("isRef", this, lastPath);
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (!id) continue;
        let result;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = manager.getObject(id?.toString());
          if (result) break;
        }
        if (result && typeof (result as any).loadMissingReferences === "function") {
          await (result as any).loadMissingReferences();
        }
      }
    }
  }

  protected async wipeSelf() {
    if ((this.data as any).Wiped) return;
    const _id = this.data._id.toString();
    for (const key of Object.keys(this.data)) {
      delete (this.data as any)[key];
    }
    this.data = { Wiped: true } as any;
    this.loggers.info(`[${_id}] ${this.className} object wiped`);
  }

  private async loadForceReferences(obj: any = this.data, proto: any = this, alreadySeen: any[] = []) {
    const props = Reflect.getMetadata("props", proto) || [];
    for (const key of props) {
      if (typeof key !== "string") continue;
      const isRef = Reflect.getMetadata("isRef", proto, key);
      const pointer = Reflect.getMetadata("refsTo", proto, key);
      if (pointer && obj === this.data && (obj as any)[key] && !alreadySeen.includes(obj)) {
        await this.createdWithParent(pointer.split(":"), (obj as any)[key]);
      }
      if ((obj as any)[key] && !alreadySeen.includes((obj as any)[key])) alreadySeen.push((obj as any)[key]);
      if (isRef) await this.handleLoad(obj, key, alreadySeen);
      
      const val = (obj as any)[key];
      if (val && typeof val === "object") {
          const nestedProto = Object.getPrototypeOf(val);
          if (nestedProto && !alreadySeen.includes(val)) {
              alreadySeen.push(val);
              await this.loadForceReferences(val, nestedProto, alreadySeen);
          }
      }
    }
  }

  private async handleLoad(obj: any, key: string, alreadySeen: any[]) {
    const refIds = Array.isArray((obj as any)[key]) ? (obj as any)[key] : [(obj as any)[key]];
    for (const refId of refIds) {
      if (refId) {
        const idStr = refId.toString();
        let result = globalCache.objects[idStr]?.object;
        if (!result) {
            for (const manager of Object.values(this.parentManager.managers)) {
                result = manager.getObject(idStr) as any;
                if (result) break;
            }
        }
        if (result && !alreadySeen.includes(idStr)) {
            alreadySeen.push(idStr);
            await (result as any).loadForceReferences(undefined, undefined, alreadySeen);
        }
      }
    }
  }

  protected async createdWithParent(pointer: string[], parent: T | string) {
    if (pointer.length !== 2) return;
    const parentId = (parent as any)._id?.toString() ?? (parent as string).toString();
    const obj = this.parentManager.managers[pointer[0]]?.getObject(parentId) as AutoUpdatedClientObject<any>;
    if (!obj) return;
    const val = obj.getValue(pointer[1] as any);
    const myId = this.data._id.toString();

    if (Array.isArray(val)) {
      const ids = (val as any[]).map(v => v._id?.toString() ?? v.toString());
      if (!ids.includes(myId)) {
          await obj.setValue__(pointer[1], [...(val as any[]), myId], true, false, false, true);
      }
    } else if ((val?._id?.toString() ?? val?.toString()) !== myId) {
      await obj.setValue__(pointer[1] as any, myId, true, false, false, true);
    }
  }

  public async destroy(once: boolean = false): Promise<{ success: boolean; message: string }> {
    if (!once) return await this.parentManager.deleteObject(this.data._id);
    return new Promise((resolve) => {
      this.socket.emit(EVENT_DELETE + this.className, this.data._id, (res: ServerResponse<undefined>) => {
        resolve({ success: res.success, message: res.message ?? "" });
      });
    });
  }

  private async checkForMissingRefs() {
    for (const prop of this.properties) {
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (pointer) {
        const parts = pointer.split(":");
        if (parts.length === 2) await this.findMissingObjectReference(prop, parts);
      }
    }
  }

  private async findMissingObjectReference(prop: any, pointer: string[]) {
    if (this.checkedMissingRefs) return;
    this.checkedMissingRefs = true;
    const ac = this.parentManager.managers[pointer[0]];
    if (!ac) return;

    const targetId = this.data._id.toString();
    const allObjects = Object.values(ac.objects);
    
    for (const obj of allObjects) {
      if (!(obj as any).isLoaded) await (obj as any).waitForPreloaded();
      const val = (obj as any).getValue(pointer[1]);
      if (!val) continue;

      const ids = Array.isArray(val) ? (val as any[]).map(v => v._id?.toString() ?? v.toString()) : [val._id?.toString() ?? val.toString()];
      if (ids.includes(targetId)) {
        (this.data as any)[prop] = (obj as any)._id;
        return;
      }
    }
  }

  public async contactChildren() {
    for (const prop of this.properties) {
      const isRef = getMetadataRecursive("isRef", this, prop.toString());
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (!isRef || pointer) continue;
      
      const obj = this.getValue(prop as any);
      if (!obj) continue;
      
      const children = Array.isArray(obj) ? obj : [obj];
      for (const child of children) {
        if (child && typeof (child as any).loadMissingReferences === "function") {
          await (child as any).loadMissingReferences();
        }
      }
    }
  }
}

export function processIsRefProperties(
  instance: any,
  target: any,
  prefix: string | null,
  allProps: string[],
  newData: any,
  loggers: LoggersType,
) {
  const props: string[] = Reflect.getMetadata("props", target) || [];
  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
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
    const type = Reflect.getMetadata("design:type", target, prop);
    if (type?.prototype) {
      const nestedProps = Reflect.getMetadata("props", type.prototype);
      if (nestedProps && instance[prop]) {
        newData[prop] = processIsRefProperties(
          instance[prop],
          type.prototype,
          path,
          allProps,
          {},
          loggers,
        ).newData;
      }
    }
  }
  return { allProps, newData };
}

export function getMetadataRecursive(metaKey: string, proto: any, prop: string) {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
