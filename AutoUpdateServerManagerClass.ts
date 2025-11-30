import { ExtendedError, Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import {
  AutoUpdated,
  createAutoUpdatedClass,
} from "./AutoUpdatedServerObjectClass.js";
import {
  Constructor,
  EventEmitter3,
  InstanceOf,
  IsData,
  LoggersType,
  ServerResponse,
  ServerUpdateRequest,
  SocketEvent,
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types.js";
import { getModelForClass } from "@typegoose/typegoose";
import { Paths } from "./CommonTypes_server.js";
import EventEmitter from "eventemitter3";

export type WrappedInstances<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: AutoUpdateServerManager<T[K]>;
};

export type AutoStatusDefinitions<
  C extends Constructor<any>,
  E extends Record<string, string | number>,
  K extends keyof E
> = {
  statusProperty: Paths<C>;
  statusEnum: E;
  definition: (data: InstanceType<C>) => Promise<E[K] | void>;
};

export function createAutoStatusDefinitions<
  C extends Constructor<any>,
  E extends { [k: string]: string | number },
  K extends keyof E
>(
  _class: C,
  statusProperty: Paths<C>,
  statusEnum: E,
  definition: (data: InstanceType<C>) => Promise<E[K] | void>
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

type AccessMiddleware<
  T extends Record<string, Constructor<any>>,
  C extends Constructor<any>
> = {
  eventMiddleware: (
    event: SocketEvent,
    managers: {
      [K in keyof T]: AutoUpdateServerManager<T[K]>;
    },
    auth: { [key: string]: any }
  ) => Promise<void>;
  startupMiddleware: (
    ids: AutoUpdated<C, 10>[],
    managers: {
      [K in keyof T]: AutoUpdateServerManager<T[K]>;
    },
    auth: { [key: string]: any }
  ) => Promise<AutoUpdated<C, 10>[]>;
};

export type AUSOption<
  C extends Constructor<any>,
  T extends Record<string, Constructor<any>>
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
  T extends Record<string, Constructor<any>>
> = {
  class: C;
  options?: AUSOption<C, T>;
};

function setupSocketMiddleware<T extends Record<string, Constructor<any>>>(
  socket_server: Server,
  loggers: LoggersType,
  managers: WrappedInstances<T>,
  secured?: AccessMiddleware<any, any>
) {
  if (secured) {
    socket_server.use(async (socket, next) => {
      socket.use((async (
        event: SocketEvent,
        next: (err?: ExtendedError | undefined) => void
      ) => {
        if (
          event.length !== 3 ||
          typeof event[0] !== "string" ||
          typeof event[2] !== "function"
        ) {
          loggers.warn(
            "Invalid event: [" +
              event.map((e) => JSON.stringify(e)).join("], [") +
              "]"
          );
          return next(new Error("Invalid event"));
        }
        try {
          await secured.eventMiddleware(
            event as any,
            managers,
            socket.handshake.auth
          );
        } catch (error) {
          loggers.warn(
            "Someone got access denied: (" +
              JSON.stringify(socket.handshake.auth) +
              ")\nWith ID: '" +
              socket.id +
              "'\nFrom: '" +
              socket.handshake.address +
              "'\nTo the event: '" +
              event[0] +
              "'\nFor: '" +
              (error as any).message +
              "'"
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
        next();
      }) as any);
      next();
    });
  }
}

export async function AUSManagerFactory<
  T extends Record<string, Constructor<any>>
>(
  defs: AUSDefinitions<T>,
  loggers: LoggersType,
  socket: Server,
  disableDEMDebugMessages: boolean = false,
  emitter: EventEmitter3 = new EventEmitter()
): Promise<{ [K in keyof T]: T[K] & AutoUpdateServerManager<T[K]> }> {
  if (disableDEMDebugMessages) {
    loggers.debug = (_) => {};
  }
  socket.use((socket, next) => {
    socket.onAny((event) => {
      loggers.debug("Recieved event: " + event + " from client: " + socket.id);
    });
    next();
  });
  const classers: { [K in keyof T]: T[K] & AutoUpdateServerManager<T[K]> } =
    {} as any;
  let i = 0;
  for (const key in defs) {
    loggers.debug(`Creating manager for ${key}`);
    const def = defs[key];
    try {
      const c = new AutoUpdateServerManager(
        def.class,
        loggers,
        socket,
        getModelForClass(def.class),
        classers,
        emitter,
        def.options
      ) as any;
      i++;
      classers[key] = c;
    } catch (error: any) {
      loggers.error("Error creating manager: " + key);
      loggers.error(error.message);
      loggers.error(error.stack);
      continue;
    }
    loggers.debug("Loading DB for manager: " + key);
    try {
      setupSocketMiddleware(
        socket,
        loggers,
        classers,
        def.options?.accessDefinitions
      );
    } catch (error: any) {
      loggers.error("Error setting up socket middleware");
      loggers.error(error.message);
      loggers.error(error.stack);
    }
    try {
      await classers[key].preLoad();
    } catch (error: any) {
      loggers.error("Error loading DB for manager: " + key);
      loggers.error(error.message);
      loggers.error(error.stack);
    }
  }
  for (const manager of Object.values(classers)) {
    await manager.loadReferences();
  }
  socket.on("connection", async (socket) => {
    loggers.debug(`Client connected: ${socket.id}`);
    for (const manager of Object.values(classers)) {
      manager.registerSocket(socket);
    }
    // Client disconnect
    socket.on("disconnect", () => {
      loggers.debug(`Client disconnected: ${socket.id}`);
    });
  });
  return classers;
}

export class AutoUpdateServerManager<
  T extends Constructor<any>
> extends AutoUpdateManager<T> {
  public readonly model: ReturnModelType<T, BeAnObject>;
  private readonly clientSockets: Set<Socket> = new Set<Socket>();
  public readonly options?: AUSOption<T, any>;
  protected override classes: { [_id: string]: AutoUpdated<T> } = {};
  public readonly classers: Record<string, AutoUpdateServerManager<any>>;
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Server,
    model: ReturnModelType<T, BeAnObject>,
    classers: Record<string, AutoUpdateServerManager<any>>,
    emitter: EventEmitter3,
    options?: AUSOption<T, any>
  ) {
    super(classParam, socket, loggers, classers, emitter);
    this.classers = classers;
    this.model = model;
    this.options = options;
  }

  public async preLoad() {
    this.loggers.debug("Loading manager DB " + this.className);
    const docs = await this.model.find({});
    for (const doc of docs.map((d) => (d._id as any).toString() as string)) {
      this.classes[doc] =
        this.classes[doc] ??
        (await createAutoUpdatedClass<T>(
          this.classParam,
          this.socket,
          doc as any,
          this.loggers,
          this,
          this.emitter
        ));
      await this.classes[doc].isPreLoadedAsync();
    }
    this.loggers.debug(
      "Loaded manager DB " + this.className + " - [" + docs.length + "] entries"
    );
  }

  public registerSocket(socket: Socket) {
    this.clientSockets.add(socket);

    socket.on(
      "startup" + this.className,
      async (
        _,
        ack: (
          res: ServerResponse<{ ids: string[]; properties: string[] }>
        ) => void
      ) => {
        try {
          const ids =
            (
              await this.options?.accessDefinitions?.startupMiddleware(
                this.objectsAsArray,
                this.classers,
                socket.handshake.auth
              )
            )?.map((obj) => obj._id) ?? Object.keys(this.classes);
          this.loggers.debug(
            "Sending startup data for manager " + this.className
          );
          ack({
            data: { ids, properties: this.properties as string[] },
            success: true,
          });
        } catch (error: any) {
          ack({
            success: false,
            message: error.message,
          });
        }
      }
    );
    socket.on("delete" + this.className, async (id: string) => {
      this.loggers.debug(
        "Deleting object from manager " + this.className + " - " + id
      );
      try {
        this.classes[id].destroy();
        delete this.classes[id];
      } catch (error: any) {
        this.loggers.error(
          "Error deleting object from manager " +
            this.className +
            " - " +
            id +
            ": " +
            error.message
        );
        this.loggers.error(error.stack);
      }
    });
    socket.on(
      "new" + this.className,
      async (
        data: IsData<InstanceType<T>>,
        ack: (res: ServerResponse<T>) => void
      ) => {
        this.loggers.debug(
          "Emitting new object creation in manager " + this.className
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
            "Error emitting new object creation in manager " +
              this.className +
              " - " +
              error.message
          );
          this.loggers.error(error.stack);
          ack({ success: false, message: error.message });
        }
      }
    );

    socket.onAny(
      async (
        event: string,
        data: ServerUpdateRequest<T>,
        ack: (res: ServerResponse<T>) => void
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
              JSON.stringify(data)
          );
          try {
            const id = event.replace("update" + this.className, "");
            let obj = this.classes[id];
            if (typeof obj === "string")
              this.classes[id] = obj = await this.handleGetMissingObject(obj);
            if (typeof obj === "string")
              throw new Error(`Never... failed to get object somehow: ${obj}`);
            const res = await obj.setValue(data.key as any, data.value);

            res.success
              ? ack({
                  data: obj.extractedData,
                  success: res.success,
                  message: res.msg,
                })
              : ack({ success: res.success, message: res.msg });
          } catch (error) {
            this.loggers.warn(
              "Failed to update object in manager " + this.className
            );
            ack({ success: false, message: (error as any).message });
          }
        } else if (
          event.startsWith("get" + this.className) &&
          event.replace("get" + this.className, "").length === 24
        ) {
          try {
            const id = event.replace("get" + this.className, "");
            let obj = this.classes[id];
            ack({
              data: obj.extractedData,
              success: true,
              message: "Updated successfully",
            });
          } catch (error) {
            ack({ success: false, message: (error as any).message });
          }
        }
      }
    );
    socket.on("disconnect", () => {
      this.clientSockets.delete(socket);
    });
  }

  public getObject(_id: string): AutoUpdated<InstanceOf<T>> | null {
    return this.classes[_id];
  }

  public get objects(): { [_id: string]: AutoUpdated<InstanceOf<T>> } {
    return this.classes as any;
  }

  public get objectsAsArray(): AutoUpdated<InstanceOf<T>>[] {
    return Object.values(this.classes) as any;
  }

  protected async handleGetMissingObject(_id: string) {
    const document = await this.model.findById(_id);
    if (!document) throw new Error(`No document with id ${_id} in DB.`);
    if (!this.classers) throw new Error(`No classers.`);
    this.loggers.debug(
      "Getting missing object " + _id + " from manager " + this.className
    );
    const object = await createAutoUpdatedClass<T>(
      this.classParam,
      this.socket,
      document as any,
      this.loggers,
      this,
      this.emitter
    );
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    return object;
  }

  public async createObject(data: Omit<InstanceType<T>, "_id">) {
    if (!this.classers) throw new Error(`No classers.`);
    this.loggers.debug("Creating new object from manager " + this.className);
    (data as any)._id = undefined;
    const object = await createAutoUpdatedClass<T>(
      this.classParam,
      this.socket,
      data as any,
      this.loggers,
      this,
      this.emitter
    );
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    object.checkAutoStatusChange();
    this.classes[object._id] = object;
    return object;
  }
}
