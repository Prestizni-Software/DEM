import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { DEMClientCallbacks } from "./AutoUpdatedClientObjectClass.js";
import {
  Constructor,
  IsData,
  LoggersType,
  globalCache,
  ServerResponse,
  IAutoUpdatedClientObjectBase,
  MongoId,
  IAutoUpdateManager,
} from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";

export type WrappedInstances<
  T extends Record<string, Constructor<IAutoUpdatedClientObjectBase>>,
> = {
  [K in keyof T]: AutoUpdateClientManager<
    InstanceType<T[K]>,
    WrappedInstances<T>
  >;
};

export async function AUCManagerFactory<
  T extends Record<string, Constructor<IAutoUpdatedClientObjectBase>>,
>(
  defs: T,
  loggers: LoggersType,
  socket: Socket,
  doDebug: boolean = false,
  emitter: EventEmitter = new EventEmitter(),
  callbacks: Partial<
    { [K in keyof T]: Partial<DEMClientCallbacks<any>> } & Partial<
      DEMClientCallbacks<IAutoUpdatedClientObjectBase>
    >
  > = {},
): Promise<WrappedInstances<T>> {
  const defaultCallbacks: DEMClientCallbacks<IAutoUpdatedClientObjectBase> = {
    new: callbacks.new ?? ((_x: IAutoUpdatedClientObjectBase) => {}),
    update:
      callbacks.update ??
      ((_x: IAutoUpdatedClientObjectBase, _y: string) => {}),
    delete: callbacks.delete ?? ((_x: IAutoUpdatedClientObjectBase) => {}),
    progress: callbacks.progress ?? ((_x: number) => {}),
  };

  if (!doDebug) {
    loggers.debug = (_: string) => {};
  }

  let wholeProgress = 0;
  let numberOfManagers = Object.keys(defs).length || 1;
  const progressUpdater = callbacks.progress ?? ((_x: number) => {});

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
        Model,
        key,
        socket,
        loggers,
        managers,
        emitter,
        {
          ...defaultCallbacks,
          ...callbacks[key],
          progress: innerProgressUpdater,
        },
      );
      managers[key] = c as any;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes(
          "Local type does not match server type for manager",
        )
      )
        throw error;
      let message = `Creating manager for: ${key}`;
      message += "\n Error creating manager: " + key;
      message +=
        "\n " + (error instanceof Error ? error.message : String(error));
      loggers.error?.(message);
      if (error instanceof Error && error.stack) loggers.error?.(error.stack);
      continue;
    }
  }

  loggers.debug?.("Created all managers in " + (Date.now() - startTime) + "ms");
  startTime = Date.now();

  const loadPromises = Object.keys(defs).map(async (key) => {
    let temp2 = { s: Date.now(), f: 0 };
    try {
      const manager = managers[key];
      if (!manager) {
        throw new Error(`Manager ${key} was not created due to previous error`);
      }
      await manager.loadFromServer(temp2);
      loggers.debug?.(
        "Loaded data from server for manager: " +
          key +
          " in " +
          (temp2.f - temp2.s) +
          "ms",
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes(
          "Local type does not match server type for manager",
        )
      )
        throw error;
      let message = "Error loading data from server for manager: " + key;
      message +=
        "\n " + (error instanceof Error ? error.message : String(error));
      message += "\n Failed in " + (temp2.f - temp2.s) + "ms";
      loggers.error?.(message);
      if (error instanceof Error && error.stack)
        loggers.error?.(message + "\n" + error.stack);
    }
  });

  await Promise.all(loadPromises);

  // Generate getters and setters for all client objects now that everything is loaded
  for (const manager of Object.values(managers)) {
    for (const obj of (manager as any).objectsAsArray) {
      (obj as any).generateSettersAndGetters();
    }
  }

  loggers.debug?.(
    "Loaded data from server for all managers in " +
      (Date.now() - startTime) +
      "ms",
  );
  loggers.info?.(
    "Loaded all managers in " + (Date.now() - startStartTime) + "ms",
  );

  return managers;
}

export class AutoUpdateClientManager<
  T extends IAutoUpdatedClientObjectBase,
  M extends Record<string, IAutoUpdateManager<any>> = Record<
    string,
    IAutoUpdateManager<any>
  >,
> extends AutoUpdateManager<T, M> {
  protected objects_: { [_id: string]: T } = {};
  readonly managers: M;
  callbacks: DEMClientCallbacks<any>;
  public readonly socket: Socket;
  totalObjects: number = 0;
  loadedObjects: number = 0;

  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: Socket,
    loggers: LoggersType,
    managers: M,
    emitter: EventEmitter,
    callbacks: DEMClientCallbacks<any>,
  ) {
    super(classParam, className, socket, loggers, managers, emitter);
    this.socket = socket;
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
      } catch (error: unknown) {
        this.loggers.error(
          "Error loading object " +
            id +
            " from manager " +
            this.className +
            " - " +
            (error instanceof Error ? error.message : String(error)),
        );
        if (error instanceof Error && error.stack)
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
      } catch (error: unknown) {
        this.loggers.error(
          "Error applying object deletion from manager " +
            this.className +
            " - " +
            id,
        );
        this.loggers.error(
          error instanceof Error ? error.message : String(error),
        );
        if (error instanceof Error && error.stack)
          this.loggers.error(error.stack);
      }
    });
  }

  async loadFromServer(t?: { s: number; f: number }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.emit(
        "startup" + this.className,
        null,
        async (
          res: ServerResponse<{ ids: string[]; objects?: any[]; properties: string[] }>,
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
            if (property === "_id") continue;
            if (data.properties.includes(property))
              data.properties.splice(data.properties.indexOf(property), 1);
            else extraProperties.push(property);
          }

          let { allowedToLoad, errorMessage } = this.checkLoadability(
            extraProperties,
            data,
          );
          if (!allowedToLoad) {
            this.loggers.error?.(errorMessage);
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

          if (this.loggers.debug && this.loggers.debug.toString().length > 15) {
            this.loggers.debug(data.ids.join(", "));
          }

          this.totalObjects = data.ids.length;

          const objectMap = new Map<string, any>();
          if (data.objects) {
            for (const objData of data.objects) {
              if (objData && objData._id) {
                objectMap.set(objData._id.toString(), objData);
              }
            }
          }

          for (const id of data.ids) {
            try {
              const objData = objectMap.get(id);
              this.objects_[id] = new this.classParam(
                this.classParam,
                this.socket,
                objData || id,
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
            } catch (error: unknown) {
              this.loggers.error(
                "Error loading object " +
                  id +
                  " from manager " +
                  this.className +
                  " - " +
                  (error instanceof Error ? error.message : String(error)),
              );
              if (error instanceof Error && error.stack)
                this.loggers.error(error.stack);
            }
          }

          const objectPromises = Object.keys(this.objects_).map(async (id) => {
            const obj = this.objects_[id];
            try {
              await obj.isPreLoadedAsync();
              await obj.loadMissingReferences();
              this.loadedObjects += 1;
              if (
                this.totalObjects < 100 ||
                this.loadedObjects % Math.ceil(this.totalObjects / 100) === 0 ||
                this.loadedObjects === this.totalObjects
              ) {
                this.callbacks.progress(this.loadedObjects / this.totalObjects);
              }
            } catch (error: unknown) {
              this.loggers.error(
                "Error loading object " +
                  id +
                  " from manager " +
                  this.className +
                  " - " +
                  (error instanceof Error ? error.message : String(error)),
              );
              if (error instanceof Error && error.stack)
                this.loggers.error(error.stack);
            }
          });

          await Promise.all(objectPromises);

          this.loggers.info(
            "Loaded " +
              this.className +
              " - [" +
              Object.keys(this.objects_).length +
              "] entries",
          );
          this.startSocketListeners();
          this.isLoaded_ = true;
          resolve();
        },
      );
    });
    if (t) t.f = Date.now();
  }

  private checkLoadability(
    extraProperties: string[],
    data: { properties: string[] },
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
    const filteredProperties = data.properties.filter((p) => p !== "_id");
    if (filteredProperties.length > 0) {
      allowedToLoad = false;
      errorMessage +=
        "\n\nLocal type is missing " +
        (filteredProperties.length > 1 ? "these properties" : "this property") +
        ":\n" +
        filteredProperties.join("\n");
    }
    return { allowedToLoad, errorMessage };
  }

  public getObject(_id?: MongoId): T | null | undefined {
    if (!_id) return null;
    return this.objects_[_id.toString()] || undefined;
  }

  public get objects(): { [_id: string]: T } {
    return this.objects_;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_);
  }

  async handleGetMissingObject(_id: MongoId): Promise<T> {
    const _idStr = _id.toString();
    if (this.getObject(_idStr)) return this.getObject(_idStr)!;
    if (!_idStr) throw new Error("No id.");
    if (!this.managers) throw new Error(`No managers.`);
    if (this.objects_[_idStr]) return this.objects_[_idStr];

    const object = new this.classParam(
      this.classParam,
      this.socket,
      _idStr,
      this.loggers,
      this.className,
      this,
      this.callbacks,
      this.emitter,
    );
    await object.waitForPreloaded();
    if ((object as any).loadError) throw new Error((object as any).loadError);
    this.objects_[object._id.toString()] = object;
    globalCache.objects[object._id.toString()] = {
      className: this.className,
      object: object,
    };
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    this.callbacks.new(object as any);
    return object;
  }

  async createObject(data: Omit<IsData<T>, "_id">): Promise<T> {
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
      const id = object._id.toString();
      this.objects_[id] = object;
      globalCache.objects[id] = {
        className: this.className,
        object: object,
      };
      await this.objects_[id].isPreLoadedAsync();
      await this.objects_[id].loadMissingReferences();
      await this.objects_[id].contactChildren();
      this.callbacks.new(this.objects_[id] as any);
      return this.objects_[id];
    } catch (error: unknown) {
      this.loggers.error(
        "Error creating new object from manager " + this.className,
      );
      this.loggers.error(
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
