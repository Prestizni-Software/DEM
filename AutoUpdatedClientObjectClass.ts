import "reflect-metadata";
import _ from "lodash";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  PathValueOf,
  Paths,
  ServerUpdateRequest,
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
  DEMError,
  DEMErrorCode,
  toDEMError,
  DEMArray,
  DEMArrayMutationRequest,
  DEMArrayMutationResponse,
  DEMArrayMutationOp,
  DEMArrayMutationParams,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";

export type DEMClientCallbacks<T extends object> = {
  new: (obj: IAutoUpdatedClientObject<T>) => Promise<void> | void;
  update: (
    obj: IAutoUpdatedClientObject<T>,
    key: string,
  ) => Promise<void> | void;
  delete: (manager: IAutoUpdateManager<any>) => Promise<void> | void;
  progress: (percent: number) => void;
};

export const DEM_RAW_ARRAY: unique symbol = Symbol("DEM_RAW_ARRAY");

const MUTATING_ARRAY_METHODS = new Set<string | symbol>([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

/**
 * Wraps a resolved relation array in a Proxy that blocks external mutations
 * while allowing transparent read operations, iterations, and library unwrapping.
 *
 * @param rawArray - The internal mutable array of resolved entities.
 * @param propertyName - The name identifier of the relation property.
 * @returns Immutable proxy wrapping the underlying entity array.
 */
export function createReadOnlyArrayProxy<T>(
  rawArray: T[],
  propertyName: string,
): T[] {
  return new Proxy(rawArray, {
    get(target, prop, receiver) {
      if (prop === DEM_RAW_ARRAY) {
        return target;
      }
      if (MUTATING_ARRAY_METHODS.has(prop)) {
        return () => {
          throw new DEMError(
            DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
            `Cannot mutate DEM reference array '${propertyName}' directly. Use setValue() or manager mutation APIs.`,
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
    set() {
      throw new DEMError(
        DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
        `Cannot assign index on DEM reference array '${propertyName}'. Use setValue() or manager mutation APIs.`,
      );
    },
    deleteProperty() {
      throw new DEMError(
        DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
        `Cannot delete elements from DEM reference array '${propertyName}'. Use setValue() or manager mutation APIs.`,
      );
    },
  });
}

/**
 * Constructs a reactive DEMArray Proxy wrapper around entity array properties.
 * Exposes synchronous queries on committed local state and asynchronous mutation Promises.
 *
 * @param parent - The entity object containing this array.
 * @param propertyName - The name identifier of the array property.
 * @param isRef - Whether this property holds cross-entity reference pointers.
 * @param getItems - Function returning the currently resolved array items.
 * @returns Reactive DEMArray proxy instance.
 */
export function createDEMArray<T>(
  parent: AutoUpdatedClientObject<any>,
  propertyName: string,
  isRef: boolean,
  getItems: () => any[],
): DEMArray<T> {
  const dummyTarget: any[] = [];
  return new Proxy(dummyTarget, {
    get(_target, prop, receiver) {
      if (prop === DEM_RAW_ARRAY) {
        return ((parent as any).data as Record<string, unknown>)?.[propertyName] ?? [];
      }
      if (prop === "push") {
        return async (...items: any[]) => {
          return parent.mutateArrayQueue(propertyName, { op: "push", items }, isRef);
        };
      }
      if (prop === "pop") {
        return async () => {
          return parent.mutateArrayQueue(propertyName, { op: "pop" }, isRef);
        };
      }
      if (prop === "shift") {
        return async () => {
          return parent.mutateArrayQueue(propertyName, { op: "shift" }, isRef);
        };
      }
      if (prop === "unshift") {
        return async (...items: any[]) => {
          return parent.mutateArrayQueue(propertyName, { op: "unshift", items }, isRef);
        };
      }
      if (prop === "splice") {
        return async (start: number, deleteCount?: number, ...items: any[]) => {
          const current = getItems();
          const actualDeleteCount =
            deleteCount !== undefined ? deleteCount : Math.max(0, current.length - start);
          const targetIds: string[] = [];
          for (
            let i = start;
            i < start + actualDeleteCount && i < current.length;
            i++
          ) {
            const el = current[i];
            if (el && typeof el === "object" && "_id" in el) {
              targetIds.push(String((el as any)._id));
            } else if (el) {
              targetIds.push(String(el));
            }
          }
          const targetId = targetIds[0];
          return parent.mutateArrayQueue(
            propertyName,
            {
              op: "splice",
              index: start,
              deleteCount: actualDeleteCount,
              items,
              targetId,
              targetIds,
            },
            isRef,
          );
        };
      }
      if (prop === "set") {
        return async (index: number, item: any) => {
          const current = getItems();
          const targetEl = current[index];
          const targetId =
            targetEl && typeof targetEl === "object" && "_id" in targetEl
              ? String((targetEl as any)._id)
              : targetEl
                ? String(targetEl)
                : undefined;
          return parent.mutateArrayQueue(
            propertyName,
            { op: "set", index, items: [item], targetId },
            isRef,
          );
        };
      }
      if (prop === "reverse") {
        return async () => {
          return parent.mutateArrayQueue(propertyName, { op: "reverse" }, isRef);
        };
      }
      if (prop === "sort") {
        return async (compareFn?: (a: any, b: any) => number) => {
          return parent.mutateArrayQueue(propertyName, { op: "sort" }, isRef);
        };
      }
      if (prop === "clear") {
        return async () => {
          return parent.mutateArrayQueue(propertyName, { op: "clear" }, isRef);
        };
      }
      if (prop === "ensureLoaded") {
        return async (options?: { depth?: number }) => {
          if (!isRef) return receiver;
          const current = getItems();
          await Promise.all(
            current.map(async (item) => {
              if (
                item &&
                typeof item.ensureLoaded === "function" &&
                item.isLazyStub
              ) {
                await item.ensureLoaded(options);
              }
            }),
          );
          return receiver;
        };
      }
      if (MUTATING_ARRAY_METHODS.has(prop)) {
        throw new DEMError(
          DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
          `Cannot mutate DEMArray '${propertyName}' synchronously via ${String(prop)}(). Use await array.${String(prop)}(...).`,
        );
      }

      const current = getItems();
      if (prop === "length") {
        return current.length;
      }
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        return current[Number(prop)];
      }
      const val = Reflect.get(current, prop);
      if (typeof val === "function") {
        return val.bind(current);
      }
      return val;
    },
    set(_target, prop) {
      if (prop === "length" || !isNaN(Number(prop))) {
        throw new DEMError(
          DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
          `Cannot assign index directly on DEMArray '${propertyName}'. Use await array.set(index, value) or await array.splice(...).`,
        );
      }
      return false;
    },
    deleteProperty(_target, prop) {
      throw new DEMError(
        DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
        `Cannot delete elements directly from DEMArray '${propertyName}'. Use await array.splice(...) or await array.clear().`,
      );
    },
    has(_target, prop) {
      const current = getItems();
      return Reflect.has(current, prop);
    },
    ownKeys(_target) {
      const current = getItems();
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const current = getItems();
      if (prop === "length") {
        _target.length = current.length;
        return Reflect.getOwnPropertyDescriptor(_target, "length");
      }
      const desc = Reflect.getOwnPropertyDescriptor(current, prop);
      if (desc) {
        return { ...desc, configurable: true };
      }
      return undefined;
    },
  }) as unknown as DEMArray<T>;
}

type SocketType = Socket;

export abstract class AutoUpdatedClientObject<
  T extends IAutoUpdatedClientObjectBase,
  M extends Record<string, IAutoUpdateManager<any>> = Record<
    string,
    IAutoUpdateManager<any>
  >,
> implements IAutoUpdatedClientObject<T> {
  protected entry: unknown;
  public _refArrayCache?: Map<
    string,
    { rawIdsHash: string; proxy: any[]; resolvedChildren?: any[] }
  >;

  protected readonly socket: SocketType;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  public abstract readonly _id: MongoId;
  protected readonly loggers: LoggersType;
  protected isLoading = true;
  public isLazyStub: boolean = false;
  /**
   * Human-readable descriptor string supplied by the server manifest.
   */
  public descriptor?: string;
  public loadError?: string;
  protected isLoadingReferences = true;
  protected checkedMissingProperties?: Record<string, boolean>;
  protected readonly emitter: EventEmitter3;
  public readonly properties: string[];
  public readonly classParam: Constructor<T>;
  public readonly className: string;
  public parentManager: IAutoUpdateManager<T> & {
    cache: DEMCache;
    managers: M;
  };
  private static _emitterCounter = 0;

  /**
   * Generates a human-readable descriptor from direct entity attributes.
   * Base implementation stringifies the available data payload.
   *
   * @param data - Direct entity property data.
   * @returns String descriptor representing the entity.
   */
  public static getDescriptor(data: Partial<any>): string {
    try {
      return JSON.stringify(data ?? {});
    } catch {
      return String(data ?? "");
    }
  }
  protected readonly EmitterID: string = `dem_e_${++AutoUpdatedClientObject._emitterCounter}`;
  protected _preloadTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  protected toChangeOnParents?: { key: string; value: unknown }[];
  public callbacks: DEMClientCallbacks<T>;
  protected _isUpdating: boolean = false;

  private readonly loadReferencesAsync = async (): Promise<void> => {
    try {
      if (!this.isLoaded) {
        await this.waitForPreloaded();
      }
      this.generateSettersAndGetters();
      if (this.isServer) {
        await this.loadForceReferences();
        if (this.toChangeOnParents) {
          for (const thing of this.toChangeOnParents) {
            await this.setValue__(thing.key, thing.value, true, false, false, true);
          }
        }
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

  /**
   * Initializes an AutoUpdatedClientObject instance.
   *
   * @param classParam - Constructor of the client object entity.
   * @param socket - Socket.IO client socket connection.
   * @param data - Entity identifier string or initial data object.
   * @param loggers - Logging interfaces.
   * @param className - Managed entity class name.
   * @param parentManager - Host client manager.
   * @param callback - Event callbacks interface.
   * @param emitter - Shared event emitter.
   * @param isServer - Flag indicating whether running on server runtime.
   * @throws {DEMError} Throws DEMErrorCode.MISSING_ARGUMENT when required parameters are omitted.
   */
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
      else
        throw new DEMError(
          DEMErrorCode.MISSING_ARGUMENT,
          "Missing arguments for AutoUpdatedClientObject: " + className,
        );
    }

    this.classParam = classParam;
    this.socket = socket;
    this.isServer = isServer;
    this.emitter = emitter;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.parentManager = parentManager as any;
    this.className = className;

    if (classParam) {
      const meta = setupClassAccessors(classParam);
      this.properties = meta.properties;
    } else {
      this.properties = [];
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

    if (typeof data === "object" && data !== null && (data as any).__isLazyStub) {
      this.isLazyStub = true;
      this.isLoading = true;
      this.descriptor = (data as any).descriptor;
      this.data = { _id: (data as any)._id } as any;
      this.generateSettersAndGetters();
      return;
    }

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
          this.data = this.handleDataCleanup(res.data as any);
          this.generateSettersAndGetters();
          this.isLoading = false;
          this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
          this.openSockets();
        },
      );
    } else {
      this.isLoading = true;
      this.data = this.handleDataCleanup(data as IsData<T>);

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

  /**
   * Normalizes reference fields in entity data into string IDs.
   *
   * @param data - Entity data payload.
   * @returns Cleaned entity data payload.
   */
  protected handleDataCleanup(data: IsData<T>): IsData<T> {
    this._refArrayCache?.clear();
    if (!data || typeof data !== "object") return data;

    const meta = this.classParam ? setupClassAccessors(this.classParam) : null;
    const refProps = meta ? meta.refProps : null;
    if (!refProps || refProps.size === 0) return data;

    const dataAsRecord = data as unknown as Record<string, unknown>;
    for (const key of refProps) {
      const val = dataAsRecord[key];
      if (!val) continue;
      if (Array.isArray(val)) {
        let needsNormalization = false;
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (item && typeof item === "object") {
            needsNormalization = true;
            break;
          }
        }
        if (needsNormalization) {
          dataAsRecord[key] = (val as unknown[]).map(
            (obj: unknown) =>
              (obj as { _id?: { toString(): string } | string })?._id?.toString() ??
              (obj as { toString(): string })?.toString(),
          );
        }
      } else if (typeof val === "object") {
        dataAsRecord[key] =
          (val as { _id?: { toString(): string } | string })?._id?.toString() ??
          (val as { toString(): string })?.toString();
      }
    }
    return data;
  }

  /**
   * Pauses execution until the object finishes asynchronous preloading.
   *
   * @param timeoutMs - Maximum milliseconds to wait before rejecting.
   * @throws {DEMError} Throws DEMErrorCode.PRELOAD_TIMEOUT on timeout or OBJECT_LOAD_FAILED on failure.
   */
  public async waitForPreloaded(timeoutMs: number = 15000): Promise<void> {
    if (this.loadError)
      throw new DEMError(DEMErrorCode.OBJECT_LOAD_FAILED, this.loadError);
    if (this.isLoaded) return;
    if ((this.parentManager as any)?._isClosed) {
      throw new DEMError(DEMErrorCode.OBJECT_LOAD_FAILED, "Manager is closed");
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._preloadTimers.delete(timer);
        const errorMsg = `Timeout waiting for object preloading (${this.className})`;
        this.loadError = errorMsg;
        this.isLoading = false;
        reject(new DEMError(DEMErrorCode.PRELOAD_TIMEOUT, errorMsg));
      }, timeoutMs);
      this._preloadTimers.add(timer);

      this.emitter.once(
        EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
        (failed: boolean, reason: string) => {
          clearTimeout(timer);
          this._preloadTimers.delete(timer);
          if (failed)
            reject(new DEMError(DEMErrorCode.OBJECT_LOAD_FAILED, reason));
          else resolve();
        },
      );
    });
  }

  /**
   * Emits creation event to the server socket and awaits populated entity response.
   *
   * @param data - Initial data payload.
   */
  protected handleNewObject(data: IsData<T>): void {
    this.isLoading = true;

    if (!this.socket) {
      const errorMsg = `Cannot create ${this.className}: Socket is missing.`;
      this.loadError = errorMsg;
      this.isLoading = false;
      this.loggers.error?.(errorMsg);
      this.emitter.emit(
        EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
        true,
        errorMsg,
      );
      return;
    }

    let payload: IsData<T> = data;
    try {
      if (data && typeof data === "object") {
        payload = JSON.parse(JSON.stringify(data));
      }
    } catch (err: unknown) {
      this.loggers.warn?.(
        `Failed to JSON-serialize creation payload for ${this.className}, falling back to raw data: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    this.socket.emit(
      EVENT_NEW + this.className,
      payload,
      (res: ServerResponse<T>) => {
        if (this.loadError) return;
        if (!res) {
          const errorMsg = `No response received from server when creating ${this.className}`;
          this.isLoading = false;
          this.loadError = errorMsg;
          this.loggers.error?.(errorMsg);
          this.emitter.emit(
            EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
            true,
            errorMsg,
          );
          return;
        }
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

  /**
   * Returns a deep clone of the entity's extracted data with reference objects converted to IDs.
   *
   * @returns Serialized entity representation.
   */
  public get extractedData(): ExtractedData<T, IAutoUpdatedClientObject<any>> {
    const extracted = processIsRefProperties(
      this.data,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData;
    if (this.data?._id && !(extracted as any)._id) {
      (extracted as any)._id = (this.data._id as any)?.toString?.() ?? String(this.data._id);
    }
    return _.cloneDeep(extracted) as unknown as ExtractedData<
      T,
      IAutoUpdatedClientObject<any>
    >;
  }

  /**
   * Indicates whether the entity has finished loading its data.
   *
   * @returns True if loaded.
   */
  public get isLoaded(): boolean {
    return !this.isLoading && !this.isLazyStub && !this.loadError;
  }

  /**
   * Ensures that this entity is fully hydrated from the server.
   * If the entity is a lazy stub, triggers on-demand graph hydration up to the requested depth.
   *
   * @param options - Hydration options containing graph depth.
   * @returns Promise resolving to this hydrated entity instance.
   */
  public async ensureLoaded(options?: { depth?: number }): Promise<this> {
    if (!this.isLazyStub && this.isLoaded) return this;
    if (this.parentManager && typeof (this.parentManager as any).loadObject === "function") {
      return (this.parentManager as any).loadObject(this.data?._id ?? this._id, options);
    }
    return this;
  }

  /**
   * Hydrates an unhydrated stub instance with full entity data received from the server.
   *
   * @param payload - Entity data payload.
   */
  public hydrateFromData(payload: IsData<T>): void {
    this.data = this.handleDataCleanup(payload);
    this.isLoading = false;
    this.isLazyStub = false;
    this.loadError = undefined;
    this.generateSettersAndGetters();
    if (!this.isServer) this.openSockets();
    this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
  }

  /**
   * Asynchronously awaits preloading and loads all missing reference links.
   *
   * @returns Promise resolving to true when completed.
   */
  public async isPreLoadedAsync(): Promise<boolean> {
    await this.loadReferencesAsync();
    this.generateSettersAndGetters();
    return true;
  }

  /**
   * Identifies and connects missing cross-entity references on server startup.
   */
  public async loadMissingReferences(): Promise<void> {
    if (!this.isServer) return;
    this.checkedMissingProperties = {};
    await this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const id = this.data?._id ?? this._id;
    if (!id || !this.socket) return;
    const event = EVENT_UPDATE + this.className + id.toString();
    this.socket.off(event);
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

  private _gettersGenerated = false;
  private writeQueue: Promise<unknown> = Promise.resolve();

  public get updateEventName(): string {
    const id = this.data?._id ?? this._id;
    return EVENT_UPDATE + this.className + (id ? id.toString() : "");
  }

  /**
   * Extracts the raw string identifier or array of string identifiers from a reference property.
   *
   * @param key - Name of property to extract identifier from.
   * @returns Raw string ID, array of raw string IDs, or undefined if missing.
   */
  public getRawId(key: string): string | string[] | undefined {
    if (!this.data) return undefined;
    const val = (this.data as Record<string, unknown>)[key];
    if (!val) return undefined;
    if (Array.isArray(val)) {
      return val
        .map((item) =>
          item && typeof item === "object" && (item as any)._id
            ? (item as any)._id.toString()
            : item
              ? item.toString()
              : undefined,
        )
        .filter(Boolean) as string[];
    }
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null && (val as any)._id) {
      return (val as any)._id.toString();
    }
    return String(val);
  }

  public generateSettersAndGetters(): void {
    if (this.classParam) {
      setupClassAccessors(this.classParam);
    }
    if (this.properties) {
      for (const key of this.properties as string[]) {
        if (typeof key === "string" && Object.hasOwn(this, key)) {
          delete (this as Record<string, unknown>)[key];
        }
      }
    }
  }

  /**
   * Retrieves a property value by dot-notated or shallow key path.
   *
   * @param key_ - Property key or dot-delimited path.
   * @returns Value at requested path or never if property does not exist.
   */
  public getValue<K extends Paths<T, IAutoUpdatedClientObject<any>>>(
    key_: K,
  ): PathValueOf<T, K>;
  public getValue(key_: string): never;
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

  /**
   * Resolves reference pointer ID to instantiated entity instance across caches and managers.
   *
   * @param id - Entity ID or ObjectId.
   * @param key - Property key referencing the entity.
   * @returns Resolved entity instance or undefined.
   */
  public findReference(
    id: string | ObjectId,
    key: string,
  ): IAutoUpdatedClientObject<any> | undefined {
    if (!id) return undefined;
    const idStr = typeof id === "string" ? id : id.toString();
    const cached = globalCache.objects[idStr];
    if (cached?.object) {
      const isSameClient =
        !this.parentManager ||
        !this.parentManager.managers ||
        Object.keys(this.parentManager.managers).length === 0 ||
        cached.object.parentManager === this.parentManager ||
        Object.values(this.parentManager.managers).includes(cached.object.parentManager as any);
      if (isSameClient) {
        return cached.object as IAutoUpdatedClientObject<T>;
      }
    }

    const cacheKey = `${this.className}:${key}`;
    const cachedManager = this.parentManager?.cache?.references?.[cacheKey];
    if (cachedManager) {
      const res = cachedManager.getObject(idStr);
      if (res) return res as IAutoUpdatedClientObject<any>;
    }

    if (this.parentManager?.managers) {
      for (const manager of Object.values(this.parentManager.managers)) {
        const result = manager.getObject(idStr);
        if (result) {
          if (this.parentManager.cache?.references) {
            this.parentManager.cache.references[cacheKey] = manager;
          }
          return result as IAutoUpdatedClientObject<any>;
        }
      }
    }
    return undefined;
  }

  /**
   * Mutates property value and synchronizes change to the server via socket.
   *
   * @param key - Property key to modify.
   * @param val - Value to assign.
   * @returns Promise resolving to modification result.
   */
  public async setValue<K extends string>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }> {
    return await this.setValue__(key as string, val);
  }

  /**
   * Internal setter with writeQueue serialization ensuring sequential updates.
   *
   * @param key - Property key.
   * @param val - Value to assign.
   * @param silent - Whether socket broadcast is bypassed.
   * @param noGet - Whether local update bypasses get.
   * @param noUpdate - Whether onUpdate hook is bypassed.
   * @param isParentUpdate - Whether mutation originated from parent.
   * @returns Promise resolving to operation outcome.
   */
  protected async setValue__(
    key: string,
    val: unknown,
    silent = false,
    noGet = false,
    noUpdate = false,
    isParentUpdate = false,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }> {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() =>
        this.setValueQueueInternal(
          key,
          val,
          silent,
          noGet,
          noUpdate,
          isParentUpdate,
        ),
      );
    return this.writeQueue as Promise<{
      success: boolean;
      msg: string;
      code?: DEMErrorCode;
    }>;
  }

  private async setValueQueueInternal(
    key: string,
    val: unknown,
    silent = false,
    noGet = false,
    noUpdate = false,
    isParentUpdate = false,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }> {
    const rootProp = (key as string).split(".")[0];
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      (this.properties && !this.properties.includes(rootProp) && rootProp !== "_id")
    ) {
      return {
        success: false,
        code: DEMErrorCode.INVALID_ARGUMENT,
        msg: `Invalid property key: ${key}`,
      };
    }
    try {
      const isRef = getMetadataRecursive("isRef", this, key);
      const pointer = getMetadataRecursive("refsTo", this, key);
      if (pointer && !isParentUpdate && !silent && !this.isServer) {
        throw new DEMError(
          DEMErrorCode.CANNOT_SET_REF_DIRECTLY,
          "Cannot set value of a reference pointer directly.",
        );
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
              throw new DEMError(
                DEMErrorCode.REFERENCE_RESOLUTION_FAILED,
                "Could not resolve reference on path: " + key,
              );
            return await ref.setValue(
              path.slice(i + 1).join(".") as any,
              val as any,
            );
          }
          obj = obj[currentKey] as Record<string, unknown>;
        }
      }

      const prevRawVal = (this.data as Record<string, unknown>)?.[key];
      const res = await this.setValueInternal(
        key,
        valueToStore,
        silent,
        noUpdate,
      );
      if (res.success) {
        if (valueToStore === undefined) {
          if ((key as string).includes(".")) {
            _.unset(this.data as any, key as string);
          } else {
            delete (this.data as any)[key as string];
          }
        } else {
          const pathArr = (key as string).split(".");
          let obj = this.data as Record<string, unknown>;
          for (let i = 0; i < pathArr.length - 1; i++) {
            const seg = pathArr[i];
            if (!obj[seg] || typeof obj[seg] !== "object") {
              obj[seg] = {};
            }
            obj = obj[seg] as Record<string, unknown>;
          }
          obj[pathArr[pathArr.length - 1]] = valueToStore;
        }
        this._refArrayCache?.delete(rootProp);
        if (this.isServer) {
          await this.findAndLoadReferences(key, valueToStore);
          if (isRef && this.parentManager.isLoaded) await this.contactChildren();
        } else if (isRef) {
          const parentId = (this.data?._id ?? this._id)?.toString();
          if (Array.isArray(valueToStore)) {
            const nextIds = (valueToStore as unknown[]).map((v) =>
              v && typeof v === "object" && "_id" in v
                ? String((v as any)._id)
                : String(v),
            );
            const prevIds = Array.isArray(prevRawVal)
              ? (prevRawVal as unknown[]).map((v) =>
                  v && typeof v === "object" && "_id" in v
                    ? String((v as any)._id)
                    : String(v),
                )
              : [];
            const addedIds = nextIds.filter((id) => !prevIds.includes(id));
            const removedIds = prevIds.filter((id) => !nextIds.includes(id));

            for (const id of nextIds) {
              const child = this.findReference(id, key);
              if (child && typeof child === "object") {
                const props = (child as any).properties || [];
                for (const cp of props) {
                  const refsTo =
                    Reflect.getMetadata("refsTo", child, cp) ||
                    Reflect.getMetadata("refsTo", Object.getPrototypeOf(child), cp);
                  if (
                    refsTo === this.className ||
                    refsTo?.startsWith?.(this.className + ":")
                  ) {
                    (child as any)[cp] = parentId;
                    if ((child as any).data) {
                      (child as any).data[cp] = parentId;
                    }
                  }
                }
              }
            }

            for (const id of removedIds) {
              if (nextIds.includes(id)) continue;
              const child = this.findReference(id, key);
              if (child && typeof child === "object") {
                const props = (child as any).properties || [];
                for (const cp of props) {
                  const refsTo =
                    Reflect.getMetadata("refsTo", child, cp) ||
                    Reflect.getMetadata("refsTo", Object.getPrototypeOf(child), cp);
                  if (
                    refsTo === this.className ||
                    refsTo?.startsWith?.(this.className + ":")
                  ) {
                    const childParentVal = (child as any)[cp];
                    const childParentId =
                      childParentVal && typeof childParentVal === "object" && "_id" in childParentVal
                        ? String((childParentVal as any)._id)
                        : String(childParentVal);
                    if (
                      childParentId === parentId ||
                      childParentVal === parentId ||
                      childParentVal === this
                    ) {
                      (child as any)[cp] = undefined;
                    }
                    if (
                      (child as any).data?.[cp] === parentId ||
                      (child as any).data?.[cp]?.toString?.() === parentId
                    ) {
                      delete (child as any).data[cp];
                    }
                  }
                }
              }
            }
          }
        }
        if (this.isLoaded) {
          this.callbacks.update(
            this as unknown as IAutoUpdatedClientObject<T>,
            key,
          );
          await this.onUpdate(noUpdate, key);
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
      const demErr =
        error instanceof DEMError
          ? error
          : toDEMError(error, DEMErrorCode.DB_SAVE_FAILED);
      return {
        success: false,
        code: demErr.code,
        msg: demErr.message,
      };
    }
  }

  protected async setValueInternal(
    key: string,
    value: unknown,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }> {
    if (silent) return { success: true, msg: "Silent" };
    const id = this.data?._id ?? this._id;
    if (!id) {
      throw new DEMError(
        DEMErrorCode.MISSING_ID,
        `Cannot update object ${this.className} because _id is missing.`,
      );
    }
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_UPDATE + this.className + id,
        { _id: id.toString(), key, value },
        (res: ServerResponse<undefined>) => {
          resolve({
            success: res?.success ?? false,
            code: (res as any)?.code,
            msg: res?.message ?? (res?.success ? "Success" : "Error"),
          });
        },
      );
    });
  }

  /**
   * Enqueues an array mutation in the entity write queue to ensure sequential execution.
   *
   * @param key - Target array property key.
   * @param req - Array mutation request payload.
   * @param isRef - Whether the target property is a relational reference array.
   * @returns Promise resolving to the mutation result.
   */
  public async mutateArrayQueue(
    key: string,
    req: DEMArrayMutationParams,
    isRef: boolean,
  ): Promise<any> {
    if (this._isUpdating) {
      return this.mutateArrayInternal(key, req, isRef);
    }
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => this.mutateArrayInternal(key, req, isRef));
    return this.writeQueue;
  }

  /**
   * Internal execution handler for array mutations following pessimistic convergence semantics.
   * Transmits mutation request to server, awaits acknowledgment, and updates local state.
   *
   * @param key - Target array property key.
   * @param req - Array mutation parameters payload.
   * @param isRef - Whether the target property holds relational entities.
   * @returns Promise resolving to the operator return value or updated array.
   * @throws {DEMError} Throws when server rejects mutation or write fails.
   */
  private async mutateArrayInternal(
    key: string,
    req: DEMArrayMutationParams,
    isRef: boolean,
  ): Promise<any> {
    const rawVal = (this.data as Record<string, unknown>)?.[key];
    const currentRawArray = Array.isArray(rawVal) ? [...rawVal] : [];

    // Capture items prior to mutation for pop/shift/splice return values
    let removedEntities: any[] = [];
    if (isRef) {
      if (req.op === "pop" && currentRawArray.length > 0) {
        const lastId = currentRawArray[currentRawArray.length - 1];
        removedEntities = [this.findReference(lastId, key) || lastId];
      } else if (req.op === "shift" && currentRawArray.length > 0) {
        const firstId = currentRawArray[0];
        removedEntities = [this.findReference(firstId, key) || firstId];
      } else if (req.op === "splice" && req.index !== undefined) {
        const count = req.deleteCount ?? currentRawArray.length - req.index;
        for (
          let i = req.index;
          i < req.index + count && i < currentRawArray.length;
          i++
        ) {
          const id = currentRawArray[i];
          removedEntities.push(this.findReference(id, key) || id);
        }
      } else if (req.op === "clear") {
        for (const id of currentRawArray) {
          removedEntities.push(this.findReference(id, key) || id);
        }
      }
    } else {
      if (req.op === "pop" && currentRawArray.length > 0) {
        removedEntities = [currentRawArray[currentRawArray.length - 1]];
      } else if (req.op === "shift" && currentRawArray.length > 0) {
        removedEntities = [currentRawArray[0]];
      } else if (req.op === "splice" && req.index !== undefined) {
        const count = req.deleteCount ?? currentRawArray.length - req.index;
        removedEntities = currentRawArray.slice(req.index, req.index + count);
      } else if (req.op === "clear") {
        removedEntities = [...currentRawArray];
      }
    }

    // Compute baseHash
    const baseHash = isRef
      ? currentRawArray
          .map((item) =>
            item && typeof item === "object" && "_id" in item
              ? String((item as any)._id)
              : String(item),
          )
          .join(",")
      : JSON.stringify(currentRawArray);

    // Extract raw string IDs for relational items
    let rawItemsToPersist: unknown[] = req.items || [];
    const resolvedEntities: any[] = [];
    if (isRef && req.items) {
      rawItemsToPersist = req.items.map((item: any) => {
        const isEntityInstance =
          item instanceof AutoUpdatedClientObject ||
          (item &&
            typeof item === "object" &&
            "className" in item &&
            "data" in item);
        if (isEntityInstance) {
          resolvedEntities.push(item);
          return String((item as any)._id);
        }
        const resolved = this.findReference(item, key);
        if (resolved) {
          resolvedEntities.push(resolved);
        }
        return String(item && item.toString ? item.toString() : item);
      });
    }

    const payload: DEMArrayMutationRequest = {
      ...req,
      key,
      items: rawItemsToPersist,
      baseHash,
      clientTimestamp:
        typeof (this.parentManager as any)?.getSynchronizedTime === "function"
          ? (this.parentManager as any).getSynchronizedTime()
          : Date.now(),
    };

    let res: DEMArrayMutationResponse;
    if (this.isServer) {
      res = await (this as any).executeServerArrayMutation(key, payload, isRef);
    } else {
      const id = this.data?._id ?? this._id;
      if (!id) {
        throw new DEMError(
          DEMErrorCode.MISSING_ID,
          `Cannot mutate array on ${this.className} because _id is missing.`,
        );
      }
      res = await new Promise((resolve) => {
        this.socket.emit(
          EVENT_UPDATE + this.className + id,
          { _id: id.toString(), key, mutation: payload },
          (response: DEMArrayMutationResponse) => {
            resolve(response);
          },
        );
      });
    }

    if (!res || !res.success) {
      throw new DEMError(
        res?.code ?? DEMErrorCode.ARRAY_MUTATION_FAILED,
        res?.message || `Array mutation '${req.op}' on '${key}' failed on server.`,
      );
    }

    const updatedArray = res.updatedArray ?? [];
    (this.data as Record<string, unknown>)[key] = updatedArray;
    this._refArrayCache?.delete(key);
    if (Object.hasOwn(this, key)) {
      delete (this as Record<string, unknown>)[key];
    }

    // Synchronize child back-references
    if (isRef) {
      const parentId = (this.data?._id ?? this._id)?.toString();
      const currentIds = (updatedArray as unknown[]).map((v) =>
        v && typeof v === "object" && "_id" in v
          ? String((v as any)._id)
          : String(v),
      );
      for (const id of currentIds) {
        const child = this.findReference(id, key);
        if (child && typeof child === "object") {
          const props = (child as any).properties || [];
          for (const cp of props) {
            const refsTo =
              Reflect.getMetadata("refsTo", child, cp) ||
              Reflect.getMetadata("refsTo", Object.getPrototypeOf(child), cp);
            if (
              refsTo === this.className ||
              refsTo?.startsWith?.(this.className + ":")
            ) {
              (child as any)[cp] = parentId;
              if ((child as any).data) {
                (child as any).data[cp] = parentId;
              }
            }
          }
        }
      }
      for (const entity of resolvedEntities) {
        if (entity && typeof entity === "object") {
          const props = (entity as any).properties || [];
          for (const cp of props) {
            const refsTo =
              Reflect.getMetadata("refsTo", entity, cp) ||
              Reflect.getMetadata("refsTo", Object.getPrototypeOf(entity), cp);
            if (
              refsTo === this.className ||
              refsTo?.startsWith?.(this.className + ":")
            ) {
              (entity as any)[cp] = parentId;
              if ((entity as any).data) {
                (entity as any).data[cp] = parentId;
              }
            }
          }
        }
      }
      if (
        req.op === "pop" ||
        req.op === "shift" ||
        req.op === "splice" ||
        req.op === "clear"
      ) {
        for (const entity of removedEntities) {
          if (entity && typeof entity === "object") {
            const entId =
              (entity as any)._id?.toString() ??
              (entity as any).data?._id?.toString();
            if (entId && currentIds.includes(entId)) continue;
            const props = (entity as any).properties || [];
            for (const cp of props) {
              const refsTo =
                Reflect.getMetadata("refsTo", entity, cp) ||
                Reflect.getMetadata("refsTo", Object.getPrototypeOf(entity), cp);
              if (
                refsTo === this.className ||
                refsTo?.startsWith?.(this.className + ":")
              ) {
                const childParentVal = (entity as any)[cp];
                const childParentId =
                  childParentVal &&
                  typeof childParentVal === "object" &&
                  "_id" in childParentVal
                    ? String((childParentVal as any)._id)
                    : String(childParentVal);
                if (
                  childParentId === parentId ||
                  childParentVal === parentId ||
                  childParentVal === this
                ) {
                  (entity as any)[cp] = undefined;
                }
                if (
                  (entity as any).data?.[cp] === parentId ||
                  (entity as any).data?.[cp]?.toString?.() === parentId
                ) {
                  delete (entity as any).data[cp];
                }
              }
            }
          }
        }
      }
    }

    if (this.isLoaded) {
      this.callbacks.update(this as unknown as IAutoUpdatedClientObject<T>, key);
      await this.onUpdate(false, key);
    }

    switch (req.op) {
      case "push":
      case "unshift":
        return updatedArray.length;
      case "pop":
      case "shift":
        return removedEntities[0];
      case "splice":
        return removedEntities;
      case "set":
        return req.items?.[0];
      case "reverse":
      case "sort":
        return (this as any)[key];
      case "clear":
        return undefined;
      default:
        return updatedArray;
    }
  }

  protected makeUpdate(key: string, value: unknown): ServerUpdateRequest<T> {
    const id = this.data?._id ?? this._id;
    if (!id) {
      this.loggers.error?.(
        `Probably missing the identifier ['_id'] again: ${key} = ${value}`,
      );
      throw new DEMError(
        DEMErrorCode.MISSING_ID,
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
    this._refArrayCache?.clear();
    for (const timer of this._preloadTimers) {
      clearTimeout(timer);
    }
    this._preloadTimers.clear();
    this.emitter.emit(
      EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
      true,
      "Object destroyed",
    );
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
    alreadySeen: Set<unknown> = new Set(),
  ) {
    const meta = this.classParam ? setupClassAccessors(this.classParam) : null;
    const props =
      obj === this.data && this.properties
        ? this.properties
        : (Reflect.getMetadata("props", proto) as string[]) ||
          (Reflect.getMetadata("props", Object.getPrototypeOf(proto)) as string[]) ||
          [];
    for (const key of props) {
      if (typeof key !== "string") continue;
      const pointer =
        meta?.refsToMap.get(key) ||
        (Reflect.getMetadata("refsTo", proto, key) as string) ||
        (proto ? (Reflect.getMetadata("refsTo", Object.getPrototypeOf(proto), key) as string) : undefined);
      if (
        pointer &&
        obj === (this.data) &&
        obj[key] &&
        !alreadySeen.has(obj)
      ) {
        await this.createdWithParent(
          pointer.split(":"),
          obj[key] as Record<string, unknown>,
        );
      }

      if (obj[key] && !alreadySeen.has(obj[key]))
        alreadySeen.add(obj[key]);

      const val = obj[key];
      if (
        val &&
        typeof val === "object" &&
        !(val instanceof Date) &&
        !(val instanceof ObjectId)
      ) {
        const nestedProto = Object.getPrototypeOf(val);
        if (nestedProto && !alreadySeen.has(val)) {
          alreadySeen.add(val);
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

    const manager = this.parentManager.managers[pointer[0]];
    if (!manager) {
      this.loggers.warn?.(`createdWithParent: Manager not found for ${pointer[0]}.`);
      return;
    }

    const obj = manager.getObject(parentId) as
      | IAutoUpdatedClientObject<any>
      | undefined;
    if (!obj) {
      this.loggers.warn?.(`createdWithParent: Parent object not found for ID ${parentId} in manager ${pointer[0]}`);
      return;
    }

    const myId = (this.data._id as any)?.toString?.() ?? String(this.data._id);
    const rawData = (obj as any).data as Record<string, unknown> | undefined;
    const rawVal = rawData ? rawData[pointer[1]] : undefined;

    if (Array.isArray(rawVal)) {
      let alreadyIncluded = false;
      for (let i = 0; i < rawVal.length; i++) {
        const item = rawVal[i];
        const idStr = (item as any)?._id?.toString?.() ?? item?.toString?.();
        if (idStr === myId) {
          alreadyIncluded = true;
          break;
        }
      }
      if (!alreadyIncluded) {
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
        ).setValue__(pointer[1], [...rawVal, myId], false, false, false, true);
      }
    } else {
      const currentIdStr = (rawVal as any)?._id?.toString?.() ?? rawVal?.toString?.();
      if (currentIdStr !== myId) {
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
        ).setValue__(pointer[1], myId, false, false, false, true);
      }
    }
  }

  /**
   * Destroys the entity and notifies server socket of deletion.
   *
   * @param once - Internal flag preventing infinite recursion.
   * @param isRemote - Whether the deletion originates from a remote server broadcast or delta sync.
   * @returns Promise resolving to deletion outcome.
   */
  public async destroy(
    once = false,
    isRemote = false,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    if (!once) {
      return isRemote
        ? await (this.parentManager as any).deleteObject(this.data._id.toString(), true)
        : await this.parentManager.deleteObject(this.data._id.toString());
    }
    if (isRemote) {
      await this.wipeSelf();
      return { success: true, message: "Cleaned locally" };
    }
    return new Promise((resolve) => {
      this.socket.emit(
        EVENT_DELETE + this.className,
        this.data._id,
        (res: ServerResponse<undefined>) => {
          resolve({
            success: res?.success ?? false,
            code: (res as any)?.code,
            message: res?.message ?? "",
          });
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
      if (pointer && !(this.data as Record<string, unknown>)?.[prop]) {
        const parts = pointer.split(":");
        if (parts.length === 2)
          await this.findMissingObjectReference(prop, parts);
      }
    }
  }

  private async findMissingObjectReference(prop: string, pointer: string[]) {
    this.checkedMissingProperties ??= {};
    if (this.checkedMissingProperties[prop]) return;
    this.checkedMissingProperties[prop] = true;
    const ac = (
      this.parentManager.managers as Record<
        string,
        IAutoUpdateManager<IAutoUpdatedClientObject<any>>
      >
    )[pointer[0]];
    if (!ac) return;
    const targetId = (this.data._id as any)?.toString?.() ?? String(this.data._id);
    const allObjects = ac.objectsAsArray;
    for (let i = 0; i < allObjects.length; i++) {
      const obj = allObjects[i];
      const rawData = (obj as any).data as Record<string, unknown> | undefined;
      if (!rawData) continue;
      const val = rawData[pointer[1]];
      if (!val) continue;
      if (Array.isArray(val)) {
        for (let j = 0; j < val.length; j++) {
          const id = (val[j] as any)?._id?.toString?.() ?? val[j]?.toString?.();
          if (id === targetId) {
            (this.data as Record<string, unknown>)[prop] = obj._id;
            return;
          }
        }
      } else {
        const id = (val as any)?._id?.toString?.() ?? val?.toString?.();
        if (id === targetId) {
          (this.data as Record<string, unknown>)[prop] = obj._id;
          return;
        }
      }
    }
  }

  /**
   * Triggers missing reference resolution on all child referenced entities.
   */
  public async contactChildren(): Promise<void> {
    if (!this.isServer) return;
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

  protected async onUpdate(noUpdate: boolean = false, key?: string): Promise<void> {
    // Placeholder for server-side override
  }

  protected async onDeletion(): Promise<void> {
    // Placeholder for server-side override
  }
}

/**
 * Traverses entity object and transforms referenced objects into string identifiers.
 *
 * @param instance - Raw entity data record.
 * @param target - Reflection prototype target.
 * @param prefix - Dot-notated property key prefix.
 * @param allProps - Accumulated array of discovered property paths.
 * @param newData - Output object receiving sanitized data.
 * @param loggers - Logging interfaces.
 * @returns Object containing all property paths and transformed newData.
 */
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

/**
 * Compiles V8 fast-shape property getters and setters on the class prototype.
 *
 * @param classParam - Constructor function of the target entity class.
 * @returns Cached metadata object with properties list, refProps set, and refsToMap.
 */
export function setupClassAccessors(classParam: Constructor<any>): {
  properties: string[];
  refProps: Set<string>;
  refsToMap: Map<string, string>;
} {
  if (!classParam) {
    return { properties: [], refProps: new Set(), refsToMap: new Map() };
  }
  if ((classParam as any).__metaCache) {
    return (classParam as any).__metaCache;
  }

  const allProps = new Set<string>();
  const refProps = new Set<string>();
  const refsToMap = new Map<string, string>();

  let proto_ = classParam.prototype;
  while (proto_ && proto_ !== Object.prototype) {
    const props =
      Reflect.getMetadata("props", proto_) ||
      Reflect.getOwnMetadata("props", proto_) ||
      [];
    for (const p of props) {
      if (typeof p === "string") {
        allProps.add(p);
        const isRef = Reflect.getMetadata("isRef", proto_, p) || Reflect.getOwnMetadata("isRef", proto_, p);
        if (isRef) refProps.add(p);
        const refsTo = Reflect.getMetadata("refsTo", proto_, p) || Reflect.getOwnMetadata("refsTo", proto_, p);
        if (refsTo) refsToMap.set(p, refsTo);
      }
    }
    proto_ = Object.getPrototypeOf(proto_);
  }

  const properties = Array.from(allProps);

  for (const key of properties) {
    const isRef = refProps.has(key);
    Object.defineProperty(classParam.prototype, key, {
      get(this: AutoUpdatedClientObject<any>) {
        if (!this.data) return undefined;
        let val = (this.data as Record<string, unknown>)[key];
        if (val === null) val = undefined;
        if (isRef && val) {
          if (Array.isArray(val)) {
            const idsHash = val
              .map((item) =>
                item && typeof item === "object" && "_id" in item
                  ? String((item as any)._id)
                  : String(item),
              )
              .join(",");

            if (!this._refArrayCache) {
              this._refArrayCache = new Map();
            }

            const cached = this._refArrayCache.get(key);
            if (cached && cached.rawIdsHash === idsHash) {
              const childrenToCheck = cached.resolvedChildren || cached.proxy;
              const hasStaleChild = childrenToCheck.some((child: any) => {
                if (!child) return true;
                if (child.data?.Wiped) return true;
                const childId = child._id
                  ? child._id.toString()
                  : child.data?._id?.toString();
                if (childId && !globalCache.objects[childId]) return true;
                return false;
              });

              if (!hasStaleChild) {
                return cached.proxy;
              }
              this._refArrayCache.delete(key);
            }

            const getResolvedItems = () => {
              const rawList = (this.data as Record<string, unknown>)?.[key];
              if (!Array.isArray(rawList)) return [];
              const rawResult: IAutoUpdatedClientObject<any>[] = [];
              for (let i = 0; i < rawList.length; i++) {
                const item = rawList[i];
                if (item) {
                  const ref = this.findReference(item, key);
                  if (
                    ref &&
                    !(ref as any).data?.Wiped &&
                    (!ref._id || globalCache.objects[ref._id.toString()])
                  ) {
                    rawResult.push(ref);
                  }
                }
              }
              return rawResult;
            };

            const resolvedChildren = getResolvedItems();
            const proxy = createDEMArray(this, key, true, getResolvedItems);
            this._refArrayCache.set(key, {
              rawIdsHash: idsHash,
              proxy: proxy as any,
              resolvedChildren,
            });
            return proxy;
          } else {
            return this.findReference(val as string | ObjectId, key);
          }
        }
        if (Array.isArray(val)) {
          const idsHash = JSON.stringify(val);
          if (!this._refArrayCache) {
            this._refArrayCache = new Map();
          }
          const cached = this._refArrayCache.get(key);
          if (cached && cached.rawIdsHash === idsHash) {
            return cached.proxy;
          }
          const getPrimitiveItems = () => {
            const raw = (this.data as Record<string, unknown>)?.[key];
            return Array.isArray(raw) ? raw : [];
          };
          const proxy = createDEMArray(this, key, false, getPrimitiveItems);
          this._refArrayCache.set(key, { rawIdsHash: idsHash, proxy: proxy as any });
          return proxy;
        }
        return val;
      },
      set(this: AutoUpdatedClientObject<any>, v: unknown) {
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
          this._refArrayCache?.delete(key);
        }
      },
      enumerable: true,
      configurable: true,
    });
  }

  const meta = { properties, refProps, refsToMap };
  (classParam as any).__metaCache = meta;
  (classParam as any).__propsCache = properties;
  (classParam as any).__refPropsCache = Array.from(refProps);
  return meta;
}

/**
 * Traverses prototype chain recursively to resolve metadata key.
 *
 * @param metaKey - Reflection metadata key.
 * @param proto - Prototype object.
 * @param prop - Property name on prototype.
 * @returns Metadata value or undefined.
 */
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
