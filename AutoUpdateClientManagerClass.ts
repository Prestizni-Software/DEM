import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, IsData, LoggersType } from "./CommonTypes.js";
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
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Socket,
    classers: Record<string, AutoUpdateManager<any>>,
    emitter: EventEmitter,
    token: string
  ) {
    
    super(classParam, socket, loggers, classers, emitter);
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
          this.classesAsArray.push(this.classes[id]);
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
        this.classesAsArray.push(this.classes[id]);
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

  protected async handleGetMissingObject(_id: string) {
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

  public async createObject(data: Omit<IsData<InstanceType<T>>, "_id">) {
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
