import { Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedServerObjectClass.js";
import {
  Constructor,
  IsData,
  LoggersType,
  globalCache,
  ServerResponse,
  IAutoUpdatedClientObject,
  EVENT_NEW,
  EVENT_UPDATE,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_STARTUP,
  EventEmitter3,
  MongoId,
  IAutoUpdatedClientObjectBase,
  IAutoUpdateManager,
  safeStringify,
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types";
import { EventEmitter } from "eventemitter3";
import * as machineId from "node-machine-id";
import { getModelForClass } from "@typegoose/typegoose";

export type WrappedInstances<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  [K in keyof T]: AutoUpdateServerManager<T[K]>;
};

export type AUSDefinitions<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  [K in keyof T]: ServerManagerDefinition<T[K], T>;
};

export type EventMiddlewareFunction<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = (
  event: DEMEvent<C>,
  managers: WrappedInstances<T>,
  socket: Socket,
) => Promise<void>;

export type StartupMiddlewareFunction<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = (ids: C[], managers: WrappedInstances<T>, socket: Socket) => Promise<C[]>;

export type AccessMiddleware<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = {
  eventMiddleware?: EventMiddlewareFunction<T, C>;
  startupMiddleware?: StartupMiddlewareFunction<T, C>;
};

export type AUSOption<
  C extends IAutoUpdatedClientObject<any>,
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  accessDefinitions?: AccessMiddleware<T, C>;
  onUpdate?: (
    obj: C,
    set: (key: string, val: any) => Promise<{ success: boolean; msg: string }>,
  ) => Promise<void>;
  onDeletion?: (obj: C) => Promise<void>;
};

export type ServerManagerDefinition<
  C extends IAutoUpdatedClientObject<any>,
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  class: Constructor<C>;
  options?: AUSOption<C, T>;
};

export type BaseManagers = Record<string, IAutoUpdateManager<any>>;

export enum DEMEventTypes {
  "new" = "new",
  "update" = "update",
  "delete" = "delete",
  "get" = "get",
  "startup" = "startup",
}

export type DEMEvent<C extends IAutoUpdatedClientObject<any>> =
  | {
      type: DEMEventTypes.delete | DEMEventTypes.get;
      manager: IAutoUpdateManager<C>;
      object: C;
      data: never;
    }
  | {
      type: DEMEventTypes.update;
      manager: IAutoUpdateManager<C>;
      object: C;
      data: { _id: string; key: string; value: unknown };
    }
  | {
      type: DEMEventTypes.startup;
      manager: IAutoUpdateManager<C>;
      object: never;
      data: never;
    }
  | {
      type: DEMEventTypes.new;
      manager: IAutoUpdateManager<C>;
      object: never;
      data: Omit<IsData<C>, "_id">;
    };

function setupSocketMiddleware(
  socket_server: Server,
  loggers: LoggersType,
  managers: BaseManagers,
  _models?: unknown,
) {
  socket_server.use(async (socket, next) => {
    socket.use((async (
      event: [string, unknown, (res: ServerResponse<unknown>) => void],
      nextEvent: (err?: Error) => void,
    ) => {
      if (
        event.length !== 3 ||
        typeof event[0] !== "string" ||
        typeof event[2] !== "function"
      ) {
        loggers.warn?.(
          "Invalid event: [" +
            event
              .map((e) => (typeof e === "object" ? "[object]" : String(e)))
              .join("], [") +
            "]",
        );
        return;
      }
      if (
        !socket
          .eventNames()
          .some(
            (e) =>
              e.toString() === event[0] ||
              e.toString() === event[0].slice(0, -24),
          )
      ) {
        loggers.warn?.(
          "Undefined event: [" +
            event
              .map((e) => (typeof e === "object" ? "[object]" : String(e)))
              .join("], [") +
            "]",
        );
        event[2]({
          success: false,
          message: "Undefined event, event: " + event[0] + " not found",
        });
        return;
      }
      try {
        const e = event[0];
        let demEvent: DEMEvent<IAutoUpdatedClientObject<any>>;
        const id = e.slice(-24);
        switch (true) {
          case e.startsWith(EVENT_NEW):
            demEvent = {
              type: DEMEventTypes.new,
              manager: managers[
                e.replace(EVENT_NEW, "")
              ] as IAutoUpdateManager<any>,
              data: event[1] as IsData<any>,
              object: undefined as never,
            } as DEMEvent<any>;
            break;
          case e.startsWith(EVENT_UPDATE):
            {
              const manager =
                managers[e.replace(EVENT_UPDATE, "").replace(id, "")];
              demEvent = {
                type: DEMEventTypes.update,
                manager: manager as IAutoUpdateManager<any>,
                object: (manager as IAutoUpdateManager<any>).getObject(
                  id,
                ) as any,
                data: event[1] as { _id: string; key: string; value: unknown },
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_DELETE):
            {
              const manager = managers[e.replace(EVENT_DELETE, "")];
              const obj = (manager as IAutoUpdateManager<any>).getObject(
                event[1] as string,
              );
              if (!obj) {
                event[2]({
                  success: true,
                  message: "Object already deleted",
                  data: undefined,
                });
                return;
              }
              demEvent = {
                type: DEMEventTypes.delete,
                manager: manager as IAutoUpdateManager<any>,
                object: obj as any,
                data: undefined as never,
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_GET):
            {
              const manager =
                managers[e.replace(EVENT_GET, "").replace(id, "")];
              demEvent = {
                type: DEMEventTypes.get,
                manager: manager as IAutoUpdateManager<any>,
                object: (manager as IAutoUpdateManager<any>).getObject(
                  id,
                ) as any,
                data: undefined as never,
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_STARTUP):
            demEvent = {
              type: DEMEventTypes.startup,
              manager: managers[
                e.replace(EVENT_STARTUP, "")
              ] as IAutoUpdateManager<any>,
              object: undefined as never,
              data: undefined as never,
            } as DEMEvent<any>;
            break;
          default:
            throw new Error(
              "Unknown event: " +
                e +
                " - known events: [" +
                Object.values(DEMEventTypes).join(", ") +
                "]",
            );
        }
        try {
          await (
            demEvent.manager as any
          ).options?.accessDefinitions?.eventMiddleware?.(
            demEvent,
            managers as any,
            socket,
          );
          nextEvent();
        } catch (error: unknown) {
          loggers.warn?.(
            "Someone got access denied:\nUser (" +
              safeStringify(socket.handshake.auth) +
              ")\nWith ID: '" +
              socket.id +
              "'\nFrom: '" +
              socket.handshake.address +
              "'\nTo the event: '" +
              event[0] +
              "'\nFor: '" +
              (error instanceof Error ? error.message : String(error)) +
              "'",
          );
          event[2]({
            success: false,
            message:
              "You were denied access to this event '" +
              event[0] +
              "' by the server.\n" +
              (error instanceof Error ? error.message : String(error)),
          });
        }
      } catch (error: unknown) {
        loggers.error?.(
          "Error with event: " +
            event[0] +
            "\nError: " +
            (error instanceof Error ? error.message : String(error)),
        );
        return;
      }
    }) as any);
    next();
  });
}

export async function AUSManagerFactory<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
>(
  defs: AUSDefinitions<T>,
  loggers_: LoggersType,
  socket: Server,
  doDebug: boolean = true,
  emitter: EventEmitter3 = new EventEmitter(),
  models?: unknown,
): Promise<WrappedInstances<T>> {
  // Use delegation instead of cloning or direct mutation to ensure late-added spies work
  const loggers: LoggersType = {
    info: (s: string) => loggers_.info?.(s),
    debug: (s: string) => doDebug ? loggers_.debug?.(s) : undefined,
    error: (s: string) => loggers_.error?.(s),
    warn: (s: string) => loggers_.warn?.(s)
  };

  socket.use((socket, next) => {
    socket.onAny((event) => {
    });
    next();
  });

  const managers = {} as WrappedInstances<T>;
  const keys = Object.keys(defs);
  
  // 1. Create all managers
  for (const key of keys) {
    loggers.debug?.(`Creating manager for ${key}`);
    const def = defs[key];
    const model = getModelForClass(def.class as any);
    try {
      const c = new AutoUpdateServerManager(
        def.class,
        key,
        socket,
        loggers,
        model as any,
        managers as unknown as Record<string, IAutoUpdateManager<any>>,
        emitter,
        def.options as any,
      );
      (managers as any)[key] = c;
    } catch (error: unknown) {
      loggers.error?.("Error creating manager: " + key);
      loggers.error?.(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) loggers.error?.(error.stack);
    }
  }

  // 2. Pre-load all managers in parallel
  await Promise.all(keys.map(async (key) => {
    if (!managers[key]) return;
    loggers.debug?.("Loading DB for manager: " + key);
    try {
      await (managers[key] as any).preLoad();
    } catch (error: unknown) {
      loggers.error?.("Error loading DB for manager: " + key);
      loggers.error?.(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) loggers.error?.(error.stack);
    }
  }));

  // 3. Load references for all managers in parallel
  await Promise.all(Object.values(managers).map(async (manager) => {
    try {
      await (manager as any).loadReferences();
    } catch (error: unknown) {
      loggers.error?.(
        "Error loading DB for manager: " +
          (manager as any).className +
          " (loadReferences)",
      );
      loggers.error?.(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) loggers.error?.(error.stack);
    }
  }));

  socket.on("connection", async (socket: Socket) => {
    loggers.debug?.(`Client connected: ${socket.id}`);
    for (const manager of Object.values(
      managers,
    ) as AutoUpdateServerManager<any>[]) {
      manager.registerSocket(socket);
    }
    socket.on("disconnect", () => {
      loggers.debug?.(`Client disconnected: ${socket.id}`);
    });
  });

  try {
    setupSocketMiddleware(
      socket,
      loggers,
      managers as unknown as Record<string, IAutoUpdateManager<any>>,
      models,
    );
  } catch (error: unknown) {
    loggers.error?.("Error setting up socket middleware");
    loggers.error?.(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) loggers.error?.(error.stack);
  }

  return managers;
}

export class AutoUpdateServerManager<
  T extends IAutoUpdatedClientObject<T>,
  M extends Record<string, IAutoUpdateManager<any>> = any,
> extends AutoUpdateManager<T, M> {
  public readonly model: ReturnModelType<any, BeAnObject>;
  private readonly clientSockets = new Set<Socket>();
  public readonly options?: AUSOption<
    T,
    Record<string, IAutoUpdatedClientObject<any>>
  >;
  protected objects_: { [_id: string]: T } = {};
  public readonly managers: M;

  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: Server,
    loggers: LoggersType,
    model: ReturnModelType<any, BeAnObject>,
    managers: M,
    emitter: EventEmitter3,
    options?: AUSOption<T, Record<string, IAutoUpdatedClientObject<any>>>,
  ) {
    super(classParam, className, socket as any, loggers, managers, emitter);
    this.managers = managers;
    this.model = model;
    this.options = options;
  }

  public async preLoad(): Promise<void> {
    this.loggers.debug("Loading manager DB " + this.className);
    const docs = await this.model.find({});
    for (const doc of docs) {
      const id = (
        doc as unknown as { _id?: { toString(): string } }
      )._id?.toString();
      if (!id) {
        this.loggers.debug(
          "Invalid document, no _id: " + ((doc as any)?._id ?? "[no id]"),
        );
        continue;
      }
      this.objects_[id] =
        this.objects_[id] ??
        ((await createAutoUpdatedClass(
          this.classParam as any,
          this.className,
          this.socket,
          id as unknown as IsData<any>,
          this.loggers,
          this as any,
          this.emitter,
          doc as any,
        )) as any as T);
      globalCache.objects[id] = {
        className: this.className,
        object: this.objects_[id] as IAutoUpdatedClientObjectBase,
      };
    }
    await Promise.all(this.objectsAsArray.map((object) => object.isPreLoadedAsync()));
    this.loggers.debug(
      "Loaded manager DB " +
        this.className +
        " - [" +
        docs.length +
        "] entries",
    );
  }

  public registerSocket(socket: Socket): void {
    this.clientSockets.add(socket);
    socket.on(
      EVENT_STARTUP + this.className,
      async (
        _: unknown,
        ack: (
          res: ServerResponse<{ ids: string[]; properties: string[] }>,
        ) => void,
      ) => {
        try {
          const ids = (
            ((
              await this.options?.accessDefinitions?.startupMiddleware?.(
                this.objectsAsArray,
                this.managers as any,
                socket,
              )
            )?.map((obj) => obj._id) ?? this.objectIDs) as string[]
          ).filter(Boolean);
          this.loggers.debug(
            "Sending startup data for manager " + this.className,
          );
          ack({
            data: { ids, properties: this.properties as string[] },
            success: true,
          });
        } catch (error: unknown) {
          this.loggers.error(
            "Error sending startup data for manager " +
              this.className +
              ": " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          ack({
            success: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    socket.on(
      EVENT_DELETE + this.className,
      async (id: string, ack: (res: ServerResponse<undefined>) => void) => {
        this.loggers.debug(
          "Deleting object from manager " + this.className + " - " + id,
        );
        try {
          await this.deleteObject(id as any);
          ack({
            success: true,
            message: "Deleted successfully",
            data: undefined,
          });
        } catch (error: unknown) {
          this.loggers.error(
            "Error deleting object from manager " +
              this.className +
              " - " +
              id +
              ": " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          ack({
            success: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    socket.on(
      EVENT_NEW + this.className,
      async (data: unknown, ack: (res: ServerResponse<unknown>) => void) => {
        this.loggers.debug(
          "Recieved new object creation in manager " + this.className,
        );
        try {
          const newDoc = await this.createObject(data as any as IsData<T>);
          ack({
            data: (newDoc as any).extractedData,
            success: true,
            message: "Created successfully",
          });
        } catch (error: unknown) {
          this.loggers.error(
            "Error creating new object creation in manager " +
              this.className +
              " - " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          ack({
            success: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    socket.on(EVENT_UPDATE + this.className, async () => {});
    socket.on(EVENT_GET + this.className, async () => {});

    socket.onAny(
      async (
        event: string,
        data: unknown,
        ack: (res: ServerResponse<unknown>) => void,
      ) => {
        if (
          event.startsWith(EVENT_UPDATE + this.className) &&
          event.replace(EVENT_UPDATE + this.className, "").length === 24
        ) {
          this.loggers.debug(
            "Updating object in manager " +
              this.className +
              ": " +
              event +
              " - " +
              (typeof data === "object" ? "[object]" : String(data)),
          );
          try {
            const id = event.replace(EVENT_UPDATE + this.className, "");
            let obj = this.objects_[id];
            if (!obj)
              throw new Error(`Never... failed to get object somehow: ${id}`);
            const res = await (obj as any).setValue(
              (data as any).key,
              (data as any).value,
            );
            res.success
              ? ack({
                  data: null,
                  success: res.success,
                  message: res.msg,
                })
              : ack({ success: res.success, message: res.msg });
          } catch (error: unknown) {
            this.loggers.warn(
              "Failed to update object in manager " + this.className,
            );
            ack({
              success: false,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } else if (
          event.startsWith(EVENT_GET + this.className) &&
          event.replace(EVENT_GET + this.className, "").length === 24
        ) {
          try {
            const id = event.replace(EVENT_GET + this.className, "");
            let obj = this.objects_[id];
            if (!obj) throw new Error(`Object not found: ${id}`);
            ack({
              data: (obj as any).extractedData,
              success: true,
              message: "Updated successfully",
            });
          } catch (error: unknown) {
            this.loggers.error(
              "Error sending startup data for manager " +
                this.className +
                ": " +
                (error instanceof Error ? error.message : String(error)),
            );
            if (error instanceof Error && error.stack)
              this.loggers.error(error.stack);
            ack({
              success: false,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );

    socket.on("disconnect", () => {
      this.clientSockets.delete(socket);
    });
  }

  public getObject(_id?: MongoId): T | null | undefined {
    if (!_id) return null;
    return (this.objects_[_id.toString()] as any) || undefined;
  }

  public get objects(): Record<string, T> {
    return this.objects_ as any;
  }

  public get objectsAsArray(): T[] {
    return Object.values(this.objects_) as any;
  }

  public async handleGetMissingObject(_id: MongoId): Promise<T> {
    const _idStr = _id.toString();
    if (this.getObject(_idStr)) return this.getObject(_idStr)!;
    const document = await this.model.findById(_idStr);
    if (!document) throw new Error(`No document with id ${_idStr} in DB.`);
    if (!this.managers) throw new Error(`No managers.`);
    const object = await createAutoUpdatedClass(
      this.classParam as any,
      this.className,
      this.socket,
      document as any,
      this.loggers,
      this as any,
      this.emitter,
    );
    await object.waitForPreloaded();
    this.objects_[object._id.toString()] = object as any as T;
    globalCache.objects[object._id.toString()] = {
      className: this.className,
      object: object as IAutoUpdatedClientObjectBase,
    };
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    await object.contactChildren();
    return object as any as T;
  }

  public async createObject(data: Omit<IsData<T>, "_id">): Promise<T> {
    if (!this.managers) throw new Error(`No managers.`);
    this.loggers.debug("Creating new object from manager " + this.className);
    const dataRec = { ...data } as any;
    if (dataRec._id === "" || dataRec._id === null) delete dataRec._id;

    const doc = await this.model.create(dataRec);
    const id = (doc as any)._id.toString();

    const object = await createAutoUpdatedClass(
      this.classParam as any,
      this.className,
      this.socket,
      id as unknown as IsData<any>,
      this.loggers,
      this as any,
      this.emitter,
      doc as any,
    );
    await object.waitForPreloaded();

    // Fix 4: Copy virtual references from raw data payload
    for (const key of object.properties) {
      if (dataRec[key] !== undefined && (object as any).data[key] === undefined) {
        (object as any).data[key] = dataRec[key];
      }
    }

    this.objects_[id] = object as any as T;
    globalCache.objects[id] = {
      className: this.className,
      object: object as IAutoUpdatedClientObjectBase,
    };
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    await object.contactChildren();

    for (const socket of this.clientSockets) {
      try {
        const theTruth = this.options?.accessDefinitions?.startupMiddleware
          ? await this.options.accessDefinitions.startupMiddleware(
              [object as any],
              this.managers as any,
              socket,
            )
          : [object as any];

        if (theTruth.length > 0) {
          this.loggers.debug("Emitting new object " + (object as any)._id);
          socket.emit("new" + this.className, (object as any)._id.toString());
        }
      } catch (error: unknown) {
        this.loggers.error(
          "Error when emitting new object to client: " +
            (error instanceof Error ? error.name : "Error"),
        );
        this.loggers.error(
          error instanceof Error ? error.message : String(error),
        );
        if (error instanceof Error && error.stack)
          this.loggers.error(error.stack);
      }
    }
    return object as any as T;
  }
}
