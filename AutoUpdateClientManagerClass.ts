import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import {
  AutoUpdatedClientObject,
  DEMClientCallbacks,
} from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  DeAutoUpdate,
  IsData,
  LoggersType,
  Pure,
  ServerResponse,
} from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";
export type WrappedInstances<
  T extends Record<string, Constructor<AutoUpdatedClientObject<any>>>,
> = {
  [K in keyof T]: AutoUpdateClientManager<InstanceType<T[K]>>;
};

// ---------------------- Factory ----------------------
export async function AUCManagerFactory<
  T extends Record<string, Constructor<AutoUpdatedClientObject<any>>>,
>(
  defs: T,
  loggers: LoggersType,
  socket: Socket,
  disableDEMDebugMessages: boolean = false,
  emitter: EventEmitter = new EventEmitter(),
  callbacks: Partial<{
    [K in keyof T]: Partial<DEMClientCallbacks<InstanceType<T[K]>>>;
  }> = {},
): Promise<WrappedInstances<T>> {
  const defaultCallbacks: DEMClientCallbacks<AutoUpdatedClientObject<any>> = {
    new: (x: any) => {},
    update: (x: any, y: any) => {},
    delete: (x: any) => {},
  };
  if (disableDEMDebugMessages) {
    loggers.debug = (_) => {};
  }
  const managers = {} as WrappedInstances<T>;
  const startStartTime = Date.now();
  let startTime = Date.now();
  let temp = 0;
  for (const key in defs) {
    let message = `Creating manager for: ${key}`;
    temp = Date.now();
    try {
      const Model = defs[key];
      const c = new AutoUpdateClientManager(
        Model as any,
        key,
        loggers,
        socket,
        managers,
        emitter,
        {
          ...defaultCallbacks,
          ...callbacks[key],
        },
      );
      managers[key] = c;
    } catch (error: any) {
      if (
        error.message.includes(
          "Local type does not match server type for manager",
        )
      )
        throw error;
      message += "\n Error creating manager: " + key;
      message += "\n " + error.message;
      loggers.error(message);
      loggers.error(error.stack);
      continue;
    }
    loggers.debug(
      "Created manager: " + key + " in " + (Date.now() - temp) + "ms",
    );
  }
  loggers.debug("Created all managers in " + (Date.now() - startTime) + "ms");
  startTime = Date.now();
  let i = 0;
  for (const key in defs) {
    let temp2 = { s: Date.now(), f: 0 };
    managers[key]
      .loadFromServer(temp2)
      .then(() => {
        i++;
        loggers.debug(
          "Loaded data from server for manager: " +
            key +
            " in " +
            (temp2.f - temp2.s) +
            "ms",
        );
      })
      .catch((error: any) => {
        i++;
        if (
          error.message.includes(
            "Local type does not match server type for manager",
          )
        )
          throw error;
        let message = "Error loading data from server for manager: " + key;
        message += "\n " + error.message;
        message += "\n Failed in " + (temp2.f - temp2.s) + "ms";
        loggers.error(message);
        loggers.error(error.stack);
      });
  }
  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (i === Object.keys(defs).length) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
  loggers.debug(
    "Loaded data from server for all managers in " +
      (Date.now() - startTime) +
      "ms",
  );
  loggers.info(
    "Loaded all managers in " + (Date.now() - startStartTime) + "ms",
  );
  return managers;
}

export class AutoUpdateClientManager<
  T extends AutoUpdatedClientObject<any>,
> extends AutoUpdateManager<T> {
  protected objects_: { [_id: string]: T } = {};
  public readonly managers: Record<string, AutoUpdateClientManager<any>>;
  public callbacks: DEMClientCallbacks<T>;
  private readonly missingObjects_: string[] = [];
  declare public socket: Socket;
  constructor(
    classParam: Constructor<T>,
    className: string,
    loggers: LoggersType,
    socket: Socket,
    managers: Record<string, AutoUpdateClientManager<any>>,
    emitter: EventEmitter,
    callbacks: DEMClientCallbacks<T>,
  ) {
    super(classParam, className, socket, loggers, managers, emitter);
    this.managers = managers;
    this.callbacks = callbacks;
  }

  private startSocketListeners() {
    this.socket.on("new" + this.className, async (id: string) => {
      this.loggers.debug(
        "Applying new object from manager " + this.className + " - " + id,
      );
      try {
        this.objects_[id] = await this.handleGetMissingObject(id);
      } catch (error: any) {
        this.loggers.error(
          "Error loading object " +
            id +
            " from manager " +
            this.className +
            " - " +
            error.message,
        );
        this.loggers.error(error.stack);
      }
    });
    this.socket.on("delete" + this.className, async (id: string) => {
      this.loggers.debug(
        "Applying object deletion from manager " + this.className + " - " + id,
      );
      try {
        await this.deleteObject(id);
      } catch (error: any) {
        this.loggers.error(
          "Error applying object deletion from manager " +
            this.className +
            " - " +
            id,
        );
        this.loggers.error(error.message);
        this.loggers.error(error.stack);
      }
    });
  }

  public async loadFromServer(t?: { s: number; f: number }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.emit(
        "startup" + this.className,
        null,
        async (
          res: ServerResponse<{ ids: string[]; properties: string[] }>,
        ) => {
          if (!res.success) {
            this.loggers.error("Error loading ids from server for manager");
            this.loggers.error(res.message);

            reject(new Error(res.message));
            return;
          }
          const data = res.data;
          let extraProperties: string[] = [];
          for (const property of this.properties) {
            if (typeof property !== "string")
              throw new Error(
                "Only string keys allowed. Not this shit: " + String(property),
              );
            if (data.properties.includes(property))
              data.properties.splice(data.properties.indexOf(property), 1);
            else extraProperties.push(property);
          }
          let { allowedToLoad, errorMessage } = this.checkLoadability(
            extraProperties,
            data,
          );
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
              "] entries",
          );
          this.loggers.debug(data.ids.join(", "));
          let i = 0;
          for (const id of data.ids) {
            try {
              this.objects_[id] = new this.classParam(
                this.classParam,
                this.socket,
                id,
                this.loggers,
                this.className,
                this,
                this.callbacks,
                this.emitter,
              );
              this.loggers.debug(
                "Loading object " + id + " from manager " + this.className,
              );
            } catch (error: any) {
              this.loggers.error(
                "Error loading object " +
                  id +
                  " from manager " +
                  this.className +
                  " - " +
                  error.message,
              );
              this.loggers.error(error.stack);
            }
          }
          for (const id in this.objects_) {
            this.objects_[id]
              .isPreLoadedAsync()
              .then(() => {
                try {
                  this.objects_[id].loadMissingReferences();
                } catch (error: any) {
                  this.loggers.error(
                    "Error loading missing references for object " +
                      id +
                      " from manager " +
                      this.className +
                      " - " +
                      error.message,
                  );
                  this.loggers.error(error.stack);
                }
                i++;
              })
              .catch((error: any) => {
                i++;
                this.loggers.error(
                  "Error preloading object " +
                    id +
                    " from manager " +
                    this.className +
                    " - " +
                    error.message,
                );
                this.loggers.error(error.stack);
              });
          }
          await new Promise((resolve, reject) => {
            const interval = setInterval(() => {
              if (i === Object.keys(this.objects_).length) {
                clearInterval(interval);
                resolve(null);
              }
            }, 100);
          });
          this.loggers.info(
            "Loaded " + this.className + " - [" + i + "] entries",
          );
          this.startSocketListeners();

          resolve();
        },
      );
    });
    t ? (t.f = Date.now()) : void 0;
  }

  private checkLoadability(
    extraProperties: string[],
    data: { ids: string[]; properties: string[] },
  ) {
    let allowedToLoad = true;
    let errorMessage =
      "Local type does not match server type for manager " + this.className;
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
        (data.properties.length > 1 ? "these properties" : "this property") +
        ":\n" +
        data.properties.join("\n");
    }
    return { allowedToLoad, errorMessage };
  }

  public getObject(_id?: string): T | null {
    if (!_id) return null;
    if (this.missingObjects_.includes(_id)) return null;
    if (this.objects_[_id]) return this.objects_[_id];
    this.handleGetMissingObject(_id)
      .then((obj) =>
        obj ? (this.objects_[_id] = obj) : this.missingObjects_.push(_id),
      )
      .catch((_) => this.missingObjects_.push(_id));
    return null;
  }

  public get objects(): { [_id: string]: T } {
    return this.objects_;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_);
  }

  public async handleGetMissingObject(_id: string): Promise<T> {
    if (!this.managers) throw new Error(`No managers.`);
    this.loggers.debug(
      "Getting missing object " + _id + " from manager " + this.className,
    );
    if (this.objects_[_id]) return this.objects_[_id];
    if (
      await new Promise((resolve, _) =>
        this.socket.emit(
          "startup" + this.className,
          null,
          async (
            res: ServerResponse<{ ids: string[]; properties: string[] }>,
          ) => {
            if (res.success && res.data.ids.includes(_id)) resolve(true);
            resolve(false);
          },
        ),
      )
    )
      throw new Error("Non existent or not accesable.");
    const object = new this.classParam(
      this.classParam,
      this.socket,
      _id,
      this.loggers,
      this.className,
      this,
      this.callbacks,
      this.emitter,
    );
    await object.isPreLoadedAsync();
    object.loadMissingReferences();
    return object;
  }

  public async createObject(
    data: Omit<IsData<Pure<T>>, keyof AutoUpdatedClientObject<any> | "_id">,
  ) {
    if (!this.managers) throw new Error(`No managers.`);
    this.loggers.debug("Creating new object from manager " + this.className);

    try {
      const object = new this.classParam(
        this.classParam,
        this.socket,
        data,
        this.loggers,
        this.className,
        this,
        this.callbacks,
        this.emitter,
      );
      await object.isPreLoadedAsync();
      object.contactChildren();
      object.loadMissingReferences();
      this.objects_[object._id] = object;
      return object;
    } catch (error: any) {
      this.loggers.error(
        "Error creating new object from manager " + this.className,
      );
      this.loggers.error(error.message);
      throw error;
    }
  }
}
