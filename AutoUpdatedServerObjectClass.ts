import { AutoUpdatedClientObject, getMetadataRecursive, processIsRefProperties } from "./AutoUpdatedClientObjectClass";
import { AutoUpdateServerManager, BaseManagers } from "./AutoUpdateServerManagerClass";
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { Server } from "socket.io";
import {
  Constructor,
  LoggersType,
  EventEmitter3,
  IsData,
  EVENT_DELETE,
  EVENT_UPDATE,
  PathValueOf,
  MongoId,
} from "./CommonTypes";
import { Paths } from "./CommonTypes_server";
import { DocumentType } from "@typegoose/typegoose";

export async function createAutoUpdatedClass<C extends AutoUpdatedServerObject<C>>(
  classParam: Constructor<C>,
  className: string,
  socket: any,
  data: IsData<C>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<any>,
  emitter: EventEmitter3,
  document?: DocumentType<C>
): Promise<C> {
  const instance = new (classParam as any)(
    classParam,
    socket,
    data,
    loggers,
    className,
    parentManager,
    emitter
  );
  if (document) {
    await instance.loadFromDocument(document);
  } else {
    await instance.loadFromDB();
  }
  return instance;
}

export abstract class AutoUpdatedServerObject<T extends AutoUpdatedServerObject<T>> extends AutoUpdatedClientObject<T> {
  protected override readonly isServer: boolean = true;
  protected entry: DocumentType<T>;
  declare public parentManager: AutoUpdateServerManager<any>;

  constructor();
  constructor(
    classParam: Constructor<T>,
    socket: any,
    data: IsData<T>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateServerManager<any>,
    emitter: EventEmitter3
  );
  constructor(
    classParam?: Constructor<T>,
    socket?: any,
    data?: IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateServerManager<any>,
    emitter?: EventEmitter3
  ) {
    if (
      !classParam ||
      !socket ||
      !data ||
      !loggers ||
      !className ||
      !parentManager ||
      !emitter
    ) {
      if (
        !classParam &&
        !socket &&
        !data &&
        !loggers &&
        !className &&
        !parentManager &&
        !emitter
      ) {
        super();
        this.entry = undefined as any;
        return;
      } else throw new Error("Missing arguments???");
    }

    super(
      classParam,
      socket,
      data,
      loggers,
      className,
      parentManager as any,
      {
        update: (x) => { },
        delete: (x) => { },
        new: (x) => { },
        progress: (x) => { },
      },
      emitter,
      true
    );

    for (const prop of this.properties as string[]) {
      if (typeof prop !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, prop);
      if (isRef && (this.data as any)[prop]) {
        (this.data as any)[prop] = Array.isArray((this.data as any)[prop])
          ? (this.data as any)[prop]
            .map((item: any) => item ? new ObjectId(item.toString()) : null)
            .filter(Boolean)
          : new ObjectId((this.data as any)[prop].toString());
      }
    }
    this.parentManager = parentManager as any;
    this.entry = null as any;
  }

  public async loadFromDocument(document: DocumentType<T>) {
    this.entry = document;
    this.data = { ...(this.data as any), ...this.entry.toObject() } as any;
    if (!(this.data as any)._id && (this.entry as any)._id) {
      (this.data as any)._id = (this.entry as any)._id;
    }
    this.generateSettersAndGetters();
  }

  public async loadFromDB(): Promise<void> {
    try {
      const manager = (this.parentManager.managers as any)[this.className];
      this.entry = (await manager.model.findOne({
        _id: (this.data as any)._id,
      })) as DocumentType<T>;

      if (!this.entry) {
        this.entry = (await manager.model.create(this.data)) as DocumentType<T>;
      }
      this.data = { ...(this.data as any), ...this.entry.toObject() } as any;
      if (!(this.data as any)._id && (this.entry as any)._id) {
        (this.data as any)._id = (this.entry as any)._id;
      }
      this.generateSettersAndGetters();
    } catch (error: any) {
      this.loggers.error("Error loading object from database: " + error.message);
      this.loggers.error(error.stack);
      throw error;
    }
  }

  public async setValue_<K extends Paths<T, AutoUpdatedServerObject<T>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key as any, val);
  }

  protected handleNewObject(_data: any): void {
    throw new Error("Cannot create new objects like this.");
  }

  protected override async setValueInternal(
    key: any,
    value: any,
    _silent: boolean = false
  ): Promise<{ success: boolean; msg: string }> {
    try {
      if (!(this.data as any)?._id) {
        throw new Error(`Cannot update object ${this.className} - missing _id. Data: ${JSON.stringify(this.data)}`);
      }
      const manager = (this.parentManager.managers as any)[this.className];
      await manager.model.updateOne({ _id: (this.data as any)._id }, { $set: { [key]: value } });
      const update = this.makeUpdate(key, value);
      const event = EVENT_UPDATE + this.className + (this.data as any)._id.toString();
      this.socket.emit(event, update);
      return {
        success: true,
        msg: "Updated",
      };
    } catch (error: any) {
      this.loggers.error(`Error saving object [${this.className}: ${(this.data as any)?._id ?? "not loaded"}]: ` + error.message);
      this.loggers.error(error.stack);
      return {
        success: false,
        msg: "Error saving object: " + error.message,
      };
    }
  }

  public async destroy(once = false): Promise<{ success: boolean; message: string }> {
    if (!once) {
      return await this.parentManager.deleteObject((this.data as any)._id);
    }
    try {
      const res = await this.entry.deleteOne({ _id: (this.data as any)._id });
      this.loggers.debug("Deleted object from server " + this.className);
      this.loggers.debug(res.deletedCount + " deleted.");
    } catch (error: any) {
      this.loggers.error("Error deleting object from database - " +
        this.className +
        " - " +
        (this.data as any)._id);
      this.loggers.error(error.message);
      this.loggers.error(error.stack);
      return {
        success: false,
        message: "Deletion uncussessful: " + error.message,
      };
    }
    this.socket.emit(EVENT_DELETE + this.className, (this.data as any)._id);
    this.socket.removeAllListeners(EVENT_UPDATE + this.className + (this.data as any)._id.toString());
    this.socket.removeAllListeners(EVENT_DELETE + this.className);
    await this.wipeSelf();
    return {
      success: true,
      message: "Deleted",
    };
  }

  public override async onUpdate(noUpdate = false) {
    if (noUpdate) return;
    await (this.parentManager as any).options?.onUpdate?.(this, (a: any, b: any) => {
      return this.setValue__(a, b, false, true, true);
    });
  }
}
