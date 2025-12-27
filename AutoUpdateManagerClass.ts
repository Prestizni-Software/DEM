import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
} from "./CommonTypes.js";
import "reflect-metadata";
export abstract class AutoUpdateManager<T extends Constructor<any>> {
  protected abstract objects_: { [_id: string]: AutoUpdatedClientObject<any> };
  public readonly socket: any;
  protected classParam: T;
  protected properties: (keyof T)[];
  public readonly className: string;
  public readonly managers: Record<string, AutoUpdateManager<any>>;
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
    classParam: T,
    className: string,
    socket: any,
    loggers: LoggersType,
    managers: Record<string, AutoUpdateManager<any>>,
    emitter: EventEmitter3
  ) {
    this.className = className;
    this.managers = managers;
    this.emitter = emitter;
    this.socket = socket;
    this.classParam = classParam;
    this.properties =
      Reflect.getMetadata("props", classParam) ??
      Reflect.getMetadata("props", classParam.prototype);
    this.loggers.debug = (s: string) =>
      loggers.debug(
        "[DEM - " +
          className +" MANAGER] " +
          s
      );
    this.loggers.info = (s: string) =>
      loggers.info(
        "[DEM - " +
          className +" MANAGER] " +
          s
      );
    this.loggers.error = (s: string) =>
      loggers.error(
        "[DEM - " +
          className +" MANAGER] " +
          s
      );
    this.loggers.warn = (s: string) =>
      loggers.warn(
        "[DEM - " +
          className +" MANAGER] " +
          s
      );
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
      obj.loadMissingReferences();
      obj.contactChildren();
      await obj.checkAutoStatusChange();
    }
  }

  public async deleteObject(
    _id: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await this.objects_[_id].destroy(true);
    if (res.success) delete this.objects_[_id];
    return res;
  }

  public get objectIDs(): string[] {
    return Object.keys(this.objects_);
  }

  protected abstract handleGetMissingObject(
    _id: string
  ): Promise<AutoUpdatedClientObject<any> | null>;
  public abstract createObject(
    data: IsData<InstanceType<T>>
  ): Promise<AutoUpdatedClientObject<any>>;
  public abstract getObject(_id: string): AutoUpdatedClientObject<any> | null;
  public abstract get objects(): {
    [_id: string]: AutoUpdatedClientObject<any>;
  };

  public abstract get objectsAsArray(): AutoUpdatedClientObject<any>[];
}
