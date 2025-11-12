import { Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedServerObjectClass.js";
import {
  Constructor,
  IsData,
  LoggersType,
  Paths,
  PathValueOf,
  ServerResponse,
  ServerUpdateRequest,
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types.js";
import { getModelForClass } from "@typegoose/typegoose";

export type WrappedInstances<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: AutoUpdateServerManager<T[K]>;
};
type AccessDefinitions<C extends Constructor<any>> = {
  [K in Paths<C>]?: {
    access?: string[];
    update?: boolean;
  };
};

export type AutoStatusDefinitions<
  C extends Constructor<any>,
  E extends Record<string, string | number>,
  S extends StatusDefinition<C>
> = {
  statusProperty: Paths<C>;
  statusEnum: E;
  definitions: { [K in keyof E]: S };
};

type StatusDefinition<C extends Constructor<any>> = {
  [K in Paths<C>]?: PathValueOf<C, K>;
};

export function createAutoStatusDefinitions<
  C extends Constructor<any>,
  E extends { [k: string]: string | number },
  S extends StatusDefinition<C>
>(
  _class: C,
  _template: S,
  statusProperty: Paths<C>,
  statusEnum: E,
  definitions: { [K in keyof E]: S }
): AutoStatusDefinitions<C, E, S> {
  return {
    statusProperty,
    statusEnum,
    definitions,
  };
}

export type AUSDefinitions<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: ServerManagerDefinition<T[K]>;
};

export type AUSOption<C extends Constructor<any>> = {
  accessDefinitions?: Partial<AccessDefinitions<C>>;
  autoStatusDefinitions?: AutoStatusDefinitions<
    C,
    { [k: string]: string | number },
    StatusDefinition<C>
  >;
};

export type ServerManagerDefinition<C extends Constructor<any>> = {
  class: C;
  options?: AUSOption<C>;
};

export async function AUSManagerFactory<
  T extends Record<string, Constructor<any>>
>(
  defs: AUSDefinitions<T>,
  loggers: LoggersType,
  socket: Server,
  emitter: EventTarget
): Promise<{ [K in keyof T]: AutoUpdateServerManager<T[K]> }> {
  const classers: any = {};

  let i = 0;
  for (const key in defs) {
    const def = defs[key];
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
    await c.loadDB();
  }
  socket.on("connection", async (socket) => {
    loggers.debug(`Client connected: ${socket.id}`);
    for (const manager of Object.values(classers)) {
      (manager as any).registerSocket(socket);
    }
    // Client disconnect
    socket.on("disconnect", () => {
      loggers.debug(`Client disconnected: ${socket.id}`);
    });
  });
  return classers as WrappedInstances<T>;
}

export class AutoUpdateServerManager<
  T extends Constructor<any>
> extends AutoUpdateManager<T> {
  public readonly model: ReturnModelType<T, BeAnObject>;
  private readonly clientSockets: Set<Socket> = new Set<Socket>();
  public readonly options?: AUSOption<T>;
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Server,
    model: ReturnModelType<T, BeAnObject>,
    classers: Record<string, AutoUpdateManager<any>>,
    emitter: EventTarget,
    options?: AUSOption<T>
  ) {
    super(classParam, socket, loggers, classers, emitter);
    this.model = model;
    this.options = options;
  }

  public async loadDB() {
    const docs = await this.model.find({});
    for (const doc of docs) {
      this.classes[(doc as any)._id] =
        this.classes[(doc as any)._id] ??
        (await this.handleGetMissingObject((doc as any)._id.toString()));
    }
  }

  public registerSocket(socket: Socket) {
    this.clientSockets.add(socket);

    socket.onAny((event: string, data: any) => {
      this.loggers.debug("Client Event", event, data);
    });

    socket.on(
      "startup" + this.className,
      async (ack: (ids: string[]) => void) => {
        const ids: string[] = [];
        ack(this.objectIDs);
      }
    );
    socket.on("delete" + this.className, async (id: string) => {
      this.classes[id].destroy();
      this.classesAsArray.splice(
        this.classesAsArray.indexOf(this.classes[id]),
        1
      );
      delete this.classes[id];
    });
    socket.on(
      "new" + this.className,
      async (
        data: IsData<InstanceType<T>>,
        ack: (res: ServerResponse<T>) => void
      ) => {
        try {
          const newDoc = await this.createObject(data);
          ack({
            data: newDoc.extractedData,
            success: true,
            message: "Created successfully",
          });
        } catch (error) {
          this.loggers.error(error);
          ack({ success: false, message: (error as any).message });
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
          try {
            const id = event.replace("update" + this.className, "");
            let obj = this.classes[id];
            if (typeof obj === "string")
              this.classes[id] = obj = await this.handleGetMissingObject(obj);
            if (typeof obj === "string") throw new Error(`Never...`);
            obj.setValue(data.key as any, data.value);
            ack({
              data: obj.extractedData,
              success: true,
              message: "Updated successfully",
            });
          } catch (error) {
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

  protected async handleGetMissingObject(_id: string) {
    const document = await this.model.findById(_id);
    if (!document) throw new Error(`No document with id ${_id} in DB.`);
    if (!this.classers) throw new Error(`No classers.`);
    return await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      document,
      this.loggers,
      this,
      this.emitter
    );
  }

  public async createObject(data: Omit<IsData<InstanceType<T>>, "_id">) {
    if (!this.classers) throw new Error(`No classers.`);
    (data as any)._id = undefined;
    const entry = await this.model.create(data);
    const object = await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      entry,
      this.loggers,
      this,
      this.emitter
    );
    object.checkAutoStatusChange();
    this.classes[object._id] = object;
    this.classesAsArray.push(object);
    return object;
  }
}
