import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  EventEmitter3,
  LoggersType,
  Cache,
  globalCache,
  IsData,
  MongoId,
  IDEMSocket,
} from "./CommonTypes.js";
import "reflect-metadata";

export abstract class AutoUpdateManager<
  T extends AutoUpdatedClientObject<T, any>,
  M = any,
> {
  protected abstract objects_: Record<string, T>;
  protected isLoaded_ = false;
  public readonly socket: IDEMSocket;
  protected classParam: Constructor<T>;
  protected properties: string[] = [];
  public readonly className: string;
  public readonly cache: Cache<T> = {
    references: {},
  };
  public readonly managers: M;
  protected preloaded = false;
  protected waitingToResolveReferences: Record<string, string> = {};
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
    socket: IDEMSocket,
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
    
    // Assign loggers with prefix
    this.loggers.debug = (s: string) =>
      loggers?.debug?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.info = (s: string) =>
      loggers?.info?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.error = (s: string) =>
      loggers?.error?.("[DEM - " + className + " MANAGER] " + s);
    this.loggers.warn = (s: string) =>
      loggers?.warn?.("[DEM - " + className + " MANAGER] " + s);

    this.loggers.info("Created manager");
  }

  public get isLoaded() {
    return this.isLoaded_;
  }

  public close() {
    for (const id of this.objectIDs) {
      delete this.objects_[id];
      delete globalCache.objects[id];
    }
    this.socket.disconnect?.() ?? (this.socket as any).disconnectSockets?.(true);
    this.loggers.info("Goodbye, see you next time!");
  }

  public async loadReferences(): Promise<void> {
    await Promise.all(
      this.objectsAsArray.map((obj) => obj.loadMissingReferences()),
    );
    this.isLoaded_ = true;
  }

  public async deleteObject(
    _id: MongoId,
  ): Promise<{ success: boolean; message: string }> {
    const idStr = _id.toString();
    const o = this.objects_[idStr];
    if (!o) return { success: true, message: "Already gone" };
    
    const res = await o.destroy(true);
    if (res?.success) {
      delete this.objects_[idStr];
      delete globalCache.objects[idStr];
      const callbacks = (o as any).callbacks;
      if (callbacks && typeof callbacks.delete === 'function') {
          await callbacks.delete(o);
      }
    }
    return res ?? { success: true, message: "Already gone" };
  }

  public get objectIDs(): string[] {
    return Object.keys(this.objects_);
  }

  public abstract handleGetMissingObject(_id: string): Promise<T>;

  public abstract createObject(data: Omit<IsData<T>, "_id">): Promise<T>;

  /**
   * Returns the object with the given ID.
   * If _id is undefined, returns null.
   * If _id is provided but object is not found, returns undefined.
   */
  public abstract getObject(_id?: string): T | null | undefined;

  public abstract get objects(): Record<string, T>;

  public abstract get objectsAsArray(): T[];
}
