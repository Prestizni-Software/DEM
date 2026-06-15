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

  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: unknown,
    loggers: LoggersType,
    managers: M,
    emitter: EventEmitter3,
  ) {
    this.className = className;
    this.managers = managers;
    this.emitter = emitter;
    this.socket = socket;
    this.classParam = classParam;
    this.properties = Reflect.getMetadata("props", classParam.prototype) || [];

    this.loggers.debug = (s: string) =>
      loggers.debug?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.info = (s: string) =>
      loggers.info?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.error = (s: string) =>
      loggers.error?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.warn = (s: string) =>
      loggers.warn?.("[DEM - " + className + " MANAGER] " + s);
  }

  public get isLoaded() {
    return this.isLoaded_;
  }

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

  public async loadReferences(): Promise<void> {
    await Promise.all(this.objectsAsArray.map((obj) => obj.loadMissingReferences()));
    this.isLoaded_ = true;
  }

  public async deleteObject(
    _id: MongoId,
  ): Promise<{ success: boolean; message: string }> {
    const _idStr = _id.toString();
    const o = this.objects_[_idStr];
    const res = await o?.destroy(true);
    if (res?.success) {
      delete this.objects_[_idStr];
      delete globalCache.objects[_idStr];
    }
    o?.callbacks?.delete?.(this);
    return res ?? { success: true, message: "Already gone" };
  }

  public get objectIDs(): string[] {
    return Object.keys(this.objects_);
  }

  public abstract handleGetMissingObject(_id: MongoId): Promise<T>;

  public abstract createObject(data: Omit<IsData<T>, "_id">): Promise<T>;

  public abstract getObject(_id?: MongoId): T | null | undefined;

  public abstract get objects(): { [_id: string]: T };

  public abstract get objectsAsArray(): T[];
}
