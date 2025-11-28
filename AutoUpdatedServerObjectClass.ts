import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { DefaultEventsMap, Server } from "socket.io";
import {
  Constructor,
  UnboxConstructor,
  LoggersType,
  EventEmitter3,
  IsData,
  ServerUpdateRequest,
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
  socket: SocketType,
  data: DocumentType<InstanceOf<C>>,
  loggers: LoggersType,
  parentClasser: AutoUpdateServerManager<any>,
  emitter: EventEmitter3
): Promise<AutoUpdated<InstanceType<C>>> {
  const instance = new AutoUpdatedServerObject<C>(
    socket,
    data,
    loggers,
    Reflect.getMetadata("props", classParam.prototype) as (keyof C)[],
    classParam.name,
    classParam,
    parentClasser,
    emitter
  );
  await instance.isPreLoadedAsync();
  return instance as AutoUpdated<InstanceType<C>>;
}

// ---------------------- Class ----------------------
export class AutoUpdatedServerObject<T> extends AutoUpdatedClientObject<T> {
  protected readonly isServer: boolean = true;
  private readonly entry: DocumentType<InstanceOf<T>>;
  protected declare parentClasser: AutoUpdateServerManager<any>;

  constructor(
    socket: SocketType,
    data: DocumentType<InstanceOf<T>>,
    loggers: {
      info: (...args: any[]) => void;
      debug: (...args: any[]) => void;
      error: (...args: any[]) => void;
      warn?: (...args: any[]) => void;
    },
    properties: (keyof T)[],
    className: string,
    classProp: Constructor<T>,
    parentClasser: AutoUpdateServerManager<any>,
    emitter: EventEmitter3
  ) {
    super(
      socket as any,
      data.toObject() as any,
      loggers,
      properties,
      className,
      classProp,
      parentClasser as any,
      emitter
    );
    this.parentClasser = parentClasser;
    this.entry = data;
  }

  public setValue_<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>
  ): Promise<{ success: boolean; msg: string }> {
    return this.setValue__(key, val);
  }
  protected handleNewObject(_data: IsData<T>) {
    throw new Error("Cannot create new objects like this.");
  }
  protected async setValueInternal(
    key: string,
    value: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.parentClasser.classers[this.className].model.updateOne(
        { _id: this.data._id },
        { $set: { [key]: value } }
      );

      const update = this.makeUpdate(key, value);
      this.socket.emit("update" + this.className + this.data._id, update);

      return {
        success: true,
        message: "Updated",
      };
    } catch (error) {
      this.loggers.error("Error saving object:", error);
      return {
        success: false,
        message: "Error saving object: " + (error as Error).message,
      };
    }
  }

  public async destroy(once: boolean = false): Promise<void> {
    if (!once) {
      await this.autoClasser.deleteObject(this.data._id);
      return;
    }
    this.socket.emit("delete" + this.className, this.data._id);
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
    }
    this.socket.removeAllListeners("update" + this.className + this.data._id);
    this.socket.removeAllListeners("delete" + this.className + this.data._id);
    this.wipeSelf();
  }

  public override async checkAutoStatusChange() {
    const neededStatus =
      (await this.parentClasser.options?.autoStatusDefinitions?.definition(
        this
      )) as any;
    const statusPath = this.parentClasser.options?.autoStatusDefinitions
      ?.statusProperty as any;
    if (!neededStatus || !statusPath) return;
    this.loggers.debug("Checking auto status change - " + this.className);
    const currentStatus = this.getValue(
      this.parentClasser.options?.autoStatusDefinitions?.statusProperty as any
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
    this.setValue(statusPath, neededStatus);
  }
}
