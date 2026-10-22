import {
  IAutoUpdatedClientObjectBase,
  MongoId,
  IsData,
  IAutoUpdateManager,
  Constructor,
  EventEmitter3,
  LoggersType,
  DEMCache,
  globalCache,
  DEMError,
  DEMErrorCode,
} from "./CommonTypes.js";
import "reflect-metadata";

export abstract class AutoUpdateManager<
  T extends IAutoUpdatedClientObjectBase,
  M extends Record<string, IAutoUpdateManager<any>> = Record<
    string,
    IAutoUpdateManager<any>
  >,
> implements IAutoUpdateManager<T> {
  protected abstract objects_: { [_id: string]: T };
  protected isLoaded_ = false;
  public readonly socket: unknown;
  protected classParam: Constructor<T>;
  protected properties: string[];
  public readonly className: string;
  public readonly cache: DEMCache = {
    references: {},
  };
  public readonly managers: M;
  protected preloaded = false;
  protected waitingToResolveReferences: { [_id: string]: string } = {};
  protected loggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  };
  protected emitter: EventEmitter3;

  /**
   * Initializes the base AutoUpdateManager instance.
   * Extracts registered property metadata from the class prototype.
   *
   * @param classParam - The constructor function of the managed object class.
   * @param className - The name identifier of the managed class.
   * @param socket - The socket instance (client Socket.IO or server Server).
   * @param loggers - Logging interfaces for info, debug, warn, and error levels.
   * @param managers - Registry of sibling managers.
   * @param emitter - Event emitter for manager and lifecycle events.
   * @throws {DEMError} Throws DEMErrorCode.MISSING_ARGUMENT when classParam is omitted.
   */
  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: unknown,
    loggers: LoggersType,
    managers: M,
    emitter: EventEmitter3,
  ) {
    if (!classParam)
      throw new DEMError(
        DEMErrorCode.MISSING_ARGUMENT,
        "Missing required argument: classParam",
      );
    this.className = className;
    this.managers = managers;
    this.emitter = emitter;
    this.socket = socket;
    this.classParam = classParam;

    const allProps = new Set<string>();
    let proto_ = classParam.prototype;
    while (proto_ && proto_ !== Object.prototype) {
      const props =
        Reflect.getOwnMetadata("props", proto_) ||
        Reflect.getMetadata("props", proto_) ||
        [];
      for (const p of props) allProps.add(p);
      proto_ = Object.getPrototypeOf(proto_);
    }
    this.properties = Array.from(allProps);

    this.loggers.debug = (s: string) =>
      loggers.debug?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.info = (s: string) =>
      loggers.info?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.error = (s: string) =>
      loggers.error?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.warn = (s: string) =>
      loggers.warn?.("[DEM - " + className + " MANAGER] " + s);
  }

  /**
   * Indicates whether the manager has completed its initialization and reference loading.
   *
   * @returns True when the manager is fully loaded.
   */
  public get isLoaded() {
    return this.isLoaded_;
  }

  /**
   * Closes the manager, purges cached objects, and disconnects the underlying socket.
   */
  public close() {
    for (const id of this.objectIDs) {
      delete this.objects_[id];
      delete globalCache.objects[id];
    }
    (
      this.socket as {
        disconnect?: () => void;
        disconnectSockets?: (b: boolean) => void;
      }
    ).disconnect?.() ??
      (
        this.socket as {
          disconnect?: () => void;
          disconnectSockets?: (b: boolean) => void;
        }
      ).disconnectSockets?.(true);
    this.loggers.info("Goodbye, see you next time!");
  }

  /**
   * Asynchronously loads unresolved references across all managed objects.
   * Marks the manager as loaded upon completion.
   *
   * @returns A promise that resolves when all references are loaded.
   */
  public async loadReferences(): Promise<void> {
    await Promise.all(this.objectsAsArray.map((obj) => obj.loadMissingReferences()));
    this.isLoaded_ = true;
  }

  /**
   * Deletes an object by its identifier, destroys the instance, and clears global caches.
   *
   * @param _id - The unique identifier of the object to delete.
   * @param isRemote - Whether the deletion originates from a remote source.
   * @returns A promise resolving to the deletion result object.
   */
  public async deleteObject(
    _id: MongoId,
    isRemote: boolean = false,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    const _idStr = _id.toString();
    const o = this.objects_[_idStr];
    let res: { success: boolean; message: string } | undefined;
    if (o && typeof o.destroy === "function") {
      res = await (o as any).destroy(true, isRemote);
    }
    if (res?.success || !o || typeof o?.destroy !== "function") {
      delete this.objects_[_idStr];
      delete globalCache.objects[_idStr];
    }
    if (o) {
      o.callbacks?.delete?.(o);
    }
    return res ?? { success: true, message: "Already gone" };
  }

  /**
   * Retrieves an array of all managed object string identifiers.
   *
   * @returns Array of object ID strings.
   */
  public get objectIDs(): string[] {
    return Object.keys(this.objects_);
  }

  /**
   * Fetches an object missing from local memory.
   *
   * @param _id - Identifier of the missing object.
   * @returns A promise resolving to the retrieved object instance.
   */
  public abstract handleGetMissingObject(_id: MongoId): Promise<T>;

  /**
   * Creates a new object instance.
   *
   * @param data - Object initial data properties without the `_id` field.
   * @returns A promise resolving to the created object instance.
   */
  public abstract createObject(data: Omit<IsData<T>, "_id">): Promise<T>;

  /**
   * Retrieves a managed object from local state by ID.
   *
   * @param _id - Optional identifier of the object.
   * @returns The object instance, null, or undefined.
   */
  public abstract getObject(_id?: MongoId): T | null | undefined;

  /**
   * Retrieves the dictionary of all managed objects keyed by their identifier.
   *
   * @returns Map of objects keyed by string ID.
   */
  public abstract get objects(): { [_id: string]: T };

  /**
   * Retrieves all managed objects as an array.
   *
   * @returns Array containing all managed object instances.
   */
  public abstract get objectsAsArray(): T[];
}
