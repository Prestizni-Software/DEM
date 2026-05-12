import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import {
  AutoUpdatedClientObject,
  DEMClientCallbacks,
} from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  globalCache,
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
  doDebug: boolean = false,
  emitter: EventEmitter = new EventEmitter(),
  callbacks: Partial<
    {
      [K in keyof T]: Partial<DEMClientCallbacks<InstanceType<T[K]>>>;
    } & Partial<DEMClientCallbacks<any>>
  > = {},
): Promise<WrappedInstances<T>> {
  const defaultCallbacks: DEMClientCallbacks<AutoUpdatedClientObject<any>> = {
    new: callbacks.new ?? ((x: any) => {}),
    update: callbacks.update ?? ((x: any, y: any) => {}),
    delete: callbacks.delete ?? ((x: any) => {}),
    progress: callbacks.progress ?? ((x: any) => {}),
  };
  if (!doDebug) {
    loggers.debug = (_) => {};
  }
  let wholeProgress = 0;
  let numberOfManagers = Object.keys(defs).length || 1;
  const progressUpdater = callbacks.progress ?? ((x: any) => {});
  const innerProgressUpdater = (fraction: number) => {
    progressUpdater(
      wholeProgress + (numberOfManagers == 0 ? 1 : fraction / numberOfManagers),
    );
    if (fraction == 1)
      wholeProgress += numberOfManagers == 0 ? 1 : fraction / numberOfManagers;
  };
  const managers = {} as WrappedInstances<T>;
  const startStartTime = Date.now();
  let startTime = Date.now();
  for (const key in defs) {
    try {
      const Model = defs[key];
      const c = new AutoUpdateClientManager(
        Model as any,
        key,
        loggers,
        socket,
        managers as any,
        emitter,
        {
          ...defaultCallbacks,
          ...callbacks[key],
          progress: innerProgressUpdater,
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
      let message = `Creating manager for: ${key}`;
      message += "\n Error creating manager: " + key;
      message += "\n " + error.message;
      loggers.error(message);
      loggers.error(error.stack);
      continue;
    }
  }
  loggers.debug("Created all managers in " + (Date.now() - startTime) + "ms");
  startTime = Date.now();

  const loadPromises = Object.keys(defs).map(async (key) => {
    let temp2 = { s: Date.now(), f: 0 };
    try {
      await managers[key].loadFromServer(temp2);
      loggers.debug(
        "Loaded data from server for manager: " +
          key +
          " in " +
          (temp2.f - temp2.s) +
          "ms",
      );
    } catch (error: any) {
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
    }
  });

  await Promise.all(loadPromises);

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
  public readonly managers: Record<
    string,
    AutoUpdateClientManager<AutoUpdatedClientObject<any>>
  >;
  public callbacks: DEMClientCallbacks<T>;
  declare public socket: Socket;
  public totalObjects: number = 0;
  public loadedObjects: number = 0;
  constructor(
    classParam: Constructor<T>,
    className: string,
    loggers: LoggersType,
    socket: Socket,
    managers: Record<
      string,
      AutoUpdateClientManager<AutoUpdatedClientObject<any>>
    >,
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
        this.totalObjects += 1;
        await this.handleGetMissingObject(id);
        this.loadedObjects += 1;
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
        this.totalObjects -= 1;
        this.loadedObjects -= 1;
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
          // Only join and log if we're actually going to use the debug log
          if (this.loggers.debug && this.loggers.debug.toString().length > 15) {
             this.loggers.debug(data.ids.join(", "));
          }
          this.totalObjects = data.ids.length;

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
              globalCache.objects[id] = {
                className: this.className,
                object: this.objects_[id],
              };
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

          const objectPromises = Object.keys(this.objects_).map(async (id) => {
            const obj = this.objects_[id];
            try {
              await obj.isPreLoadedAsync();
              await obj.loadMissingReferences();
              this.loadedObjects += 1;
              if (this.totalObjects < 100 || this.loadedObjects % Math.ceil(this.totalObjects / 100) === 0 || this.loadedObjects === this.totalObjects) {
                this.callbacks.progress(this.loadedObjects / this.totalObjects);
              }
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

          await Promise.all(objectPromises);

          this.loggers.info(
            "Loaded " + this.className + " - [" + Object.keys(this.objects_).length + "] entries",
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
    return this.objects_[_id];
  }

  public get objects(): { [_id: string]: T } {
    return this.objects_;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_);
  }

  public async handleGetMissingObject(_id: string): Promise<T> {
    if (this.getObject(_id)) return this.getObject(_id)!;
    if (!_id) throw new Error("No id.");
    if (!this.managers) throw new Error(`No managers.`);
    if (this.objects_[_id]) return this.objects_[_id];
    if (
      await new Promise((resolve, _) =>
        this.socket.emit(
          "startup" + this.className,
          null,
          async (
            res: ServerResponse<{ ids: string[]; properties: string[] }>,
          ) => {
            if (res.success && res.data.ids.includes(_id)) resolve(false);
            resolve(true);
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
    await object.waitForPreloaded();
    this.objects_[object._id] = object;
    globalCache.objects[object._id] = { className: this.className, object };
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();

    this.callbacks.new(this as any);
    return object;
  }

  public async createObject(data: Omit<IsData<Pure<T>>, "_id">) {
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
      await object.waitForPreloaded();
      const id = object._id;
      this.objects_[id] = object;
      await this.objects_[id].isPreLoadedAsync();
      await this.objects_[id].loadMissingReferences();
      await this.objects_[id].contactChildren();
      this.callbacks.new(this.objects_[id]);
      return this.objects_[id];
    } catch (error: any) {
      this.loggers.error(
        "Error creating new object from manager " + this.className,
      );
      this.loggers.error(error.message);
      throw error;
    }
  }
}
