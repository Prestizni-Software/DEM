import "reflect-metadata";
import _ from "lodash";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  PathValueOf,
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
  ServerResponse,
} from "./CommonTypes";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass";

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
  protected loadError?: string;
  protected isLoadingReferences = true;
  protected checkedMissingRefs = false;
  protected readonly emitter: EventEmitter3;
  public readonly properties: (keyof OnlyAddedKeys<T, AutoUpdatedClientObject<T>>)[];
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
        await this.setValue__(thing.key, thing.value, true, false, false, true);
      }
    } catch (error: any) {
      this.loggers.error?.("Error loading references: " + error.message);
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
      this.classParam = classParam!;
      this.socket = socket!;
      this.data = data as any;
      this.loggers = loggers!;
      this.className = className!;
      this.parentManager = parentManager!;
      this.callbacks = callback!;
      this.emitter = emitter!;
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
      const props = (Reflect.getOwnMetadata("props", proto_) as string[]) || [];
      for (const p of props) allProps.add(p);
      proto_ = Object.getPrototypeOf(proto_);
    }
    this.properties = Array.from(allProps) as any;
    this.callbacks = callback!;

    this.loggers = {
      debug: (s: string) =>
        loggers.debug?.(
          `[DEM - ${this.className}: ${
            (this.data as any)?._id ?? (this as any)._id ?? "not loaded"
          }] ${s}`,
        ),
      info: (s: string) =>
        loggers.info?.(
          `[DEM - ${this.className}: ${
            (this.data as any)?._id ?? (this as any)._id ?? "not loaded"
          }] ${s}`,
        ),
      warn: (s: string) =>
        loggers.warn?.(
          `[DEM - ${this.className}: ${
            (this.data as any)?._id ?? (this as any)._id ?? "not loaded"
          }] ${s}`,
        ),
      error: (s: string) =>
        loggers.error?.(
          `[DEM - ${this.className}: ${
            (this.data as any)?._id ?? (this as any)._id ?? "not loaded"
          }] ${s}`,
        ),
    };

    if (typeof data === "string") {
      this.data = { _id: data } as any;
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
            this.loadError = res.message;
            this.loggers.error?.("Could not load data from server: " + res.message);
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, true, res.message);
            return;
          }
          this.data = res.data as any;
          this.generateSettersAndGetters();
          this.isLoading = false;
          this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
          this.openSockets();
        },
      );
    } else {
      this.isLoading = true;
      this.data = data as any;
      for (const key of (this.properties as string[]) || []) {
        const isRef = getMetadataRecursive("isRef", this, key);
        if (isRef && (this.data as any)[key]) {
          if (Array.isArray((this.data as any)[key])) {
            (this.data as any)[key] = (this.data as any)[key].map(
              (obj: any) => obj._id?.toString() ?? obj?.toString(),
            );
          } else {
            (this.data as any)[key] =
              (this.data as any)[key]?._id?.toString() ??
              (this.data as any)[key]?.toString();
          }
        }
      }
      if (
        (!(this.data as any)._id || (this.data as any)._id === "") &&
        !this.isServer
      ) {
        this.handleNewObject(data as any);
      } else {
        this.isLoading = false;
        if (!this.isServer) this.openSockets();
      }
    }
    this.generateSettersAndGetters();

    Promise.resolve().then(() => {
      this.generateSettersAndGetters();
    });
  }

  public async waitForPreloaded(): Promise<void> {
    if (this.loadError) throw new Error(this.loadError);
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

  protected handleNewObject(data: IsData<T>): void {
    this.isLoading = true;
    this.socket.emit(EVENT_NEW + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loadError = res.message;
        this.loggers.error?.("Could not create data on server: " + res.message);
        this.emitter.emit(
          EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
          true,
          res.message,
        );
        return;
      }
      this.data = res.data as any;
      this.generateSettersAndGetters();
      this.isLoading = false;
      this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
      if (!this.isServer) this.openSockets();
    });
  }

  public get extractedData(): ExtractedData<T, AutoUpdatedClientObject<T>> {
    const extracted = processIsRefProperties(
      this.data,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData;
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
    const id = (this.data as any)?._id ?? (this as any)._id;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.on(event, async (update: any, ack: any) => {
      const res = await this.handleUpdateRequest(update);
      if (ack && typeof ack === "function") ack(res);
      return res;
    });
  }

  private async handleUpdateRequest(update: any) {
    try {
      await this.setValue__(update.key, update.value, true);
      if (this.isLoaded) this.callbacks.update(this as any, update.key);
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      this.loggers.error?.(
        `[${(this.data as any)._id}] Error applying patch: ${error.message}`,
      );
      return {
        success: false,
        message: "Error applying update: " + error.message,
      };
    }
  }

  protected generateSettersAndGetters(): void {
    if (!this.properties) return;
    for (const key of this.properties as string[]) {
      if (typeof key !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, key);

      delete (this as any)[key];
      Object.defineProperty(this, key, {
        get: () => {
          if (!this.data) return undefined;
          let val = (this.data as any)[key];
          if (val === null) val = undefined;
          if (isRef && val) {
            if (Array.isArray(val)) {
              return val
                .map((id: any) => this.findReference(id, key))
                .filter(Boolean);
            } else {
              return this.findReference(val, key);
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

  public getValue(key_: Paths<T, AutoUpdatedClientObject<unknown>>): any {
    const key = key_ as string;
    const parts = key.split(".");
    let value: any = this;
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      const nextValue = value[part];
      if (nextValue !== undefined) {
        value = nextValue;
      } else if (value.data && value.data[part] !== undefined) {
        value = value.data[part];
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
        this.parentManager.cache.references[key] = manager as any;
        return result;
      }
    }
    return undefined;
  }

  public async setValue<K extends Paths<T, AutoUpdatedClientObject<T>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key as any, val);
  }

  protected async setValue__(
    key: any,
    val: any,
    silent = false,
    noGet = false,
    noUpdate = false,
    isParentUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    try {
      const isRef = getMetadataRecursive("isRef", this, key);
      const pointer = getMetadataRecursive("refsTo", this, key);
      if (pointer && !isParentUpdate && !silent && !this.isServer) {
        throw new Error("Cannot set value of a reference pointer directly.");
      }
      let valueToStore = val;
      if (isRef) {
        valueToStore = Array.isArray(val)
          ? val.map((v: any) => v._id?.toString() ?? v.toString())
          : val?._id ?? val?.toString() ?? val;
      }
      const currentVal = this.getValue(key);
      const currentValId = Array.isArray(currentVal)
        ? currentVal.map((v: any) => v._id?.toString() ?? v.toString())
        : currentVal?._id ?? currentVal?.toString();

      if (_.isEqual(currentValId, valueToStore))
        return { success: true, msg: "Successfully set " + key + " to " + val };

      const path = (key as string).split(".");
      if (path.length > 1) {
        let obj = this.data as any;
        for (let i = 0; i < path.length - 1; i++) {
          const currentKey = path[i];
          if (
            typeof obj[currentKey] === "string" ||
            ObjectId.isValid(obj[currentKey])
          ) {
            const ref = await this.resolveReference(obj[currentKey].toString());
            if (!ref)
              throw new Error("Could not resolve reference on path: " + key);
            return await ref.setValue(path.slice(i + 1).join(".") as any, val);
          }
          obj = obj[currentKey];
        }
      }

      const res = await this.setValueInternal(key, valueToStore, silent, noUpdate);
      if (res.success) {
        const pathArr = (key as string).split(".");
        let obj = this.data as any;
        for (let i = 0; i < pathArr.length - 1; i++) {
          obj = obj[pathArr[i]];
        }
        obj[pathArr[pathArr.length - 1]] = valueToStore;
        await this.findAndLoadReferences(key, valueToStore);
        if (isRef && this.parentManager.isLoaded) await this.contactChildren();
        if (this.isLoaded) this.callbacks.update(this as any, key);
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
    value: any,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (silent) return { success: true, msg: "Silent" };
    return new Promise((resolve) => {
      const id = (this.data as any)?._id ?? (this as any)._id;
      this.socket.emit(
        EVENT_UPDATE + this.className + id,
        { _id: id.toString(), key, value },
        (res: ServerResponse<undefined>) => {
          resolve({
            success: res.success,
            msg: res.message ?? (res.success ? "Success" : "Error"),
          });
        },
      );
    });
  }

  protected makeUpdate(key: string, value: any): ServerUpdateRequest<T> {
    const id = (this.data as any)?._id ?? (this as any)._id;
    if (!id) {
      this.loggers.error?.(
        `Probably missing the identifier ['_id'] again: ${key} = ${value}`,
      );
      throw new Error(
        `Cannot make update for ${this.className} because _id is missing.`,
      );
    }
    return { _id: id.toString(), key, value };
  }

  protected async resolveReference(
    id: string,
  ): Promise<AutoUpdatedClientObject<any> | null> {
    for (const manager of Object.values(this.parentManager.managers)) {
      const obj = manager.getObject(id);
      if (obj) return obj;
    }
    return null;
  }

  private async findAndLoadReferences(lastPath: string, value: any) {
    const isRef = getMetadataRecursive("isRef", this, lastPath);
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (!id) continue;
        let result: any;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = manager.getObject(id?.toString());
          if (result) break;
        }
        if (result && typeof result.loadMissingReferences === "function") {
          await result.loadMissingReferences();
        }
      }
    }
  }

  protected async wipeSelf(): Promise<void> {
    if ((this.data as any).Wiped) return;
    const id = (this.data as any)?._id ?? (this as any)._id;
    const _id = id ? id.toString() : "unknown";
    for (const key of Object.keys(this.data as any)) {
      delete (this.data as any)[key];
    }
    (this.data as any) = { Wiped: true };
    this.loggers.info?.(`[${_id}] ${this.className} object wiped`);
  }

  public destroyImmediate() {
    this.wipeSelf();
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this,
    alreadySeen: any[] = [],
  ) {
    const props = (Reflect.getMetadata("props", proto) as string[]) || [];
    for (const key of props) {
      if (typeof key !== "string") continue;
      const isRef = Reflect.getMetadata("isRef", proto, key);
      const pointer = Reflect.getMetadata("refsTo", proto, key) as string;

      if (
        pointer &&
        obj === this.data &&
        obj[key] &&
        !alreadySeen.includes(obj)
      ) {
        await this.createdWithParent(pointer.split(":"), obj[key]);
      }

      if (obj[key] && !alreadySeen.includes(obj[key])) alreadySeen.push(obj[key]);

      if (isRef) await this.handleLoad(obj, key, alreadySeen);

      const val = obj[key];
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
    const refIds = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
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
          await (result as any).loadForceReferences(
            undefined,
            undefined,
            alreadySeen,
          );
        }
      }
    }
  }

  protected async createdWithParent(pointer: string[], parent: any): Promise<void> {
    if (pointer.length !== 2) return;
    const parentId = parent._id?.toString() ?? parent.toString();
    const obj = (this.parentManager.managers[pointer[0]] as any)?.getObject(
      parentId,
    );
    if (!obj) return;
    const val = obj.getValue(pointer[1]);
    const myId = (this.data as any)._id.toString();
    if (Array.isArray(val)) {
      const ids = val.map((v: any) => v._id?.toString() ?? v.toString());
      if (!ids.includes(myId)) {
        await obj.setValue__(
          pointer[1],
          [...val, myId],
          true,
          false,
          false,
          true,
        );
      }
    } else if ((val?._id?.toString() ?? val?.toString()) !== myId) {
      await obj.setValue__(pointer[1], myId, true, false, false, true);
    }
  }

  public async destroy(once = false): Promise<{ success: boolean; message: string }> {
    if (!once) return await this.parentManager.deleteObject((this.data as any)._id);
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_DELETE + this.className,
        (this.data as any)._id,
        (res: ServerResponse<undefined>) => {
          resolve({ success: res.success, message: res.message ?? "" });
        },
      );
    });
  }

  private async checkForMissingRefs() {
    for (const prop of this.properties as string[]) {
      const pointer = getMetadataRecursive("refsTo", this, prop.toString()) as string;
      if (pointer) {
        const parts = pointer.split(":");
        if (parts.length === 2)
          await this.findMissingObjectReference(prop, parts);
      }
    }
  }

  private async findMissingObjectReference(prop: string, pointer: string[]) {
    if (this.checkedMissingRefs) return;
    this.checkedMissingRefs = true;
    const ac = (this.parentManager.managers as any)[pointer[0]];
    if (!ac) return;
    const targetId = (this.data as any)._id.toString();
    const allObjects = Object.values(ac.objects) as AutoUpdatedClientObject<any>[];
    for (const obj of allObjects) {
      if (!obj.isLoaded) await obj.waitForPreloaded();
      const val = obj.getValue(pointer[1] as any);
      if (!val) continue;
      const ids = Array.isArray(val)
        ? val.map((v: any) => v._id?.toString() ?? v.toString())
        : [val._id?.toString() ?? val.toString()];
      if (ids.includes(targetId)) {
        (this.data as any)[prop] = obj._id;
        return;
      }
    }
  }

  public async contactChildren(): Promise<void> {
    for (const prop of this.properties as string[]) {
      const isRef = getMetadataRecursive("isRef", this, prop.toString());
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (!isRef || pointer) continue;
      const obj = this.getValue(prop as any);
      if (!obj) continue;
      const children = Array.isArray(obj) ? obj : [obj];
      for (const child of children) {
        if (child && typeof child.loadMissingReferences === "function") {
          await child.loadMissingReferences();
        }
      }
    }
  }

  public async onUpdate(): Promise<void> {
    // Placeholder for server-side override
  }
}

export function processIsRefProperties(
  instance: any,
  target: any,
  prefix: string | null,
  allProps: string[],
  newData: any,
  loggers: LoggersType,
): { allProps: string[]; newData: any } {
  const props = (Reflect.getMetadata("props", target) as string[]) || [];
  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
    newData[prop] = ObjectId.isValid(instance[prop])
      ? instance[prop]?.toString()
      : instance[prop];
    if (Reflect.getMetadata("isRef", target, prop)) {
      if (Array.isArray(instance[prop]))
        newData[prop] = instance[prop]
          .map((item: any) => item?._id?.toString() ?? item?.toString())
          .filter(Boolean);
      else
        newData[prop] =
          instance[prop]?._id?.toString() ?? instance[prop]?.toString();
    }
    const type = Reflect.getMetadata("design:type", target, prop) as {
      prototype?: any;
    };
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

export function getMetadataRecursive(
  metaKey: string,
  proto: any,
  prop: string,
): any {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
