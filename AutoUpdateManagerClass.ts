import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, EventEmitter3, LoggersType } from "./CommonTypes.js";
import "reflect-metadata";
export abstract class AutoUpdateManager<
  T extends AutoUpdatedClientObject<any>,
> {
  protected abstract objects_: { [_id: string]: T };
  protected isLoaded_ = false;
  public readonly socket: any;
  protected classParam: Constructor<T>;
  protected properties: (keyof T)[];
  public readonly className: string;
  public readonly managers: Record<
    string,
    AutoUpdateManager<AutoUpdatedClientObject<any>>
  >;
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
    socket: any,
    loggers: LoggersType,
    managers: Record<string, AutoUpdateManager<AutoUpdatedClientObject<any>>>,
    emitter: EventEmitter3,
  ) {
    this.className = className;
    this.managers = managers;
    this.emitter = emitter;
    this.socket = socket;
    this.classParam = classParam;
    this.properties = Reflect.getMetadata("props", classParam.prototype);
    this.loggers.debug = (s: string) =>
      loggers.debug("[DEM - " + className + " MANAGER] " + s);
    this.loggers.info = (s: string) =>
      loggers.info("[DEM - " + className + " MANAGER] " + s);
    this.loggers.error = (s: string) =>
      loggers.error("[DEM - " + className + " MANAGER] " + s);
    this.loggers.warn = (s: string) =>
      loggers.warn("[DEM - " + className + " MANAGER] " + s);
  }

  public get isLoaded() {
    return this.isLoaded_;
  }

  public close() {
    for (const id of this.objectIDs) {
      delete this.objects_[id];
    }
    this.socket.disconnect?.() ?? this.socket.disconnectSockets(true);
    this.loggers.info("Goodbye, see you next time!");
  }

  public async loadReferences(): Promise<void> {
    for (const obj of this.objectsAsArray) {
      await obj.loadMissingReferences();
    }
    this.isLoaded_ = true;
  }

  public async deleteObject(
    _id: string,
  ): Promise<{ success: boolean; message: string }> {
    const o = this.objects_[_id];
    const res = await o?.destroy(true);
    if (res?.success) delete this.objects_[_id];
    await o?.callbacks.delete(this as any);
    return res ?? { success: true, message: "Already gone" };
  }

  public get objectIDs(): string[] {
    return Object.keys(this.objects_);
  }

  public abstract handleGetMissingObject(_id: string): Promise<T>;
  public abstract createObject(data: Omit<any, "_id">): Promise<T>;
  public abstract getObject(_id: string): T | null;
  public abstract get objects(): {
    [_id: string]: T;
  };

  public abstract get objectsAsArray(): T[];
}
