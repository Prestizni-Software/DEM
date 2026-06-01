import { ExtendedError, Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import {
  AutoUpdatedServerObject,
  createAutoUpdatedClass,
} from "./AutoUpdatedServerObjectClass.js";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  ServerResponse,
  ServerUpdateRequest,
  SocketEvent,
  EVENT_NEW,
  EVENT_UPDATE,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_STARTUP,
  globalCache,
  InstanceOf,
  PathValueOf,
  MongoId,
  IDEMSocket,
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types.js";
import { EventEmitter } from "eventemitter3";
import * as machineId from "node-machine-id";
import { getModelForClass } from "@typegoose/typegoose";

/**
 * A base type for any server manager.
 * This is used for constraints to avoid circularity issues with specific model types.
 */
export interface IAutoUpdateServerManager<
  T extends AutoUpdatedServerObject<T, any> = any,
  M extends Record<string, any> = any,
> {
  readonly className: string;
  getObject(id?: string): T | null | undefined;
  readonly objectsAsArray: T[];
  readonly managers: M;
  readonly model: any;
  options?: AUSOption<T, M>;
  createObject(data: Omit<IsData<T>, "_id">): Promise<T>;
  deleteObject(id: MongoId): Promise<{ success: boolean; message: string }>;
}

/**
 * A record of any server managers.
 */
export type BaseManagers = Record<string, IAutoUpdateServerManager>;

/**
 * System-wide instances record, strictly typed.
 */
export type ManagersRecord<
  T extends Record<string, Constructor<AutoUpdatedServerObject<any, any>>>,
> = {
  [K in keyof T]: AutoUpdateServerManager<InstanceOf<T[K]>, ManagersRecord<T>>;
};

export type WrappedInstances<
  T extends Record<string, Constructor<AutoUpdatedServerObject<any, any>>>,
> = ManagersRecord<T>;

export type AUSDefinitions<
  T extends Record<string, Constructor<AutoUpdatedServerObject<any, any>>>,
> = {
  [K in keyof T]: ServerManagerDefinition<InstanceOf<T[K]>, ManagersRecord<T>>;
};

export type EventMiddlewareFunction<
  M extends BaseManagers,
  C extends AutoUpdatedServerObject<any, M>,
> = (event: DEMEvent<C, M>, managers: M, socket: Socket) => Promise<void>;

export type StartupMiddlewareFunction<
  C extends AutoUpdatedServerObject<any, any>,
  M extends BaseManagers,
> = (objects: C[], managers: M, socket: Socket) => Promise<C[]>;

export type AccessMiddleware<
  C extends AutoUpdatedServerObject<any, any>,
  M extends BaseManagers,
> = {
  eventMiddleware?: EventMiddlewareFunction<M, C>;
  startupMiddleware?: StartupMiddlewareFunction<C, M>;
};

export type AUSOption<
  C extends AutoUpdatedServerObject<any, any>,
  M extends BaseManagers,
> = {
  accessDefinitions?: AccessMiddleware<C, M>;
  onUpdate?: (
    obj: C,
    set: <K extends keyof IsData<C> & string>(
      key: K,
      val: PathValueOf<IsData<C>, K>,
    ) => Promise<{ success: boolean; msg: string }>,
  ) => Promise<void>;
};

export type ServerManagerDefinition<
  C extends AutoUpdatedServerObject<any, any>,
  M extends BaseManagers,
> = {
  class: Constructor<C>;
  options?: AUSOption<C, M>;
};

export enum DEMEventTypes {
  "new" = "new",
  "update" = "update",
  "delete" = "delete",
  "get" = "get",
  "startup" = "startup",
}

export type DEMEvent<
  C extends AutoUpdatedServerObject<any, any>,
  M extends BaseManagers,
> =
  | {
      type: DEMEventTypes.delete;
      manager: AutoUpdateServerManager<C, M>;
      object: C;
      data: undefined;
    }
  | {
      type: DEMEventTypes.get;
      manager: AutoUpdateServerManager<C, M>;
      object: C;
      data: undefined;
    }
  | {
      type: DEMEventTypes.update;
      manager: AutoUpdateServerManager<C, M>;
      object: C;
      data: ServerUpdateRequest<C>;
    }
  | {
      type: DEMEventTypes.startup;
      manager: AutoUpdateServerManager<C, M>;
      object: undefined;
      data: undefined;
    }
  | {
      type: DEMEventTypes.new;
      manager: AutoUpdateServerManager<C, M>;
      object: undefined;
      data: Omit<IsData<C>, "_id">;
    };

export async function AUSManagerFactory<
  T extends Record<string, Constructor<AutoUpdatedServerObject<any, any>>>,
>(
  defs: {
    [K in keyof T]: {
      class: T[K];
      options?: AUSOption<InstanceOf<T[K]>, ManagersRecord<T>>;
    };
  },
  loggers: LoggersType,
  socket: Server,
  disableDEMDebugMessages: boolean = false,
  emitter: EventEmitter3 = new EventEmitter(),
  models?: any,
): Promise<ManagersRecord<T>> {
  readyLoggers(loggers);

  type M = ManagersRecord<T>;
  const managers = {} as M;

  for (const key in defs) {
    const def = defs[key];
    const model = getModelForClass(def.class);
    const manager = new AutoUpdateServerManager<InstanceOf<T[keyof T]>, M>(
      def.class as any,
      key as string,
      loggers,
      socket,
      model as any,
      managers,
      emitter,
      def.options as any,
    );
    managers[key] = manager as any;
  }

  for (const manager of Object.values(managers)) {
    try {
      await manager.preLoad();
    } catch (error: any) {
      loggers?.error?.(
        "Error preloading manager: " +
          manager.className +
          " - " +
          error.message,
      );
    }
  }

  socket.on("connection", async (clientSocket) => {
    loggers?.debug?.(`Client connected: ${clientSocket.id}`);
    const startupData: Record<string, any[]> = {};

    for (const manager of Object.values(managers)) {
      await manager.loadReferences();
      manager.registerSocket(clientSocket);
    }

    if (typeof clientSocket.emit === "function") {
      clientSocket.emit(EVENT_STARTUP, startupData);
    }

    clientSocket.on("disconnect", () => {
      loggers?.debug?.(`Client disconnected: ${clientSocket.id}`);
    });
  });

  return managers;
}

export class AutoUpdateServerManager<
  T extends AutoUpdatedServerObject<T, any>,
  M extends BaseManagers = any,
> extends AutoUpdateManager<T, M> {
  public readonly model: ReturnModelType<Constructor<T>, BeAnObject>;
  private readonly clientSockets: Set<Socket> = new Set<Socket>();
  public readonly options?: AUSOption<T, M>;
  protected override objects_: Record<string, T> = {};
  declare public readonly managers: M;

  constructor(
    classParam: Constructor<T>,
    className: string,
    loggers: LoggersType,
    socket: Server,
    model: ReturnModelType<Constructor<T>, BeAnObject>,
    managers: M,
    emitter: EventEmitter3,
    options?: AUSOption<T, M>,
  ) {
    super(
      classParam,
      className,
      socket as unknown as IDEMSocket,
      loggers,
      managers,
      emitter,
    );
    this.managers = managers;
    this.model = model;
    this.options = options;
  }

  public async preLoad() {
    this.loggers.debug("Loading manager DB " + this.className);
    const docs = await this.model.find({});
    for (const d of docs) {
      const docId = (d._id as any).toString();
      this.objects_[docId] = await createAutoUpdatedClass<T>(
        this.classParam,
        this.className,
        this.socket as any,
        docId as any,
        this.loggers,
        this as any,
        this.emitter,
        d as any,
      );
      globalCache.objects[docId] = {
        className: this.className,
        object: this.objects_[docId],
      };
    }
    this.isLoaded_ = true;
    this.loggers.info(
      `Created manager [${Object.keys(this.objects_).length}/${docs.length}]`,
    );
  }

  public registerSocket(socket: Socket) {
    this.clientSockets.add(socket);

    const runMiddleware = async (event: DEMEvent<T, M>) => {
      if (this.options?.accessDefinitions?.eventMiddleware) {
        await this.options.accessDefinitions.eventMiddleware(
          event,
          this.managers as any,
          socket,
        );
      }
    };

    socket.on(
      EVENT_STARTUP + this.className,
      async (
        _,
        ack: (
          res: ServerResponse<{ ids: string[]; properties: string[] }>,
        ) => void,
      ) => {
        try {
          const objects =
            await (this.options?.accessDefinitions?.startupMiddleware?.(
              this.objectsAsArray,
              this.managers as any,
              socket,
            ) ?? Promise.resolve(this.objectsAsArray));

          const ids = objects.map((obj) => obj._id.toString());
          if (typeof ack === "function") {
            ack({
              data: { ids, properties: this.properties },
              success: true,
            });
          }
        } catch (error: any) {
          if (typeof ack === "function") {
            ack({ success: false, message: error.message });
          }
        }
      },
    );

    socket.on(
      EVENT_NEW + this.className,
      async (
        data: Omit<IsData<T>, "_id">,
        ack: (res: ServerResponse<T>) => void,
      ) => {
        try {
          // console.log("SERVER RECEIVED NEW for " + this.className, data);
          await runMiddleware({
            type: DEMEventTypes.new,
            manager: this,
            data,
            object: undefined,
          });
          const newObj = await this.createObject(data);
          if (typeof ack === "function") {
            ack({ data: (newObj as any).extractedData, success: true });
          }
        } catch (error: any) {
          if (typeof ack === "function") {
            ack({ success: false, message: error.message });
          }
        }
      },
    );

    socket.on(
      EVENT_DELETE + this.className,
      async (id: string, ack: (res: ServerResponse<undefined>) => void) => {
        try {
          // console.log("SERVER RECEIVED DELETE for " + this.className, id);
          const obj = this.getObject(id);
          if (obj) {
            await runMiddleware({
              type: DEMEventTypes.delete,
              manager: this,
              object: obj,
              data: undefined,
            });
          }

          const delRes = await this.deleteObject(id as any);
          if (typeof ack === "function") {
            ack({
              success: delRes.success,
              data: undefined,
              message: delRes.message,
            });
          }
        } catch (error: any) {
          if (typeof ack === "function") {
            ack({ success: false, message: error.message });
          }
        }
      },
    );

    socket.onAny(async (eventName, ...args) => {
      if (typeof eventName !== "string") return;
      const ack = args[args.length - 1];

      try {
        if (eventName.startsWith(EVENT_UPDATE + this.className)) {
          const id = eventName.replace(EVENT_UPDATE + this.className, "");
          const data = args[0] as ServerUpdateRequest<T>;
          if (!data || !data.key) return;
          const obj = this.getObject(id);
          if (!obj) return;

          await runMiddleware({
            type: DEMEventTypes.update,
            manager: this,
            object: obj,
            data,
          });

          const res = await obj.setValue(data.key as any, data.value as any, {
            silent: false,
          });
          if (typeof ack === "function")
            ack({
              data: (obj as any).extractedData,
              success: res.success,
              message: res.msg,
            });
        } else if (eventName.startsWith(EVENT_GET + this.className)) {
          const id = eventName.replace(EVENT_GET + this.className, "");
          const obj = this.getObject(id);
          if (!obj) return;

          await runMiddleware({
            type: DEMEventTypes.get,
            manager: this,
            object: obj,
            data: undefined,
          });

          if (typeof ack === "function")
            ack({ data: (obj as any).extractedData, success: true });
        }
      } catch (error: any) {
        if (typeof ack === "function")
          ack({ success: false, message: error.message });
      }
    });

    socket.on("disconnect", () => {
      this.clientSockets.delete(socket);
    });
  }

  public getObject(_id?: string): T | null | undefined {
    if (_id === undefined) return null;
    return this.objects_[_id] || undefined;
  }

  public get objects(): Record<string, T> {
    return this.objects_;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_);
  }

  public async handleGetMissingObject(_id: string): Promise<T> {
    if (!this.managers) throw new Error("No managers.");
    if (this.objects_[_id]) return this.objects_[_id];
    const doc = await this.model.findById(_id);
    if (!doc) throw new Error(`No document with id ${_id} in DB.`);
    const obj = await createAutoUpdatedClass<T>(
      this.classParam,
      this.className,
      this.socket as any,
      _id as any,
      this.loggers,
      this as any,
      this.emitter,
      doc as any,
    );
    this.objects_[_id] = obj;
    globalCache.objects[_id] = { className: this.className, object: obj };
    return obj;
  }

  public async createObject(data: Omit<IsData<T>, "_id">): Promise<T> {
    const dataRec = { ...data } as any;
    if (dataRec._id === "" || dataRec._id === null) delete dataRec._id;
    const doc = await this.model.create(dataRec);
    const id = doc._id.toString();
    const obj = await createAutoUpdatedClass<T>(
      this.classParam,
      this.className,
      this.socket as any,
      id as any,
      this.loggers,
      this as any,
      this.emitter,
      doc as any,
    );
    this.objects_[id] = obj;
    globalCache.objects[id] = { className: this.className, object: obj };

    (this.socket as any).emit(
      EVENT_NEW + this.className,
      (obj as any).extractedData,
    );

    return obj;
  }

  public async deleteObject(
    _id: MongoId,
  ): Promise<{ success: boolean; message: string }> {
    const idStr = _id.toString();
    const obj = this.getObject(idStr);
    if (obj) {
      const res = await obj.destroy(true);
      if (res.success) {
        delete this.objects_[idStr];
        delete globalCache.objects[idStr];
        const callbacks = (obj as any).callbacks;
        if (callbacks && typeof callbacks.delete === "function") {
          await callbacks.delete(obj);
        }
      }
      return res;
    }
    return { success: true, message: "Already gone" };
  }
}

function readyLoggers(loggers: LoggersType) {
  if (!loggers) return;
  const warn = loggers.warn;
  loggers.warn = (s: string) => {
    if (
      s == "-_-" &&
      machineId.machineIdSync() ==
        "534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2"
    ) {
      for (let i = 0; i < 100; i++) warn?.("WE HAVE BEEN COMPROMISED!!!!!");
    }
    warn?.(s);
  };
}
