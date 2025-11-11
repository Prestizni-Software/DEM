import { AutoUpdated } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, IsData, LoggersType } from "./CommonTypes.js";
import "reflect-metadata";
export abstract class AutoUpdateManager<T extends Constructor<any>> {
  protected classes: { [_id: string]: AutoUpdated<T> } = {};
  public socket: any;
  protected classParam: T;
  protected properties: (keyof T)[];
  public readonly classers: Record<string, AutoUpdateManager<any>>;
  protected loggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  };
  protected classesAsArray: AutoUpdated<T>[] = [];
  protected emitter: EventTarget;
  private isLoaded = false;
  constructor(
    classParam: T,
    socket: any,
    loggers: LoggersType,
    classers: Record<string, AutoUpdateManager<any>>,
    emitter: EventTarget
  ) {
    this.emitter = emitter;
    this.classers = classers;
    this.socket = socket;
    this.classParam = classParam;
    this.properties = Reflect.getMetadata(
      "props",
      Object.getPrototypeOf(classParam)
    );
    loggers.warn = loggers.warn ?? loggers.info;
    this.loggers = loggers;
  }


  public getObject(
    _id: string
  ): AutoUpdated<T> | null {
    return this.classes[_id];
  }

  public async isLoadedAsync(): Promise<boolean> {
    if (this.isLoaded) return this.isLoaded;
    await new Promise((resolve) => this.emitter.addEventListener("ManagerLoaded"+this.classParam.name+this.className, resolve));
    this.isLoaded = true;
    return this.isLoaded;
  }

  public async deleteObject(_id: string): Promise<void> {
    if (typeof this.classes[_id] === "string")
      this.classes[_id] = await this.handleGetMissingObject(this.classes[_id]);
    (this.classes[_id]).destroy();
    this.classesAsArray.splice(this.classesAsArray.indexOf(this.classes[_id]), 1);
    delete this.classes[_id];
  }

  public get objectIDs(): string[] {
    return Object.keys(this.classes);
  }

  public get objects(): { [_id: string]: AutoUpdated<T> | string } {
    return this.classes;
  }

  public get objectsAsArray(): AutoUpdated<T>[] {
    return this.classesAsArray;
  }

  public get className(): string {
    return this.classParam.name;
  }

  protected abstract handleGetMissingObject(
    _id: string
  ): Promise<AutoUpdated<T>>;
  public abstract createObject(
    data: IsData<InstanceType<T>>
  ): Promise<AutoUpdated<T>>;
}
