import {
  AutoUpdatedClientObject,
  getMetadataRecursive,
} from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { DefaultEventsMap, Server } from "socket.io";
import {
  Constructor,
  LoggersType,
  EventEmitter3,
  IsData,
  InstanceOf,
} from "./CommonTypes.js";
import {
  DeAutoUpdateServer,
  Paths,
  PathValueOf,
} from "./CommonTypes_server.js";
import { DocumentType } from "@typegoose/typegoose";

type SocketType = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  any
>;

export async function createAutoUpdatedClass<
  C extends AutoUpdatedServerObject<any>,
>(
  classParam: Constructor<C>,
  className: string,
  socket: SocketType,
  data: IsData<InstanceOf<C>>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<any>,
  emitter: EventEmitter3,
): Promise<C> {
  const instance = new classParam(
    classParam,
    socket,
    data,
    loggers,
    className,
    parentManager,
    emitter,
  );
  await instance.loadFromDB();
  await instance.isPreLoadedAsync();
  return instance;
}

// ---------------------- Class ----------------------
export abstract class AutoUpdatedServerObject<
  T extends AutoUpdatedServerObject<T>,
> extends AutoUpdatedClientObject<T> {
  protected override readonly isServer: boolean = true;
  private entry: DocumentType<InstanceOf<T>>;
  declare public parentManager: AutoUpdateServerManager<any>;

  constructor(
    classParam: Constructor<T>,
    socket: SocketType,
    data: IsData<DeAutoUpdateServer<T>>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateServerManager<any>,
    emitter: EventEmitter3,
  ) {
    super(
      classParam,
      socket as any,
      data as any,
      loggers,
      className,
      parentManager,
      {
        update: (x: any) => {},
        delete: (x: any) => {},
        new: (x: any) => {},
      },
      emitter,
      true,
    );
    for (const prop of this.properties) {
      if (typeof prop !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, prop);
      if (isRef && (this.data as any)[prop]) {
        (this.data as any)[prop] = Array.isArray((this.data as any)[prop])
          ? (this.data as any)[prop]
              .map((item: any) =>
                item ? new ObjectId(item as string | ObjectId) : null,
              )
              .filter(Boolean)
          : (new ObjectId((this.data as any)[prop] as string | ObjectId) as any);
      }
    }
    this.parentManager = parentManager;
    this.entry = null as any;
  }

  public async loadFromDB() {
    try {
      this.entry = (await this.parentManager.managers[
        this.className
      ].model.findOne({
        _id: this.data._id,
      }))!;
      if (!this.entry) {
        this.entry = await this.parentManager.managers[
          this.className
        ].model.create(this.data);
        for (const prop of this.properties) {
          const pointer = getMetadataRecursive("refsTo", this, prop.toString());
          if (!pointer || !(this.data as any)[prop]) continue;
          this.data["_id"] = this.entry._id;
          await this.createdWithParent(
            pointer.split(":"),
            (this.data as any)[prop].toString(),
          );
        }
      }
      this.data = this.entry.toObject() as any;
    } catch (error: any) {
      this.loggers.error(
        "Error loading object from database: " + error.message,
      );
      this.loggers.error(error.stack);
      throw error;
    }
  }

  public async setValue_<K extends Paths<T>>(
    key: K,
    val: PathValueOf<T, K>,
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key, val);
  }
  protected handleNewObject(_data: any) {
    throw new Error("Cannot create new objects like this.");
  }
  protected async setValueInternal(
    key: any,
    value: any,
    _silent: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    try {
      await this.parentManager.managers[this.className].model.updateOne(
        { _id: this.data._id },
        { $set: { [key]: value } },
      );

      const update = this.makeUpdate(key, value);
      const event = "update" + this.className + this.data._id;
      this.socket.emit(event, update);

      return {
        success: true,
        msg: "Updated",
      };
    } catch (error) {
      this.loggers.error("Error saving object: " + (error as Error).message);
      this.loggers.error((error as any).stack);
      return {
        success: false,
        msg: "Error saving object: " + (error as Error).message,
      };
    }
  }

  public async destroy(
    once: boolean = false,
  ): Promise<{ success: boolean; message: string }> {
    if (!once) {
      return await this.parentManager.deleteObject(this.data._id);
    }
    try {
      const res = await this.entry.deleteOne({ _id: this.data._id });
      this.loggers.debug("Deleted object from server " + this.className);
      this.loggers.debug(res.deletedCount + " deleted.");
    } catch (error: any) {
      this.loggers.error(
        "Error deleting object from database - " +
          this.className +
          " - " +
          this.data._id,
      );
      this.loggers.error(error.message);
      this.loggers.error(error.stack);
      return {
        success: false,
        message: "Deletion uncussessful: " + error.message,
      };
    }
    this.socket.emit("delete" + this.className, this.data._id);
    this.socket.removeAllListeners("update" + this.className + this.data._id);
    this.socket.removeAllListeners("delete" + this.className);
    this.wipeSelf();
    return {
      success: true,
      message: "Deleted",
    };
  }

  public override async onUpdate(noUpdate: boolean = false) {
    if (noUpdate) return;
    await this.parentManager.options?.onUpdate?.(this, (a: any, b: any) => {
      return this.setValue__(a, b, false, true, true);
    });
  }
}
