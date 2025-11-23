import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { DefaultEventsMap, Server } from "socket.io";
import {
  Constructor,
  UnboxConstructor,
  LoggersType,
  EventEmitter3,
  AutoProps,
  IsData,
  ServerUpdateRequest,
  InstanceOf,
} from "./CommonTypes.js";
import { Paths, PathValueOf, Unref, UnwrapRef } from "./CommonTypes_server.js";
import { DocumentType } from "@typegoose/typegoose";

type SocketType = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  any
>;

export type AutoUpdated<T extends Constructor<any>> =
  AutoUpdatedServerObject<T> & UnwrapRef<UnboxConstructor<T>>;

export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: DocumentType<C>,
  loggers: LoggersType,
  parentClasser: AutoUpdateServerManager<any>,
  emitter: EventEmitter3
): Promise<
  AutoProps<UnwrapRef<C>> &
    AutoUpdated<InstanceType<C>> &
    UnwrapRef<InstanceType<C>>
> {
  const instance = new (class extends AutoUpdatedServerObject<C> {})(
    socket,
    data,
    loggers,
    Reflect.getMetadata("props", classParam.prototype) as (keyof C)[],
    classParam.name,
    classParam,
    parentClasser,
    emitter
  );
  await instance.isLoadedAsync();
  await instance.checkAutoStatusChange();
  return instance as AutoProps<UnwrapRef<C>> &
    AutoUpdated<InstanceType<C>> &
    UnwrapRef<InstanceType<C>>;
}

// ---------------------- Class ----------------------
export abstract class AutoUpdatedServerObject<
  T extends Constructor<any>
> extends AutoUpdatedClientObject<T> {
  protected readonly isServer: boolean = true;
  private readonly entry: DocumentType<T>;
  protected declare parentClasser: AutoUpdateServerManager<any>;

  constructor(
    socket: SocketType,
    data: DocumentType<T>,
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
    val: Unref<PathValueOf<T, K>>
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

      const update: ServerUpdateRequest<T> = this.makeUpdate(key, value);
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

  public async destroy(): Promise<void> {
    this.socket.emit("delete" + this.className, this.data._id);
    await this.entry.deleteOne({ _id: this.data._id });
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
    const currentStatus = this.getValue(
      this.parentClasser.options?.autoStatusDefinitions?.statusProperty as any
    );
    if (neededStatus === currentStatus) return;
    this.setValue(statusPath, neededStatus);
  }
}
