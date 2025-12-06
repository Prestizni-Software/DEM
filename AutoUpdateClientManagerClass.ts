import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedClientObjectClass.js";
import {
  AutoUpdated,
  Constructor,
  IsData,
  LoggersType,
  ServerResponse,
} from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";
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
  disableDEMDebugMessages: boolean = false,
  emitter: EventEmitter = new EventEmitter()
): Promise<WrappedInstances<T>> {
  if (disableDEMDebugMessages) {
    loggers.debug = (_) => {};
  }
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
        emitter
      );
      classers[key] = c;
      try {
        await c.loadFromServer();
      } catch (error: any) {
        if (
          error.message.includes(
            "Local type does not match server type for manager"
          )
        )
          throw error;
        message += "\n Error loading data from server for manager: " + key;
        message += "\n " + error.message;
        loggers.error(message);
        loggers.error(error.stack);
        continue;
      }
    } catch (error: any) {
      if (
        error.message.includes(
          "Local type does not match server type for manager"
        )
      )
        throw error;
      message += "\n Error creating manager: " + key;
      message += "\n " + error.message;
      loggers.error(message);
      loggers.error(error.stack);
      continue;
    }
    loggers.debug("Created manager: " + key);
  }
  for (const key in defs) {
    try {
      await classers[key].loadReferences();
    } catch (error: any) {
      let message = "Error loading manager: " + key;
      message += "\n Error resolving references in manager";
      message += "\n " + error.message;
      loggers.error(message);
      loggers.error(error.stack);
    }
    loggers.debug("Loaded manager references: " + key);
  }
  return classers;
}

export class AutoUpdateClientManager<
  T extends Constructor<any>
> extends AutoUpdateManager<T> {
  protected classes: { [_id: string]: AutoUpdated<T> } = {};
  public readonly classers: Record<string, AutoUpdateClientManager<any>>;
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Socket,
    classers: Record<string, AutoUpdateClientManager<any>>,
    emitter: EventEmitter
  ) {
    super(classParam, socket, loggers, classers, emitter);
    this.classers = classers;
  }

  private startSocketListeners() {
    this.socket.on("new" + this.classParam.name, async (id: string) => {
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
    this.socket.on("delete" + this.classParam.name, async (id: string) => {
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

  public async loadFromServer() {
    return new Promise<void>((resolve, reject) => {
      this.socket.emit(
        "startup" + this.classParam.name,
        null,
        async (
          res: ServerResponse<{ ids: string[]; properties: string[] }>
        ) => {
          if (!res.success) {
            this.loggers.error("Error loading ids from server for manager");
            this.loggers.error(res.message);
            throw new Error(res.message);
          }
          const data = res.data;
          let extraProperties: string[] = [];
          for (const property of this.properties) {
            if (typeof property !== "string")
              throw new Error(
                "Only string keys allowed. Not this shit: " + String(property)
              );
            if (data.properties.includes(property))
              data.properties.splice(data.properties.indexOf(property), 1);
            else extraProperties.push(property);
          }
          let allowedToLoad = true;
          let errorMessage =
            "Local type does not match server type for manager " +
            this.className;
          if (extraProperties.length > 0) {
            allowedToLoad = false;
            errorMessage +=
              "\n\nLocal type has " +
              (extraProperties.length > 1
                ? "these extra properties"
                : "this extra property") +
              ":\n" +
              extraProperties.join("\n");
          }
          if (data.properties.length > 0) {
            allowedToLoad = false;
            errorMessage +=
              "\n\nLocal type is missing " +
              (data.properties.length > 1
                ? "these properties"
                : "this property") +
              ":\n" +
              data.properties.join("\n");
          }
          if (!allowedToLoad) {
            this.loggers.error(errorMessage);
            reject(new Error(errorMessage));
            return;
          }
          this.loggers.debug(
            "Loading manager DB " +
              this.className +
              " - [" +
              data.ids.length +
              "] entries"
          );
          this.loggers.debug(data.ids.join(", "));

          for (const id of data.ids) {
            try {
              this.classes[id] = await createAutoUpdatedClass(
                this.classParam,
                this.socket,
                id,
                this.loggers,
                this,
                this.emitter
              );
              await this.classes[id].isPreLoadedAsync();
              this.loggers.debug(
                "Loaded object " + id + " from manager " + this.className
              );
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
          let i = 0;
          for (const id in this.classes) {
            try {
              this.classes[id].loadMissingReferences();
              i++;
            } catch (error: any) {
              this.loggers.error(
                "Error loading missing references for object " +
                  id +
                  " from manager " +
                  this.className +
                  " - " +
                  error.message
              );
              this.loggers.error(error.stack);
            }
          }
          this.loggers.debug(
            "Loaded missing references for " +
              this.className +
              " - [" +
              i +
              "] entries"
          );
          this.startSocketListeners();
          resolve();
        }
      );
    });
  }

  public getObject(_id?: string): AutoUpdated<T> | null {
    return _id ? this.classes[_id] : null;
  }

  public get objects(): { [_id: string]: AutoUpdated<T> } {
    return this.classes;
  }

  public get objectsAsArray(): AutoUpdated<T>[] {
    return Object.values(this.classes);
  }

  protected async handleGetMissingObject(_id: string): Promise<AutoUpdated<T>> {
    if (!this.classers) throw new Error(`No classers.`);
    this.loggers.debug(
      "Getting missing object " + _id + " from manager " + this.className
    );
    const object = await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      _id,
      this.loggers,
      this,
      this.emitter
    );
    await object.isPreLoadedAsync();
    object.loadMissingReferences();
    return object;
  }

  public async createObject(
    data: Omit<IsData<InstanceType<T>>, "_id">
  ): Promise<AutoUpdated<T>> {
    if (!this.classers) throw new Error(`No classers.`);
    this.loggers.debug("Creating new object from manager " + this.className);
    try {
      const object = await createAutoUpdatedClass(
        this.classParam,
        this.socket,
        data as any,
        this.loggers,
        this,
        this.emitter
      );
      object.loadMissingReferences();
      this.classes[object._id] = object;
      return object;
    } catch (error: any) {
      this.loggers.error(
        "Error creating new object from manager " + this.className
      );
      this.loggers.error(error.message);
      throw error;
    }
  }
}
