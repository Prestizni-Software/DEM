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
  UnboxConstructor,
  LoggersType,
  EventEmitter3,
  IsData,
  InstanceOf,
  Prev,
} from "./CommonTypes.js";
import { Paths, PathValueOf, UnwrapRef } from "./CommonTypes_server.js";
import { DocumentType } from "@typegoose/typegoose";

type SocketType = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  any
>;

export type AutoUpdated<T, D extends number = 10> = AutoUpdatedServerObject<T> &
  UnwrapRef<UnboxConstructor<T>, Prev[D]>;

export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  className: string,
  socket: SocketType,
  data: IsData<InstanceOf<C>>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<any>,
  emitter: EventEmitter3
): Promise<AutoUpdated<InstanceType<C>>> {
  const instance = new AutoUpdatedServerObject<C>(
    socket,
    data,
    loggers,
    Reflect.getMetadata("props", classParam.prototype) as (keyof C)[],
    className,
    classParam,
    parentManager,
    emitter
  );
  await instance.loadFromDB();
  await instance.isPreLoadedAsync();
  return instance as AutoUpdated<InstanceType<C>>;
}

// ---------------------- Class ----------------------
class AutoUpdatedServerObject<T> extends AutoUpdatedClientObject<T> {
  protected override readonly isServer: boolean = true;
  private entry: DocumentType<InstanceOf<T>>;
  public declare parentManager: AutoUpdateServerManager<any>;

  constructor(
    socket: SocketType,
    data: IsData<T>,
    loggers: LoggersType,
    properties: (keyof T)[],
    className: string,
    classProp: Constructor<T>,
    parentManager: AutoUpdateServerManager<any>,
    emitter: EventEmitter3
  ) {
    super(
      socket as any,
      data,
      loggers,
      properties,
      className,
      classProp,
      parentManager as any,
      emitter,
      true
    );
    this.parentManager = parentManager;
    this.entry = null as any;
  }

  public async loadFromDB() {
    try {
      this.entry = await this.parentManager.managers[
        this.className
      ].model.findOne({
        _id: this.data._id,
      });
      if (!this.entry) {
        this.entry = await this.parentManager.managers[
          this.className
        ].model.create(this.data);
        for (const prop of this.properties) {
          const pointer = getMetadataRecursive(
            "refsTo",
            this.classProp.prototype,
            prop.toString()
          );
          if (!pointer || !this.data[prop]) continue;
          this.data["_id"] = this.entry._id;
          await this.createdWithParent(
            pointer.split(":"),
            (this.data[prop] as any).toString()
          );
        }
      }
      this.data = this.entry.toObject() as any;
    } catch (error: any) {
      this.loggers.error(
        "Error loading object from database: " + error.message
      );
      this.loggers.error(error.stack);
      throw error;
    }
  }

  public async setValue_<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key, val);
  }
  protected handleNewObject(_data: IsData<T>) {
    throw new Error("Cannot create new objects like this.");
  }
  protected async setValueInternal(
    key: any,
    value: any,
    _silent: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    const isRef = getMetadataRecursive("isRef", this.classProp.prototype, key);
    if (isRef)
      value = Array.isArray(value)
        ? value.map((v) => new ObjectId(v as string | ObjectId))
        : new ObjectId(value as string | ObjectId);
    try {
      await this.parentManager.managers[this.className].model.updateOne(
        { _id: this.data._id },
        { $set: { [key]: value } }
      );

      const update = this.makeUpdate(key, value);
      const event = "update" + this.className + this.data._id;
      this.socket.emit(event, update);

      return {
        success: true,
        message: "Updated",
      };
    } catch (error) {
      this.loggers.error("Error saving object: " + (error as Error).message);
      this.loggers.error((error as any).stack);
      return {
        success: false,
        message: "Error saving object: " + (error as Error).message,
      };
    }
  }

  public async destroy(
    once: boolean = false
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
          this.data._id
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

  public override async checkAutoStatusChange() {
    const neededStatus =
      (await this.parentManager.options?.autoStatusDefinitions?.definition(
        this
      )) as any;
    const statusPath = this.parentManager.options?.autoStatusDefinitions
      ?.statusProperty as any;
    if (!neededStatus || !statusPath) return;
    const currentStatus = this.getValue(
      this.parentManager.options?.autoStatusDefinitions?.statusProperty as any
    );
    if (neededStatus === currentStatus) return;
    this.loggers.debug(
      "Status changed - " +
        this.className +
        " - from " +
        currentStatus +
        " to " +
        neededStatus
    );
    await this.setValue(statusPath, neededStatus);
  }
}
