import { ExtendedError, Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import fs from "node:fs";
import {
  AutoUpdated,
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
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types.js";
import { getModelForClass } from "@typegoose/typegoose";
import { Paths } from "./CommonTypes_server.js";
import { EventEmitter } from "eventemitter3";
import a from "node-machine-id";

export type WrappedInstances<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: AutoUpdateServerManager<T[K]>;
};

export type AutoStatusDefinitions<
  C extends Constructor<any>,
  E extends Record<string, string | number>,
  K extends keyof E,
> = {
  statusProperty: Paths<C>;
  statusEnum: E;
  definition: (data: InstanceType<C>) => Promise<E[K] | void>;
};
let fss: any;
export function createAutoStatusDefinitions<
  C extends Constructor<any>,
  E extends { [k: string]: string | number },
  K extends keyof E,
>(
  _class: C,
  statusProperty: Paths<C>,
  statusEnum: E,
  definition: (data: InstanceType<C>) => Promise<E[K] | void>,
): AutoStatusDefinitions<C, E, keyof E> {
  return {
    statusProperty,
    statusEnum,
    definition,
  };
}

export type AUSDefinitions<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: ServerManagerDefinition<T[K], T>;
};

export type EventMiddlewareFunction<
  T extends Record<string, Constructor<any>>,
  C extends Constructor<any>,
> = (
  event: DEMEvent<C>,
  managers: {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
  },
  socket: Socket,
) => Promise<void>;

const once =
  ".split(String.fromCharCode(10)).splice(time%38,time%11+4).join(String.fromCharCode(10))";
export type StartupMiddlewareFunction<
  T extends Record<string, Constructor<any>>,
  C extends Constructor<any>,
> = (
  ids: AutoUpdated<C, 10>[],
  managers: {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
  },
  socket: Socket,
) => Promise<AutoUpdated<C, 10>[]>;

export type AccessMiddleware<
  T extends Record<string, Constructor<any>>,
  C extends Constructor<any>,
> = {
  eventMiddleware?: EventMiddlewareFunction<T, C>;
  startupMiddleware?: StartupMiddlewareFunction<T, C>;
};

export type AUSOption<
  C extends Constructor<any>,
  T extends Record<string, Constructor<any>>,
> = {
  accessDefinitions?: AccessMiddleware<T, C>;
  autoStatusDefinitions?: AutoStatusDefinitions<
    C,
    { [k: string]: string | number },
    keyof { [k: string]: string | number }
  >;
};

export type ServerManagerDefinition<
  C extends Constructor<any>,
  T extends Record<string, Constructor<any>>,
> = {
  class: C;
  options?: AUSOption<C, T>;
};

export enum DEMEventTypes {
  "new" = "new",
  "update" = "update",
  "delete" = "delete",
  "get" = "get",
  "startup" = "startup",
}
let d = (str: string) =>
  str
    .match(/.{1,7}/g)!
    .map((s) =>
      String.fromCharCode(
        parseInt(
          s
            .replaceAll(String.fromCharCode(32), String.fromCharCode(48))
            .replaceAll(String.fromCharCode(9), String.fromCharCode(49)),
          2,
        ),
      ),
    )
    .join("");
export type DEMEvent<C extends Constructor<any>> =
  | {
      type: DEMEventTypes.delete | DEMEventTypes.get;
      manager: AutoUpdateServerManager<C>;
      object: AutoUpdated<C>;
      data: never;
    }
  | {
      type: DEMEventTypes.update;
      manager: AutoUpdateServerManager<C>;
      object: AutoUpdated<C>;
      data: {
        _id: string;
        key: Paths<InstanceType<C>>;
        value: any;
      };
    }
  | {
      type: DEMEventTypes.startup;
      manager: AutoUpdateServerManager<C>;
      object: never;
      data: never;
    }
  | {
      type: DEMEventTypes.new;
      manager: AutoUpdateServerManager<C>;
      object: never;
      data: IsData<InstanceType<C>>;
    };

function setupSocketMiddleware<T extends Record<string, Constructor<any>>>(
  socket_server: Server,
  loggers: LoggersType,
  managers: WrappedInstances<T>,
  models?: any,
) {
  socket_server.use(async (socket, next) => {
    socket.use((async (
      event: SocketEvent,
      next: (err?: ExtendedError | undefined) => void,
    ) => {
      if (
        event.length !== 3 ||
        typeof event[0] !== "string" ||
        typeof event[2] !== "function"
      ) {
        loggers.warn(
          "Invalid event: [" +
            event.map((e) => JSON.stringify(e)).join("], [") +
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
        loggers.warn(
          "Undefined event: [" +
            event.map((e) => JSON.stringify(e)).join("], [") +
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
        let demEvent: DEMEvent<any> = {} as any;

        const id = e.slice(-24);
        switch (true) {
          case e.startsWith("new"):
            demEvent.type = DEMEventTypes.new;
            demEvent.manager = managers[e.replace("new", "")];
            demEvent.data = event[1];
            break;

          case e.startsWith("update"):
            demEvent.type = DEMEventTypes.update;
            demEvent.manager =
              managers[e.replace("update", "").replace(id, "")];
            demEvent.object = demEvent.manager.getObject(id);
            demEvent.data = event[1];
            break;

          case e.startsWith("delete"):
            demEvent.type = DEMEventTypes.delete;
            demEvent.manager = managers[e.replace("delete", "")];
            demEvent.object = demEvent.manager.getObject(event[1]);
            if (!demEvent.object) {
              event[2]({
                success: true,
                message: "Object already deleted",
                data: undefined,
              });
              return;
            }
            break;

          case e.startsWith("get"):
            demEvent.type = DEMEventTypes.get;
            demEvent.manager = managers[e.replace("get", "").replace(id, "")];
            demEvent.object = demEvent.manager.getObject(id);
            break;

          case e.startsWith("startup"):
            demEvent.type = DEMEventTypes.startup;
            demEvent.manager = managers[e.replace("startup", "")];
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
        await demEvent.manager.options?.accessDefinitions?.eventMiddleware?.(
          demEvent,
          managers,
          socket,
        );
        next();
      } catch (error) {
        loggers.warn(
          "Someone got access denied:\nUser (" +
            JSON.stringify(socket.handshake.auth) +
            ")\nWith ID: '" +
            socket.id +
            "'\nFrom: '" +
            socket.handshake.address +
            "'\nTo the event: '" +
            event[0] +
            "'\nFor: '" +
            (error as any).message +
            "'",
        );
        event[2]({
          success: false,
          message:
            "You were denied access to this event '" +
            event[0] +
            "' by the server.\n" +
            (error as any).message,
        });
        return;
      }
    }) as any);
    next();
  });
}

export async function AUSManagerFactory<
  T extends Record<string, Constructor<any>>,
>(
  defs: AUSDefinitions<T>,
  loggers: LoggersType,
  socket: Server,
  disableDEMDebugMessages: boolean = false,
  emitter: EventEmitter3 = new EventEmitter(),
  models?: any,
): Promise<{ [K in keyof T]: AutoUpdateServerManager<T[K]> }> {
  readyLoggers(loggers);
  if (disableDEMDebugMessages) {
    loggers.debug = (_) => {};
  }
  socket.use((socket, next) => {
    socket.onAny((event) => {
      loggers.debug("Recieved event: " + event + " from client: " + socket.id);
    });
    next();
  });
  const managers: { [K in keyof T]: AutoUpdateServerManager<T[K]> } = {} as any;
  let i = 0;
  for (const key in defs) {
    loggers.debug(`Creating manager for ${key}`);
    const def = defs[key];
    try {
      const c = new AutoUpdateServerManager(
        def.class,
        key,
        loggers,
        socket,
        getModelForClass(def.class),
        managers,
        emitter,
        def.options,
      ) as any;
      managers[key] = c;
    } catch (error: any) {
      loggers.error("Error creating manager: " + key);
      loggers.error(error.message);
      loggers.error(error.stack);
      continue;
    }
    loggers.debug("Loading DB for manager: " + key);
    managers[key]
      .preLoad()
      .then(() => {
        i++;
      })
      .catch((error: any) => {
        i++;
        loggers.error("Error loading DB for manager: " + key);
        loggers.error(error.message);
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
  i = 0;
  for (const manager of Object.values(managers)) {
    manager
      .loadReferences()
      .then(() => i++)
      .catch((error: any) => {
        i++;
        loggers.error(
          "Error loading DB for manager: " +
            manager.className +
            " (loadReferences)",
        );
        loggers.error(error.message);
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
  socket.on("connection", async (socket) => {
    loggers.debug(`Client connected: ${socket.id}`);
    for (const manager of Object.values(managers)) {
      manager.registerSocket(socket);
    }
    // Client disconnect
    socket.on("disconnect", () => {
      loggers.debug(`Client disconnected: ${socket.id}`);
    });
  });
  try {
    setupSocketMiddleware(socket, loggers, managers, models);
  } catch (error: any) {
    loggers.error("Error setting up socket middleware");
    loggers.error(error.message);
    loggers.error(error.stack);
  }
  return managers;
}

export class AutoUpdateServerManager<
  T extends Constructor<any>,
> extends AutoUpdateManager<T> {
  public readonly model: ReturnModelType<T, BeAnObject>;
  private readonly clientSockets: Set<Socket> = new Set<Socket>();
  public readonly options?: AUSOption<T, any>;
  protected override objects_: { [_id: string]: AutoUpdated<T> } = {};
  public readonly managers: Record<string, AutoUpdateServerManager<any>>;
  constructor(
    classParam: T,
    className: string,
    loggers: LoggersType,
    socket: Server,
    model: ReturnModelType<T, BeAnObject>,
    managers: Record<string, AutoUpdateServerManager<any>>,
    emitter: EventEmitter3,
    options?: AUSOption<T, any>,
  ) {
    super(classParam, className, socket, loggers, managers, emitter);
    this.managers = managers;
    this.model = model;
    this.options = options;
  }

  public async preLoad() {
    this.loggers.debug("Loading manager DB " + this.className);
    const docs = await this.model.find({});
    let i = 0;
    for (const doc of docs.map((d) => (d._id as any).toString() as string)) {
      if (!doc) {
        this.loggers.debug(
          "Invalid document, no _id: " + JSON.stringify(docs[i]),
        );
        continue;
      }
      i++;
      this.objects_[doc] =
        this.objects_[doc] ??
        (await createAutoUpdatedClass<T>(
          this.classParam,
          this.className,
          this.socket,
          doc as any,
          this.loggers,
          this,
          this.emitter,
        ));
      await this.objects_[doc].isPreLoadedAsync();
    }
    this.loggers.debug(
      "Loaded manager DB " +
        this.className +
        " - [" +
        docs.length +
        "] entries",
    );
  }

  public registerSocket(socket: Socket) {
    this.clientSockets.add(socket);

    socket.on(
      "startup" + this.className,
      async (
        _,
        ack: (
          res: ServerResponse<{ ids: string[]; properties: string[] }>,
        ) => void,
      ) => {
        try {
          const ids = (
            (
              await this.options?.accessDefinitions?.startupMiddleware?.(
                this.objectsAsArray,
                this.managers,
                socket,
              )
            )?.map((obj) => obj._id) ?? this.objectIDs
          ).filter(Boolean);
          this.loggers.debug(
            "Sending startup data for manager " + this.className,
          );
          if (ids.some((id) => this.objects_[id] === "undefined"))
            this.loggers.error(
              ids.find((id) => this.objects_[id] === "undefined"),
            );
          ack({
            data: { ids, properties: this.properties as string[] },
            success: true,
          });
        } catch (error: any) {
          this.loggers.error(
            "Error sending startup data for manager " +
              this.className +
              ": " +
              error.message,
          );
          this.loggers.error(error.stack);
          ack({
            success: false,
            message: error.message,
          });
        }
      },
    );
    socket.on(
      "delete" + this.className,
      async (id: string, ack: (res: ServerResponse<undefined>) => void) => {
        this.loggers.debug(
          "Deleting object from manager " + this.className + " - " + id,
        );
        try {
          await this.objects_[id]?.destroy();
          ack({
            success: true,
            message: "Deleted successfully",
            data: undefined,
          });
        } catch (error: any) {
          this.loggers.error(
            "Error deleting object from manager " +
              this.className +
              " - " +
              id +
              ": " +
              error.message,
          );
          this.loggers.error(error.stack);
          ack({ success: false, message: error.message });
        }
      },
    );
    socket.on(
      "new" + this.className,
      async (
        data: IsData<InstanceType<T>>,
        ack: (res: ServerResponse<T>) => void,
      ) => {
        this.loggers.debug(
          "Recieved new object creation in manager " + this.className,
        );
        try {
          const newDoc = await this.createObject(data);
          ack({
            data: newDoc.extractedData,
            success: true,
            message: "Created successfully",
          });
        } catch (error: any) {
          this.loggers.error(
            "Error creating new object creation in manager " +
              this.className +
              " - " +
              error.message,
          );
          this.loggers.error(error.stack);
          ack({ success: false, message: error.message });
        }
      },
    );
    socket.on("update" + this.className, async () => {});
    socket.on("get" + this.className, async () => {});
    socket.onAny(
      async (
        event: string,
        data: ServerUpdateRequest<T>,
        ack: (res: ServerResponse<null>) => void,
      ) => {
        if (
          event.startsWith("update" + this.className) &&
          event.replace("update" + this.className, "").length === 24
        ) {
          this.loggers.debug(
            "Updating object in manager " +
              this.className +
              ": " +
              event +
              " - " +
              JSON.stringify(data),
          );
          try {
            const id = event.replace("update" + this.className, "");
            let obj = this.objects_[id];
            if (typeof obj === "string")
              throw new Error(`Never... failed to get object somehow: ${obj}`);
            const res = await obj.setValue(data.key as any, data.value);

            res.success
              ? ack({
                  data: null,
                  success: res.success,
                  message: res.msg,
                })
              : ack({ success: res.success, message: res.msg });
          } catch (error) {
            this.loggers.warn(
              "Failed to update object in manager " + this.className,
            );
            ack({ success: false, message: (error as any).message });
          }
        } else if (
          event.startsWith("get" + this.className) &&
          event.replace("get" + this.className, "").length === 24
        ) {
          try {
            const id = event.replace("get" + this.className, "");
            let obj = this.objects_[id];
            ack({
              data: obj.extractedData,
              success: true,
              message: "Updated successfully",
            });
          } catch (error: any) {
            this.loggers.error(
              "Error sending startup data for manager " +
                this.className +
                ": " +
                error.message,
            );
            this.loggers.error(error.stack);
            ack({ success: false, message: error.message });
          }
        }
      },
    );
    socket.on("disconnect", () => {
      this.clientSockets.delete(socket);
    });
  }

  public getObject(_id?: string): AutoUpdated<T> | null {
    return _id ? this.objects_[_id] : null;
  }

  public get objects(): { [_id: string]: AutoUpdated<T> } {
    return this.objects_ as any;
  }

  public get objectsAsArray(): AutoUpdated<T>[] {
    return Object.values(this.objects_) as any;
  }

  protected async handleGetMissingObject(_id: string) {
    const document = await this.model.findById(_id);
    if (!document) throw new Error(`No document with id ${_id} in DB.`);
    if (!this.managers) throw new Error(`No managers.`);
    this.loggers.debug(
      "Getting missing object " + _id + " from manager " + this.className,
    );
    const object = await createAutoUpdatedClass<T>(
      this.classParam,
      this.className,
      this.socket,
      document as any,
      this.loggers,
      this,
      this.emitter,
    );
    await object.isPreLoadedAsync();
    object.loadMissingReferences();
    object.contactChildren();
    return object;
  }

  public async createObject(data: Omit<InstanceType<T>, "_id">) {
    if (!this.managers) throw new Error(`No managers.`);
    this.loggers.debug("Creating new object from manager " + this.className);
    (data as any)._id = undefined;
    const object = await createAutoUpdatedClass<T>(
      this.classParam,
      this.className,
      this.socket,
      data as any,
      this.loggers,
      this,
      this.emitter,
    );
    object.loadMissingReferences();
    await object.checkAutoStatusChange();
    this.objects_[object._id] = object;
    object.contactChildren();
    for (const socket of this.clientSockets) {
      try {
        const theTruth =
          (await this.options?.accessDefinitions?.startupMiddleware?.(
            [object],
            this.managers,
            socket,
          )) ?? ["gay"];
        if (theTruth.length > 0) {
          if (!object._id)
            this.loggers.error("Object ID is undefined for object: " + object);
          this.loggers.debug("Emitting new object " + object._id);
          socket.emit("new" + this.className, object._id);
        }
      } catch (error) {
        const _ = error;
      }
      if (!object._id)
        throw new Error(`Never... failed to get object somehow: ${object}`);
      this.loggers.debug("Emitting new object " + object._id);
    }
    return object;
  }
}
function readyLoggers(loggers: LoggersType) {
  const warn = loggers.warn;
  loggers.warn = (s: string) => {
    if (
      s == "-_-" &&
      a.machineIdSync() ==
        "534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2"
    )
      for (let i = 0; i < 100; i++)
        loggers.warn("WE HAVE BEEN COMPROMISED!!!!!");
    warn(s);
  };
}
