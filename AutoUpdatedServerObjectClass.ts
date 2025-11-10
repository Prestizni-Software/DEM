import { IObjectWithTypegooseFunction } from "@typegoose/typegoose/lib/types.ts";
import { Types, Document } from "mongoose";
import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.ts";
import {
  AutoProps,
  Constructor,
  DeRef,
  IsData,
  LoggersType,
  ServerUpdateRequest,
  SocketType,
  UnboxConstructor,
} from "./CommonTypes.ts";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.ts";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.ts";
import "reflect-metadata";

export type AutoUpdated<T extends Constructor<any>> = AutoUpdatedServerObject<T> & UnboxConstructor<T>;

export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: DocWithProps<InstanceType<C>>,
  loggers: LoggersType,
  autoClassers: Record<string, AutoUpdateManager<any>>,
  emitter: EventTarget
): Promise<AutoProps<C> & AutoUpdated<InstanceType<C>> & DeRef<InstanceType<C>>> {
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
    autoClassers,
    emitter
  );
  await instance.isLoadedAsync();
  return instance as AutoProps<C> & AutoUpdated<InstanceType<C>> & DeRef<InstanceType<C>>;
}

// ---------------------- Class ----------------------
export abstract class AutoUpdatedServerObject<
  T extends Constructor<any>
> extends AutoUpdatedClientObject<T> {
  protected readonly isServer: boolean = true;
  private readonly entry: DocWithProps<T>;

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
    autoClassers: Record<string, AutoUpdateManager<any>>,
    emitter: EventTarget
  ) {
    super(
      socket,
      data.toObject(),
      loggers,
      properties,
      className,
      classProp,
      autoClassers,
      emitter
    );
    this.entry = data;
    this.socket.emit("new", { id: this.data._id, type: className });
  }

  protected handleNewObject(_data: IsData<T>) {
    throw new Error("Cannot create new objects like this.");
  }
  protected async setValueInternal(key: string, value: any): Promise<boolean> {
    try {
      await (
        this.autoClassers[this.className] as AutoUpdateServerManager<any>
      ).model.updateOne({ _id: this.data._id }, { $set: { [key]: value } });

      const update: ServerUpdateRequest<T> = this.makeUpdate(key, value);
      this.socket.emit("update" + this.className + this.data._id, update);

      return true;
    } catch (error) {
      this.loggers.error("Error saving object:", error);
      return false;
    }
  }

  public async destroy(): Promise<void> {
    this.socket.emit("delete" + this.className, this.data._id);
    await this.entry.deleteOne({ _id: this.data._id });
    this.wipeSelf();
  }
}

export type DocWithProps<T> = Document &
  Omit<T & { _id: Types.ObjectId; __v: number }, "typegooseName"> &
  IObjectWithTypegooseFunction;
