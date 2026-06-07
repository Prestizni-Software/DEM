import {
  AutoUpdatedClientObject,
  DEMClientCallbacks,
} from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  MongoId,
  ServerResponse,
<<<<<<< HEAD
  EVENT_STARTUP,
  globalCache,
  InstanceOf,
  IDEMSocket,
  EVENT_NEW,
  EVENT_DELETE,
=======
  EVENT_GET_BATCH,
>>>>>>> 105986a8a36b21cfdf5c685f44010c3f9a2aac9d
} from "./CommonTypes.js";
import { io, Socket } from "socket.io-client";
import { EventEmitter } from "eventemitter3";

export type AUCDefinitions<
  T extends Record<string, Constructor<AutoUpdatedClientObject<any, any>>> =
    any,
> = {
  [K in keyof T]: T[K];
};

export type WrappedClientInstances<
  T extends Record<string, Constructor<AutoUpdatedClientObject<any, any>>>,
> = {
  [K in keyof T]: AutoUpdateClientManager<
    InstanceOf<T[K]>,
    WrappedClientInstances<T>
  >;
};

export async function AUCManagerFactory<
  T extends Record<string, Constructor<AutoUpdatedClientObject<any, any>>>,
>(
  defs: T,
  loggers: LoggersType,
  socket: Socket,
  doDebug: boolean = false,
  emitter: EventEmitter3 = new EventEmitter(),
): Promise<WrappedClientInstances<T>> {
  const managers = {} as WrappedClientInstances<T>;

  for (const key in defs) {
    const className = key;
    const classParam = defs[key];
    const manager = new AutoUpdateClientManager(
      classParam,
      className,
      socket as unknown as IDEMSocket,
      loggers,
      managers,
      emitter,
    );
    (managers as any)[key] = manager;
    manager.startSocketListeners();
  }

  const individualStartup = Promise.all(
    Object.entries(managers).map(([key, manager]) => {
      return new Promise<void>((res) => {
        if (!socket || typeof socket.emit !== "function") return res();

        socket.emit(
          EVENT_STARTUP + key,
          null,
          async (response: ServerResponse<any>) => {
            if (response.success && response.data) {
              const data =
                response.data.ids ||
                (Array.isArray(response.data) ? response.data : []);
              await manager.preLoad(data);
            } else if (!response.success) {
              loggers?.error?.(
                "Error starting up " + key + ": " + response.message,
              );
            }
            res();
          },
        );
      });
    }),
  );

  await individualStartup;

  for (const manager of Object.values(managers)) {
    await manager.loadReferences();
  }
<<<<<<< HEAD

=======
  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (i === Object.keys(defs).length) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });

for(const manager of Object.values(managers) as AutoUpdateClientManager<AutoUpdatedClientObject<any>>[]) {
  for(const obj of manager.objectsAsArray){
    obj.loadMissingReferences();
  }
}

  loggers.debug(
    "Loaded data from server for all managers in " +
      (Date.now() - startTime) +
      "ms",
  );
  loggers.info(
    "Loaded all managers in " + (Date.now() - startStartTime) + "ms",
  );
>>>>>>> 105986a8a36b21cfdf5c685f44010c3f9a2aac9d
  return managers;
}

export class AutoUpdateClientManager<
  T extends AutoUpdatedClientObject<T, M>,
  M extends Record<string, any> = Record<string, any>,
> extends AutoUpdateManager<T, M> {
  protected override objects_: Record<string, T> = {};
  public callbacks: DEMClientCallbacks<T>;

  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: IDEMSocket,
    loggers: LoggersType,
    managers: M,
    emitter: EventEmitter3,
    callbacks?: DEMClientCallbacks<T>,
  ) {
    super(classParam, className, socket, loggers, managers, emitter);
    this.callbacks = callbacks || {
      new: () => {},
      update: () => {},
      delete: () => {},
      progress: () => {},
    };
  }

  public async preLoad(data: (IsData<T> | string)[]) {
    const promises = data.map(async (d) => {
      const id = typeof d === "string" ? d : d._id?.toString();
      if (!id) return;
      if (this.objects_[id]) return;

      const obj = new this.classParam(
        this.classParam,
        this.socket,
        d as IsData<T>,
        this.loggers,
        this.className,
        this,
        this.callbacks,
        this.emitter,
      );
      this.objects_[id] = obj;
      globalCache.objects[id] = { className: this.className, object: obj };
      await obj.waitForPreloaded();
    });
    await Promise.all(promises);
    this.isLoaded_ = true;
    this.loggers.info(
      `Created manager [${Object.keys(this.objects_).length}/${data.length}]`,
    );
  }

<<<<<<< HEAD
  public getObject(_id?: string): T | null | undefined {
    if (_id === undefined) return null;
    return this.objects_[_id] || undefined;
=======
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
          this.totalObjects = data.ids.length;
          let i = 0;
          const chunkSize = 100;
          for (let j = 0; j < data.ids.length; j += chunkSize) {
            const chunk = data.ids.slice(j, j + chunkSize);
            await new Promise<void>((resolveBatch, rejectBatch) => {
              this.socket.emit(
                EVENT_GET_BATCH + this.className,
                chunk,
                async (res: ServerResponse<IsData<T>[]>) => {
                  if (!res.success) {
                    this.loggers.error(
                      "Error loading batch from server for manager " +
                        this.className,
                    );
                    this.loggers.error(res.message);
                    rejectBatch(new Error(res.message));
                    return;
                  }

                  for (const objData of res.data) {
                    const id = objData._id;
                    try {
                      this.objects_[id] = new this.classParam(
                        this.classParam,
                        this.socket,
                        objData,
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
                        "Error creating object " +
                          id +
                          " from manager " +
                          this.className +
                          " - " +
                          error.message,
                      );
                    }
                  }

                  const batchPromises = res.data.map(async (objData) => {
                    const id = objData._id;
                    if (!this.objects_[id]) return;
                    try {
                      this.loggers.debug(
                        "Loading object " +
                          id +
                          " from manager " +
                          this.className,
                      );

                      await this.objects_[id].loadMissingReferences();
                      this.loadedObjects += 1;
                      this.loggers.debug(
                        "Loaded object " +
                          id +
                          " from manager " +
                          this.className +
                          " - " +
                          this.loadedObjects +
                          "/" +
                          this.totalObjects,
                      );
                      this.callbacks.progress(
                        this.loadedObjects / this.totalObjects,
                      );
                    } catch (error: any) {
                      this.loggers.error(
                        "Error loading object references " +
                          id +
                          " from manager " +
                          this.className +
                          " - " +
                          error.message,
                      );
                      this.loggers.error(error.stack);
                    }
                    i++;
                  });

                  await Promise.all(batchPromises);
                  resolveBatch();
                },
              );
            });
          }

          this.loggers.info(
            "Loaded " + this.className + " - [" + i + "] entries",
          );
          this.startSocketListeners();

          resolve();
        },
      );
    });
    t ? (t.f = Date.now()) : void 0;
>>>>>>> 105986a8a36b21cfdf5c685f44010c3f9a2aac9d
  }

  public get objects(): Record<string, T> {
    return this.objects_;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_);
  }

  public async handleGetMissingObject(_id: string): Promise<T> {
    if (this.objects_[_id]) return this.objects_[_id];
    return new Promise((resolve, reject) => {
      // console.log("handleGetMissingObject socket check", typeof this.socket?.emit);
      if (!this.socket || typeof this.socket.emit !== "function") {
        return reject(new Error("this.socket.emit is not a function"));
      }
      this.socket.emit(
        "get" + this.className + _id,
        null,
        async (res: ServerResponse<IsData<T>>) => {
          if (res.success && res.data) {
            const dataRec = res.data as any;
            const objId =
              dataRec._id ||
              (Array.isArray(dataRec.ids) && dataRec.ids.length > 0
                ? dataRec.ids[0]
                : undefined) ||
              _id;

            const obj = new this.classParam(
              this.classParam,
              this.socket,
              res.data,
              this.loggers,
              this.className,
              this,
              this.callbacks,
              this.emitter,
            );
            this.objects_[objId] = obj;
            globalCache.objects[objId] = {
              className: this.className,
              object: obj,
            };
            await obj.waitForPreloaded?.();
            try {
                await obj.resolveReferences();
            } catch (e) {
                this.loggers.error(`Error resolving references for missing object ${objId}: ${e}`);
            }
            resolve(obj);
          } else {
            reject(new Error(res.message || "Non existent or not accesable."));
          }
        },
      );
    });
  }

  public async createObject(data: Omit<IsData<T>, "_id">): Promise<T> {
    let obj: T | undefined;
    try {
      obj = new this.classParam(
        this.classParam,
        this.socket,
        data,
        this.loggers,
        this.className,
        this,
        this.callbacks,
        this.emitter,
      );

      await obj.waitForPreloaded?.();

      const id = obj._id?.toString();
      if (id) {
        this.objects_[id] = obj;
        globalCache.objects[id] = { className: this.className, object: obj };
        try {
            await obj.resolveReferences();
        } catch (e) {
            this.loggers.error(`Error resolving references for created object ${id}: ${e}`);
        }
      }
      await this.callbacks.new(obj);
      return obj;
    } catch (error: any) {
      if (obj) (obj as any).destroyImmediate?.();
      this.loggers?.error?.("Error creating object: " + error.message);
      throw error;
    }
  }

  public startSocketListeners() {
    if (!this.socket || typeof this.socket.on !== "function") return;

    this.socket.on(
      EVENT_NEW + this.className,
      async (data: IsData<T> | string) => {
        const id = typeof data === "string" ? data : data._id?.toString();
        if (!id) return;
        if (this.objects_[id]) return;

        const objData = typeof data === "string" ? { _id: id } : data;

        const obj = new this.classParam(
          this.classParam,
          this.socket,
          objData as IsData<T>,
          this.loggers,
          this.className,
          this,
          this.callbacks,
          this.emitter,
        );
        this.objects_[id] = obj;
        globalCache.objects[id] = { className: this.className, object: obj };
        await obj.waitForPreloaded?.();
        try {
            await obj.resolveReferences();
        } catch (e) {
            this.loggers.error(`Error resolving references for new object ${id}: ${e}`);
        }
        await this.callbacks.new(obj);
      },
    );
    this.socket.on(EVENT_DELETE + this.className, async (idStr: string) => {
      await this.deleteObject(idStr);
    });
  }

  public async deleteObject(
    _id: MongoId,
  ): Promise<{ success: boolean; message: string }> {
    const idStr = typeof _id === "string" ? _id : _id.id.toString();
    const obj = this.objects_[idStr];
    if (obj) {
      let res: { success: boolean; message: string } = {
        success: true,
        message: "Deleted",
      };
      if (typeof obj.destroy === "function") {
        res = await obj.destroy(true);
      }
      if (res.success) {
        delete this.objects_[idStr];
        delete globalCache.objects[idStr];
        await this.callbacks.delete(obj);
      }
      return res;
    }
    return { success: true, message: "Already gone" };
  }

  public async loadFromServer() {
    this.loggers?.error?.("loadFromServer property mismatch");
    throw new Error("Property mismatch or not implemented");
  }

  public async close() {
    Object.values(this.objects_).forEach((obj) => obj.destroyImmediate());
    this.objects_ = {};
  }
}
