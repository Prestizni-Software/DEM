import { IObjectWithTypegooseFunction } from "@typegoose/typegoose/lib/types.js";
import { Types, Document } from "mongoose";
import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { DefaultEventsMap, Server } from "socket.io";
import { Constructor, UnboxConstructor, LoggersType, EventEmitter3, AutoProps, IsData, ServerUpdateRequest, InstanceOf } from "./CommonTypes.js";
import { Paths, PathValueOf } from "./CommonTypes_server.js";

type SocketType = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;

export type AutoUpdated<T extends Constructor<any>> = AutoUpdatedServerObject<T> & UnboxConstructor<T>;

export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: DocWithProps<InstanceType<C>>,
  loggers: LoggersType,
  autoClasser: AutoUpdateServerManager<any>,
  emitter: EventEmitter3
): Promise<AutoProps<C> & AutoUpdated<InstanceType<C>> & InstanceType<C>> {
  const instance = new (class extends AutoUpdatedServerObject< 
    InstanceType<C>
  > {})(
    socket,
    data,
    loggers,
    Reflect.getMetadata(
      "props",
      classParam.prototype
    ) as (keyof InstanceType<C>)[],
    classParam.name,
    classParam,
    autoClasser,
    emitter
  );
  await instance.isLoadedAsync();
  await instance.checkAutoStatusChange();
  return instance as AutoProps<C> & AutoUpdated<InstanceType<C>> & InstanceType<C>;
}

// ---------------------- Class ----------------------
export abstract class AutoUpdatedServerObject<
  T extends Constructor<any>
> extends AutoUpdatedClientObject<T> {
  protected readonly isServer: boolean = true;
  private readonly entry: DocWithProps<T>;
  protected override autoClasser: AutoUpdateServerManager<any>;

  constructor(
    socket: SocketType,
    data: DocWithProps<T>,
    loggers: {
      info: (...args: any[]) => void;
      debug: (...args: any[]) => void;
      error: (...args: any[]) => void;
      warn?: (...args: any[]) => void;
    },
    properties: (keyof T)[],
    className: string,
    classProp: Constructor<T>,
    autoClasser: AutoUpdateServerManager<any>,
    emitter: EventEmitter3
  ) {
    super(
      socket as any,
      data.toObject(),
      loggers,
      properties,
      className,
      classProp,
      autoClasser,
      emitter
    );
    this.autoClasser = autoClasser;
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
  protected async setValueInternal(key: string, value: any): Promise<{ success: boolean, message: string }> {
    try {
      await (
        this.autoClasser.classers[this.className] as AutoUpdateServerManager<any>
      ).model.updateOne({ _id: this.data._id }, { $set: { [key]: value } });

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
    const neededStatus = await this.autoClasser.options?.autoStatusDefinitions?.definition(this) as any;
    const statusPath = this.autoClasser.options?.autoStatusDefinitions?.statusProperty as any
    if(!neededStatus || !statusPath) return;
    const currentStatus = this.getValue(this.autoClasser.options?.autoStatusDefinitions?.statusProperty as any)
    if (neededStatus === currentStatus) return;
    this.setValue(statusPath, neededStatus);
  }
  
}

export type DocWithProps<T> = Document &
  Omit<T & { _id: Types.ObjectId; __v: number }, "typegooseName"> &
  IObjectWithTypegooseFunction;
