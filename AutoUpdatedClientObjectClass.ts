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
  ExtractedData,
  EVENT_INTERNAL_PRE_LOADED,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_NEW,
  EVENT_UPDATE,
  globalCache,
  ServerResponse,
  MongoId,
  IAutoUpdatedClientObject,
  IAutoUpdatedClientObjectBase,
  IAutoUpdateManager,
  DEMCache,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";

export type DEMClientCallbacks<T extends object> = {
  new: (obj: IAutoUpdatedClientObject<T>) => Promise<void> | void;
  update: (
    obj: IAutoUpdatedClientObject<T>,
    key: string,
  ) => Promise<void> | void;
  delete: (obj: IAutoUpdatedClientObject<T>) => Promise<void> | void;
  progress: (percent: number) => void;
};

type SocketType = Socket;

export abstract class AutoUpdatedClientObject<
  T extends IAutoUpdatedClientObjectBase,
  M extends Record<string, IAutoUpdateManager<any>> = Record<
    string,
    IAutoUpdateManager<any>
  >,
> implements IAutoUpdatedClientObject<T> {
  protected entry: unknown;

  protected readonly socket: SocketType;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  public abstract readonly _id: MongoId;
  protected readonly loggers: LoggersType;
  protected isLoading = true;
  public loadError?: string;
  protected isLoadingReferences = true;
  protected checkedMissingProperties: Record<string, boolean> = {};
  protected readonly emitter: EventEmitter3;
  public readonly properties: string[];
  public readonly classParam: Constructor<T>;
  public readonly className: string;
  public parentManager: IAutoUpdateManager<T> & {
    cache: DEMCache;
    managers: M;
  };
  protected readonly EmitterID = new ObjectId().toHexString();
  protected readonly toChangeOnParents: { key: string; value: unknown }[] = [];
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
    } catch (error: unknown) {
      // Fix 3: Enhanced diagnostics with stack trace
      this.loggers.error?.(
        "Error loading references: " +
          (error instanceof Error ? error.message + "\n" + error.stack : String(error)),
      );
    } finally {
      this.isLoadingReferences = false;
    }
  };

  constructor(
    classParam?: Constructor<T>,
    socket?: SocketType,
    data?: string | IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: IAutoUpdateManager<IAutoUpdatedClientObject<any>>,
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
      this.parentManager = parentManager as any;
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
    this.parentManager = parentManager as any;
    this.className = className;

    const staticPropsCache = (classParam as any).__propsCache;
    if (staticPropsCache) {
      this.properties = staticPropsCache;
    } else {
      const allProps = new Set<string>();
      let proto_ = classParam.prototype;
      while (proto_ && proto_ !== Object.prototype) {
        const props = Reflect.getOwnMetadata("props", proto_) || [];
        for (const p of props) allProps.add(p);
        proto_ = Object.getPrototypeOf(proto_);
      }
      this.properties = Array.from(allProps);
      (classParam as any).__propsCache = this.properties;
    }
    
    this.callbacks = callback!;

    this.loggers = {
      debug: (s: string) =>
        loggers.debug?.(
          `[DEM - ${this.className}: ${
            this.data?._id ?? this._id ?? "not loaded"
          }] ${s}`,
        ),
      info: (s: string) =>
        loggers.info?.(
          `[DEM - ${this.className}: ${
            this.data?._id ?? this._id ?? "not loaded"
          }] ${s}`,
        ),
      warn: (s: string) =>
        loggers.warn?.(
          `[DEM - ${this.className}: ${
            this.data?._id ?? this._id ?? "not loaded"
          }] ${s}`,
        ),
      error: (s: string) =>
        loggers.error?.(
          `[DEM - ${this.className}: ${
            this.data?._id ?? this._id ?? "not loaded"
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
            this.loggers.error?.(
              "Could not load data from server: " + res.message,
            );
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
          this.openSockets();
        },
      );
    } else {
      this.isLoading = true;
      if (this.isServer) {
        this.data = data;
      } else {
        this.data = _.cloneDeepWith(data, (value) => {
          if (value && typeof value === "object" && value._id && value.className) {
            return value._id.toString();
          }
        });
      }

      for (const key of this.properties || []) {
        const isRef = getMetadataRecursive("isRef", this, key);
        const dataAsRecord = this.data as unknown as Record<string, unknown>;
        if (isRef && dataAsRecord[key]) {
          if (Array.isArray(dataAsRecord[key])) {
            dataAsRecord[key] = (dataAsRecord[key] as unknown[]).map(
              (obj: unknown) =>
                (obj as { _id?: { toString(): string } | string })?._id?.toString() ??
                (obj as { toString(): string })?.toString(),
            );
          } else {
            dataAsRecord[key] =
              (dataAsRecord[key] as { _id?: { toString(): string } | string })?._id?.toString() ??
              (dataAsRecord[key] as { toString(): string })?.toString();
          }
        }
      }
      if ((!this.data._id || this.data._id === "") && !this.isServer) {
        this.handleNewObject(this.data as IsData<T>);
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
    this.socket.emit(
      EVENT_NEW + this.className,
      data,
      (res: ServerResponse<T>) => {
        if (!res.success) {
          this.isLoading = false;
          this.loadError = res.message;
          this.loggers.error?.(
            "Could not create data on server: " + res.message,
          );
          this.emitter.emit(
            EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
            true,
            res.message,
          );
          return;
        }
        this.data = res.data as unknown as IsData<T>;
        this.generateSettersAndGetters();
        this.isLoading = false;
        this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
        if (!this.isServer) this.openSockets();
      },
    );
  }

  public get extractedData(): ExtractedData<T, IAutoUpdatedClientObject<any>> {
    const extracted = processIsRefProperties(
      this.data,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData;
    return _.cloneDeep(extracted) as unknown as ExtractedData<
      T,
      IAutoUpdatedClientObject<any>
    >;
  }

  public get isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isPreLoadedAsync(): Promise<boolean> {
    await this.loadReferencesAsync();
    this.generateSettersAndGetters();
    return true;
  }

  public async loadMissingReferences(): Promise<void> {
    this.checkedMissingProperties = {};
    await this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const id = this.data?._id ?? this._id;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.on(
      event,
      async (update: unknown, ack: (res: ServerResponse<unknown>) => void) => {
        const res = await this.handleUpdateRequest(
          update as { key: string; value: unknown },
        );
        if (ack && typeof ack === "function") ack(res);
        return res;
      },
    );
  }

  private async handleUpdateRequest(update: {
    key: string;
    value: unknown;
  }): Promise<ServerResponse<unknown>> {
    try {
      await this.setValue__(update.key, update.value, true);
      if (this.isLoaded)
        this.callbacks.update(
          this as unknown as IAutoUpdatedClientObject<T>,
          update.key,
        );
      return { success: true, data: undefined, message: "" };
    } catch (error: unknown) {
      this.loggers.error?.(
        `[${this.data._id}] Error applying patch: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        message:
          "Error applying update: " +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  protected generateSettersAndGetters(): void {
    if (!this.properties) return;
    for (const key of this.properties as string[]) {
      if (typeof key !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, key);

      delete (this as Record<string, unknown>)[key];
      Object.defineProperty(this, key, {
        get: () => {
          if (!this.data) return undefined;
          let val = (this.data as Record<string, unknown>)[key];
          if (val === null) val = undefined;
          if (isRef && val) {
            if (Array.isArray(val)) {
              return val
                .map((id: string | ObjectId) => this.findReference(id, key))
                .filter(Boolean);
            } else {
              return this.findReference(val as string | ObjectId, key);
            }
          }
          return val;
        },
        set: (v: unknown) => {
          if (this.data) {
            let valueToSet = v;
            if (isRef && v) {
              if (Array.isArray(v)) {
                valueToSet = v.map((item) =>
                  item && (item as any)._id
                    ? (item as any)._id.toString()
                    : item?.toString(),
                );
              } else {
                valueToSet = (v as any)._id
                  ? (v as any)._id.toString()
                  : (v as any).toString();
              }
            }
            (this.data as Record<string, unknown>)[key] = valueToSet;
          }
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  public getValue<K extends Paths<T, IAutoUpdatedClientObject<any>>>(
    key_: K,
  ): PathValueOf<T, K>;
  public getValue(key_: string): any;
  public getValue(key_: string): any {
    const key = key_ as string;
    const parts = key.split(".");
    let value: any = this;
    for (const part of parts) {
      if (value === undefined || value === null) return undefined as any;
      const nextValue = (value as Record<string, unknown>)[part];
      if (nextValue !== undefined) {
        value = nextValue;
      } else if (
        (value as { data?: Record<string, unknown> }).data &&
        (value as { data: Record<string, unknown> }).data[part] !== undefined
      ) {
        value = (value as { data: Record<string, unknown> }).data[part];
      } else {
        return undefined as any;
      }
    }
    return value;
  }

  protected findReference(
    id: string | ObjectId,
    key: string,
  ): IAutoUpdatedClientObject<any> | undefined {
    if (!id) return undefined;
    const idStr = id.toString();
    const cacheKey = `${this.className}:${key}`;
    if (this.parentManager.cache.references[cacheKey])
      return (
        this.parentManager.cache.references[cacheKey]?.getObject(idStr) ?? undefined
      );
    for (const manager of Object.values(this.parentManager.managers)) {
      const result = manager.getObject(idStr);
      if (result) {
        this.parentManager.cache.references[cacheKey] = manager;
        return result as IAutoUpdatedClientObject<any>;
      }
    }
    return undefined;
  }

  public async setValue<K extends string>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key as string, val);
  }

  protected async setValue__(
    key: string,
    val: unknown,
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
          ? val.map(
              (v: unknown) =>
                (
                  v as { _id?: { toString(): string } | string }
                )?._id?.toString() ??
                (v as { toString(): string })?.toString() ??
                v,
            )
          : ((
              val as { _id?: { toString(): string } | string }
            )?._id?.toString() ??
            (val as { toString(): string })?.toString() ??
            val);
      }
      const currentVal = this.getValue(key as any);
      const currentValId = Array.isArray(currentVal)
        ? (currentVal as any[]).map(
            (v: unknown) =>
              (
                v as { _id?: { toString(): string } | string }
              )?._id?.toString() ??
              (v as { toString(): string })?.toString() ??
              v,
          )
        : ((
            currentVal as { _id?: { toString(): string } | string }
          )?._id?.toString() ??
          (currentVal as { toString(): string })?.toString());

      if (_.isEqual(currentValId, valueToStore))
        return { success: true, msg: "Successfully set " + key + " to " + val };

      const path = (key as string).split(".");
      if (path.length > 1) {
        let obj = this.data as Record<string, unknown>;
        for (let i = 0; i < path.length - 1; i++) {
          const currentKey = path[i];
          const valAtKey = obj[currentKey];
          if (
            typeof valAtKey === "string" ||
            (valAtKey && ObjectId.isValid(valAtKey as any))
          ) {
            const ref = await this.resolveReference(String(valAtKey));
            if (!ref)
              throw new Error("Could not resolve reference on path: " + key);
            return await ref.setValue(
              path.slice(i + 1).join(".") as any,
              val as any,
            );
          }
          obj = obj[currentKey] as Record<string, unknown>;
        }
      }

      const res = await this.setValueInternal(
        key,
        valueToStore,
        silent,
        noUpdate,
      );
      if (res.success) {
        const pathArr = (key as string).split(".");
        let obj = this.data as Record<string, unknown>;
        for (let i = 0; i < pathArr.length - 1; i++) {
          obj = obj[pathArr[i]] as Record<string, unknown>;
        }
        obj[pathArr[pathArr.length - 1]] = valueToStore;
        await this.findAndLoadReferences(key, valueToStore);
        if (isRef && this.parentManager.isLoaded) await this.contactChildren();
        if (this.isLoaded) {
          this.callbacks.update(
            this as unknown as IAutoUpdatedClientObject<T>,
            key,
          );
          await this.onUpdate(noUpdate);
        }
      }
      return {
        ...res,
        msg: res.msg ?? "Successfully set " + key + " to " + val,
      };
    } catch (error: unknown) {
      this.loggers.error?.(
        `Error setting value ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  }

  protected async setValueInternal(
    key: string,
    value: unknown,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (silent) return { success: true, msg: "Silent" };
    return new Promise((resolve) => {
      const id = this.data?._id ?? this._id;
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

  protected makeUpdate(key: string, value: unknown): ServerUpdateRequest<T> {
    const id = this.data?._id ?? this._id;
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
  ): Promise<IAutoUpdatedClientObject<any> | null> {
    for (const manager of Object.values(this.parentManager.managers)) {
      const obj = manager.getObject(id);
      if (obj) return obj as IAutoUpdatedClientObject<any>;
    }
    return null;
  }

  private async findAndLoadReferences(lastPath: string, value: unknown) {
    const isRef = getMetadataRecursive("isRef", this, lastPath);
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (!id) continue;
        let result: IAutoUpdatedClientObject<any> | undefined;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = manager.getObject(id?.toString()) as
            | IAutoUpdatedClientObject<any>
            | undefined;
          if (result) break;
        }
        if (result && result.parentManager.isLoaded && typeof result.loadMissingReferences === "function") {
          await result.loadMissingReferences();
        }
      }
    }
  }

  protected async wipeSelf(): Promise<void> {
    if ((this.data as unknown as { Wiped: boolean }).Wiped) return;
    const id = this.data?._id ?? this._id;
    const _id = id ? id.toString() : "unknown";
    for (const key of Object.keys(this.data as Record<string, unknown>)) {
      delete (this.data as Record<string, unknown>)[key];
    }
    (this.data as unknown as { Wiped: boolean }) = { Wiped: true };
    this.loggers.info?.(`[${_id}] ${this.className} object wiped`);
  }

  public destroyImmediate() {
    this.wipeSelf();
  }

  private async loadForceReferences(
    obj: Record<string, unknown> = this.data as unknown as Record<
      string,
      unknown
    >,
    proto: object = this,
    alreadySeen: unknown[] = [],
  ) {
    const props = (Reflect.getMetadata("props", proto) as string[]) || [];
    for (const key of props) {
      if (typeof key !== "string") continue;
      const pointer = Reflect.getMetadata("refsTo", proto, key) as string;
      const isRef = Reflect.getMetadata("isRef", proto, key) as boolean;
      if (
        pointer &&
        obj === (this.data as unknown as Record<string, unknown>) &&
        obj[key] &&
        !alreadySeen.includes(obj)
      ) {
        await this.createdWithParent(
          pointer.split(":"),
          obj[key] as Record<string, unknown>,
        );
      }

      if (obj[key] && !alreadySeen.includes(obj[key]))
        alreadySeen.push(obj[key]);

      const val = obj[key];
      if (val && typeof val === "object") {
        const nestedProto = Object.getPrototypeOf(val);
        if (nestedProto && !alreadySeen.includes(val)) {
          alreadySeen.push(val);
          await this.loadForceReferences(
            val as Record<string, unknown>,
            nestedProto,
            alreadySeen,
          );
        }
      }
    }
  }

  protected async createdWithParent(
    pointer: string[],
    parent: Record<string, unknown>,
  ): Promise<void> {
    if (pointer.length !== 2) return;
    const parentId =
      (parent._id as { toString(): string })?.toString() ?? parent.toString();
    
    this.loggers.debug?.(`createdWithParent: pointer=${pointer.join(":")}, parentId=${parentId}`);

    const manager = this.parentManager.managers[pointer[0]];
    if (!manager) {
      this.loggers.warn?.(`createdWithParent: Manager not found for ${pointer[0]}. Available managers: ${Object.keys(this.parentManager.managers).join(", ")}`);
      return;
    }

    const obj = manager.getObject(parentId) as
      | IAutoUpdatedClientObject<any>
      | undefined;
    if (!obj) {
      this.loggers.warn?.(`createdWithParent: Parent object not found for ID ${parentId} in manager ${pointer[0]}`);
      return;
    }
    const val = obj.getValue(pointer[1] as any);
    const myId = this.data._id.toString();
    const valLog = Array.isArray(val)
      ? `[${val.map((v: any) => v?._id?.toString() ?? v?.toString()).join(", ")}]`
      : (val as any)?._id?.toString() ?? String(val);
    this.loggers.debug?.(
      `createdWithParent: Current parent value for ${pointer[1]} is ${valLog}, myId=${myId}`,
    );
    if (Array.isArray(val)) {
      const ids = val.map(
        (v: unknown) =>
          (v as { _id?: { toString(): string } | string })?._id?.toString() ??
          (v as { toString(): string })?.toString(),
      );
      if (!ids.includes(myId)) {
        this.loggers.debug?.(`createdWithParent: Adding myId to parent array`);
        await (
          obj as unknown as {
            setValue__(
              key: string,
              val: unknown,
              silent?: boolean,
              noGet?: boolean,
              noUpdate?: boolean,
              isParentUpdate?: boolean,
            ): Promise<void>;
          }
        ).setValue__(pointer[1], [...val, myId], true, false, false, true);
      }
    } else if (
      ((val as { _id?: { toString(): string } | string })?._id?.toString() ??
        (val as { toString(): string })?.toString()) !== myId
    ) {
      this.loggers.debug?.(`createdWithParent: Setting myId to parent field`);
      await (
        obj as unknown as {
          setValue__(
            key: string,
            val: unknown,
            silent?: boolean,
            noGet?: boolean,
            noUpdate?: boolean,
            isParentUpdate?: boolean,
          ): Promise<void>;
        }
      ).setValue__(pointer[1], myId, true, false, false, true);
    }
  }

  public async destroy(
    once = false,
  ): Promise<{ success: boolean; message: string }> {
    if (!once)
      return await this.parentManager.deleteObject(this.data._id.toString());
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_DELETE + this.className,
        this.data._id,
        (res: ServerResponse<undefined>) => {
          resolve({ success: res.success, message: res.message ?? "" });
        },
      );
    });
  }

  private async checkForMissingRefs() {
    for (const prop of this.properties as string[]) {
      const pointer = getMetadataRecursive(
        "refsTo",
        this,
        prop.toString(),
      ) as string;
      if (pointer && !this.getValue(prop as any)) {
        const parts = pointer.split(":");
        if (parts.length === 2)
          await this.findMissingObjectReference(prop, parts);
      }
    }
  }

  private async findMissingObjectReference(prop: string, pointer: string[]) {
    if (this.checkedMissingProperties[prop]) return;
    this.checkedMissingProperties[prop] = true;
    const ac = (
      this.parentManager.managers as Record<
        string,
        IAutoUpdateManager<IAutoUpdatedClientObject<any>>
      >
    )[pointer[0]];
    if (!ac) return;
    const targetId = this.data._id.toString();
    const allObjects = Object.values(
      ac.objectsAsArray,
    ) as IAutoUpdatedClientObject<any>[];
    for (const obj of allObjects) {
      if (!obj.isLoaded) await obj.waitForPreloaded();
      const val = obj.getValue(pointer[1] as any);
      if (!val) continue;
      const ids = Array.isArray(val)
        ? val.map(
            (v: unknown) =>
              (
                v as { _id?: { toString(): string } | string }
              )?._id?.toString() ?? (v as { toString(): string }).toString(),
          )
        : [
            (
              val as { _id?: { toString(): string } | string }
            )._id?.toString() ?? (val as { toString(): string }).toString(),
          ];
      if (ids.includes(targetId)) {
        (this.data as Record<string, unknown>)[prop] = obj._id;
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
      for (const child of children as any[]) {
        if (
          child &&
          typeof (child as { loadMissingReferences?: () => Promise<void> })
            .loadMissingReferences === "function"
        ) {
          await (
            child as { loadMissingReferences(): Promise<void> }
          ).loadMissingReferences();
        }
      }
    }
    this.generateSettersAndGetters();
  }

  protected async onUpdate(noUpdate: boolean = false): Promise<void> {
    // Placeholder for server-side override
  }

  protected async onDeletion(): Promise<void> {
    // Placeholder for server-side override
  }
}

export function processIsRefProperties(
  instance: Record<string, unknown>,
  target: object,
  prefix: string | null,
  allProps: string[],
  newData: Record<string, unknown>,
  loggers: LoggersType,
): { allProps: string[]; newData: Record<string, unknown> } {
  const props = (Reflect.getMetadata("props", target) as string[]) || [];
  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
    newData[prop] =
      instance[prop] && ObjectId.isValid(instance[prop] as any)
        ? (instance[prop] as { toString(): string })?.toString()
        : instance[prop];
    if (Reflect.getMetadata("isRef", target, prop)) {
      if (Array.isArray(instance[prop]))
        newData[prop] = (instance[prop] as unknown[])
          .map(
            (item: unknown) =>
              (
                item as { _id?: { toString(): string } | string }
              )?._id?.toString() ??
              (item as { toString(): string })?.toString(),
          )
          .filter(Boolean);
      else
        newData[prop] =
          (
            instance[prop] as { _id?: { toString(): string } | string }
          )?._id?.toString() ??
          (instance[prop] as { toString(): string })?.toString();
    }
    const type = Reflect.getMetadata("design:type", target, prop) as {
      prototype?: object;
    };
    if (type?.prototype) {
      const nestedProps = Reflect.getMetadata("props", type.prototype);
      if (nestedProps && instance[prop]) {
        newData[prop] = processIsRefProperties(
          instance[prop] as Record<string, unknown>,
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
  proto: object | null,
  prop: string,
): unknown {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
