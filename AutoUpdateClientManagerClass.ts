import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { AutoUpdatedClientObject, createAutoUpdatedClass } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, InstanceOf, IsData, LoggersType, Prev } from "./CommonTypes.js";
import EventEmitter from "eventemitter3";
export type WrappedInstances<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: AutoUpdateClientManager<T[K]>;
};
// ---------------------- Factory ----------------------
export async function AUCManagerFactory<
  T extends Record<string, Constructor<any>>
>(
  defs: T,
  loggers: LoggersType,
  socket: Socket,
  token: string,
  emitter: EventEmitter = new EventEmitter()
): Promise<WrappedInstances<T>> {
  const classers = {} as WrappedInstances<T>;
  for (const key in defs) {
    let message = `Creating manager for: ${key}`;
    try {
      const Model = defs[key];
      const c = new AutoUpdateClientManager(
        Model,
        loggers,
        socket,
        classers,
        emitter,
        token
      );
      classers[key] = c;
    } catch (error: any) {
      message += "\n Error creating manager: " + key;
      message += "\n " + error.message;
      loggers.error(error.stack);
      loggers.error(message);
      continue;
    }
    try {
      await classers[key].isLoadedAsync();
    } catch (error: any) {
      message += "\n Error creating manager: " + key;
      message += "\n " + error.message;
      loggers.error(error.stack);
      loggers.error(message);
      continue;
    }
  }

  return classers;
}

export class AutoUpdateClientManager<
  T extends Constructor<any>
> extends AutoUpdateManager<T> {
  private readonly token;
  protected classes: { [_id: string]: AutoUpdated<T> } = {};
  public readonly classers: Record<string, AutoUpdateClientManager<any>>;
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Socket,
    classers: Record<string, AutoUpdateClientManager<any>>,
    emitter: EventEmitter,
    token: string
  ) {
    
    super(classParam, socket, loggers, classers, emitter);
    this.classers = classers;
    this.token = token;
    socket.emit("startup" + classParam.name, async (data: string[]) => {
      this.loggers.debug(
        "Loading manager DB " +
          this.className +
          " - [" +
          data.length +
          "] entries"
      );

      for (const id of data) {
        try {
          this.classes[id] = await this.handleGetMissingObject(id);
        } catch (error: any) {
          this.loggers.error(
            "Error loading object " +
              id +
              " from manager " +
              this.className +
              " - " +
              error.message
          );
          this.loggers.error(error.stack);
        }
      }
      emitter.emit("ManagerLoaded" + this.classParam.name + this.className);
    });
    socket.on("new" + classParam.name, async (id: string) => {
      this.loggers.debug(
        "Applying new object from manager " + this.className + " - " + id
      );
      try {
        this.classes[id] = await this.handleGetMissingObject(id);
      } catch (error: any) {
        this.loggers.error(
          "Error loading object " +
            id +
            " from manager " +
            this.className +
            " - " +
            error.message
        );
        this.loggers.error(error.stack);
      }
    });
    socket.on("delete" + classParam.name, async (id: string) => {
      this.loggers.debug(
        "Applying object deletion from manager " + this.className + " - " + id
      );
      try {
        await this.deleteObject(id);
      } catch (error: any) {
        this.loggers.error(
          "Error applying object deletion from manager " +
            this.className +
            " - " +
            id
        );
        this.loggers.error(error.message);
        this.loggers.error(error.stack);
      }
    });
  }

  public getObject(
    _id: string
  ): AutoUpdated<T> | null {
    return this.classes[_id];
  }

  public get objects(): { [_id: string]: AutoUpdated<T> } {
    return this.classes;
  }

  public get objectsAsArray(): AutoUpdated<T>[] {
    return Object.values(this.classes);
  }

  protected async handleGetMissingObject(_id: string):Promise<AutoUpdated<T>> {
    if (!this.classers) throw new Error(`No classers.`);
    return await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      _id,
      this.loggers,
      this,
      this.emitter,
      this.token
    );
  }

  public async createObject(data: Omit<IsData<InstanceType<T>>, "_id">):Promise<AutoUpdated<T>> {
    if (!this.classers) throw new Error(`No classers.`);
    const object = await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      data as any,
      this.loggers,
      this,
      this.emitter,
      this.token
    );
    this.classes[object._id] = object;
    return object;
  }
}

export type UnwrapRef<T, D extends number = 5> =
  // stop when depth = 0
  D extends 0 ? T : T extends any ? UnwrapRef<T, Prev[D]> : T extends (infer A)[] ? UnwrapRef<A, Prev[D]>[] : T extends object ? {
    [K in keyof T]: UnwrapRef<T[K], Prev[D]>;
  } : T;
export type AutoUpdated<T extends Constructor<any>> =
  AutoUpdatedClientObject<T> & UnwrapRef<InstanceOf<T>>;
