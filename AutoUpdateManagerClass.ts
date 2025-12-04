import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
} from "./CommonTypes.js";
import "reflect-metadata";
export abstract class AutoUpdateManager<T extends Constructor<any>> {
  protected abstract classes: { [_id: string]: AutoUpdatedClientObject<any> };
  public socket: any;
  protected classParam: T;
  protected properties: (keyof T)[];
  public readonly classers: Record<string, AutoUpdateManager<any>>;
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
    socket: any,
    loggers: LoggersType,
    classers: Record<string, AutoUpdateManager<any>>,
    emitter: EventEmitter3
  ) {
    this.classers = classers;
    this.emitter = emitter;
    this.socket = socket;
    this.classParam = classParam;
    this.properties =
      Reflect.getMetadata("props", classParam) ??
      Reflect.getMetadata("props", classParam.prototype);
    this.loggers.debug = (s: string) =>
      loggers.debug(
        "[DEM - " +
          classParam.name +" MANAGER] " +
          s
      );
    this.loggers.info = (s: string) =>
      loggers.info(
        "[DEM - " +
          classParam.name +" MANAGER] " +
          s
      );
    this.loggers.error = (s: string) =>
      loggers.error(
        "[DEM - " +
          classParam.name +" MANAGER] " +
          s
      );
    this.loggers.warn = (s: string) =>
      loggers.warn(
        "[DEM - " +
          classParam.name +" MANAGER] " +
          s
      );
  }

  public async loadReferences(): Promise<void> {
    for (const obj of this.objectsAsArray) {
      obj.loadMissingReferences();
      await obj.checkAutoStatusChange();
      await obj.contactChildren();
    }
  }

  public async deleteObject(
    _id: string
  ): Promise<{ success: boolean; message: string }> {
    if (typeof this.classes[_id] === "string") {
      const temp = await this.handleGetMissingObject(this.classes[_id]);
      if (!temp) throw new Error(`No object with id ${_id}`);
      this.classes[_id] = temp;
    }
    const res = await this.classes[_id].destroy(true);
    if (res.success) delete this.classes[_id];
    return res;
  }

  public get objectIDs(): string[] {
    return Object.keys(this.classes);
  }

  public get className(): string {
    return this.classParam.name;
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
