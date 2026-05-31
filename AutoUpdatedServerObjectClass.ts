import { AutoUpdatedClientObject, getMetadataRecursive, processIsRefProperties } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager, BaseManagers } from "./AutoUpdateServerManagerClass.js";
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
  IDEMSocket,
} from "./CommonTypes.js";
import { DocumentType } from "@typegoose/typegoose";

export async function createAutoUpdatedClass<
  C extends AutoUpdatedServerObject<C, any>,
>(
  classParam: Constructor<C>,
  className: string,
  socket: Server,
  data: IsData<C>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<any, any>,
  emitter: EventEmitter3,
  document?: DocumentType<C>,
): Promise<C> {
  const instance = new classParam(
    classParam,
    socket,
    data,
    loggers,
    className,
    parentManager as any,
    emitter,
  );
  if (document) {
    await instance.loadFromDocument(document);
  } else {
    await instance.loadFromDB();
  }
  return instance;
}

// ---------------------- Class ----------------------
export abstract class AutoUpdatedServerObject<
  T extends AutoUpdatedServerObject<T, any>,
  M extends BaseManagers = any,
> extends AutoUpdatedClientObject<T, M> {
  protected override readonly isServer: boolean = true;
  declare protected entry: DocumentType<T>;
  declare public parentManager: AutoUpdateServerManager<T, M>;

  constructor();
  constructor(
    classParam: Constructor<T>,
    socket: Server,
    data: IsData<T>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateServerManager<any, M>,
    emitter: EventEmitter3,
  );
  constructor(
    classParam?: Constructor<T>,
    socket?: Server,
    data?: IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateServerManager<any, M>,
    emitter?: EventEmitter3,
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
        this.entry = undefined as unknown as DocumentType<T>;
        return;
      } else throw new Error("Missing arguments for AutoUpdatedServerObject: " + className);
    }
    super(
      classParam,
      socket as unknown as IDEMSocket,
      data,
      loggers,
      className,
      parentManager as any,
      {
        update: () => {},
        delete: () => {},
        new: () => {},
        progress: () => {},
      },
      emitter,
      true,
    );
    this.parentManager = parentManager;
    this.entry = null as unknown as DocumentType<T>;

    const dataRec = this.data as Record<string, unknown>;
    for (const prop of this.properties) {
      if (typeof prop !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, prop);
      if (isRef && dataRec[prop]) {
        dataRec[prop] = Array.isArray(dataRec[prop])
          ? (dataRec[prop] as unknown[])
              .map((item) =>
                item ? new ObjectId(item.toString()) : null,
              )
              .filter((item): item is ObjectId => item !== null)
          : new ObjectId(dataRec[prop]!.toString());
      }
    }
  }

  public async loadFromDocument(document: DocumentType<T>) {
    this.entry = document;
    this.data = { ...(this.data as any), ...(this.entry.toObject() as any) } as IsData<T>;
    const dataRec = this.data as Record<string, unknown>;
    if (!dataRec["_id"] && (this.entry as any)._id) {
      dataRec["_id"] = (this.entry as any)._id;
    }
    this.generateSettersAndGetters();
    await this.onUpdate();
  }

  public async loadFromDB() {
    try {
      const dataRec = this.data as Record<string, unknown>;
      const id = dataRec["_id"] as MongoId | undefined;
      if (!id) throw new Error("Cannot load from DB: missing _id");

      const manager = (this.parentManager as any).managers[this.className];
      this.entry = (await manager.model.findOne({
        _id: id,
      })) as DocumentType<T>;
      
      if (!this.entry) {
        throw new Error(`Object with ID ${id.toString()} not found in DB.`);
      }
      this.data = { ...(this.data as any), ...(this.entry.toObject() as any) } as IsData<T>;
      if (!dataRec["_id"] && (this.entry as any)._id) {
        dataRec["_id"] = (this.entry as any)._id;
      }
      this.generateSettersAndGetters();
      if (this.data) {
        await this.onUpdate();
      }
    } catch (error: any) {
      this.loggers.error?.("Error loading object from database: " + error.message);
      throw error;
    }
  }

  protected handleNewObject(_data: IsData<T>) {
    throw new Error("Cannot create new objects from server-side instance.");
  }

  public override get extractedData(): { [K in keyof IsData<T>]: IsData<T>[K] } {
      const dataToProcess = this.entry ? this.entry.toObject() : this.data;
      const extracted = processIsRefProperties(dataToProcess as any, this, null, [], {}, this.loggers).newData;
      return extracted as any;
  }

  protected override async setValueInternal(
    key: string,
    value: unknown,
    silent: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    try {
      const dataRec = this.data as Record<string, unknown>;
      const id = dataRec["_id"] as MongoId | undefined;
      if (!id) {
          throw new Error(`Cannot update object ${this.className} - missing _id.`);
      }
      
      const manager = (this.parentManager as any).managers[this.className];
      if (!silent && !noUpdate) {
          await manager.model.updateOne(
            { _id: id },
            { $set: { [key]: value } },
          );
      }

      const update = this.makeUpdate(key, value);
      const event = EVENT_UPDATE + this.className + id.toString();
      this.socket.emit(event, update);

      return {
        success: true,
        msg: "Updated",
      };
    } catch (error) {
      const dataRec = this.data as Record<string, unknown>;
      this.loggers.error?.(`Error saving object [${this.className}: ${dataRec["_id"]?.toString() ?? "not loaded"}]: ` + (error as Error).message);
      return {
        success: false,
        msg: "Error saving object: " + (error as Error).message,
      };
    }
  }

  public async destroy(
    once: boolean = false,
  ): Promise<{ success: boolean; message: string }> {
    const dataRec = this.data as Record<string, unknown>;
    const id = dataRec["_id"] as MongoId | undefined;
    if (!id) return { success: false, message: "Missing _id" };

    if (!once) {
      return await this.parentManager.deleteObject(id);
    }
    try {
      await this.entry.deleteOne({ _id: id });
      this.loggers.debug?.("Deleted object from server " + this.className);
    } catch (error: any) {
      this.loggers.error?.(
        "Error deleting object from database - " +
          this.className +
          " - " +
          id.toString(),
      );
      return {
        success: false,
        message: "Deletion uncussessful: " + error.message,
      };
    }
    this.socket.emit(EVENT_DELETE + this.className, id.toString());
    await this.wipeSelf();
    return {
      success: true,
      message: "Deleted",
    };
  }

  public override async onUpdate(noUpdate: boolean = false) {
    if (noUpdate) return;
    await this.parentManager.options?.onUpdate?.(this as unknown as T, <K extends keyof IsData<T> & string>(key: K, val: PathValueOf<IsData<T>, K>) => {
      return this.setValue(key, val, { silent: false, noGet: true, noUpdate: true });
    });
  }
}
