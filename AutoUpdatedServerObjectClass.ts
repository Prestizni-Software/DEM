import { IObjectWithTypegooseFunction } from "@typegoose/typegoose/lib/types.js";
import { Types, Document } from "mongoose";
import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import {
  AutoProps,
  Constructor,
  CustomFuckingEmitterTypeBecauseExpoIsAFuckingJokeToTheEntireExistenceOfSockets,
  DeRef,
  IsData,
  LoggersType,
  ServerUpdateRequest,
  UnboxConstructor,
} from "./CommonTypes.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { DefaultEventsMap, Server } from "socket.io";

type SocketType = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;

export type AutoUpdated<T extends Constructor<any>> = AutoUpdatedServerObject<T> & UnboxConstructor<T>;

export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: DocWithProps<InstanceType<C>>,
  loggers: LoggersType,
  autoClasser: AutoUpdateServerManager<any>,
  emitter: CustomFuckingEmitterTypeBecauseExpoIsAFuckingJokeToTheEntireExistenceOfSockets
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
    autoClasser,
    emitter
  );
  await instance.isLoadedAsync();
  await instance.checkAutoStatusChange();
  return instance as AutoProps<C> & AutoUpdated<InstanceType<C>> & DeRef<InstanceType<C>>;
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
    emitter: CustomFuckingEmitterTypeBecauseExpoIsAFuckingJokeToTheEntireExistenceOfSockets
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

  protected handleNewObject(_data: IsData<T>) {
    throw new Error("Cannot create new objects like this.");
  }
  protected async setValueInternal(key: string, value: any): Promise<boolean> {
    try {
      await (
        this.autoClasser.classers[this.className] as AutoUpdateServerManager<any>
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

  public override async checkAutoStatusChange() {
      if (!this.autoClasser.options?.autoStatusDefinitions) return;
      const statusPath = this.autoClasser.options.autoStatusDefinitions.statusProperty;
      let finalStatus:
        | keyof typeof this.autoClasser.options.autoStatusDefinitions.statusEnum
        | null = "null";
      for (const [currentStatus, statusDef] of Object.entries(
        this.autoClasser.options.autoStatusDefinitions.definitions
      )) {
        finalStatus = currentStatus;
        for (const [key, value] of Object.entries(statusDef)) {
          if (this.getValue(key as any) !== value) {
            finalStatus = null;
            break;
          }
        }
  
        if (!finalStatus) continue;
        if(this.autoClasser.options.autoStatusDefinitions.statusEnum[finalStatus] === this.getValue(statusPath as any)) break;
        await this.setValue(
          statusPath as any,
          this.autoClasser.options.autoStatusDefinitions.statusEnum[finalStatus] as any
        );
        break;
      }
      if (!finalStatus) 
        throw new Error(`No final status found`);
    }
  
}

export type DocWithProps<T> = Document &
  Omit<T & { _id: Types.ObjectId; __v: number }, "typegooseName"> &
  IObjectWithTypegooseFunction;
