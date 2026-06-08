import { AutoUpdatedClientObject, getMetadataRecursive, processIsRefProperties } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import { Constructor, IsData, LoggersType, EVENT_UPDATE, EVENT_DELETE, EventEmitter3, IAutoUpdatedClientObject, IAutoUpdatedServerObject, EVENT_INTERNAL_PRE_LOADED, IAutoUpdateManager, ExtractedData } from "./CommonTypes.js";
import { DocumentType } from "@typegoose/typegoose";
import { ObjectId } from "mongodb";

export abstract class AutoUpdatedServerObject<T extends IAutoUpdatedClientObject<T>> extends AutoUpdatedClientObject<T> implements IAutoUpdatedServerObject<T> {
  protected override readonly isServer: boolean;
  protected entry: DocumentType<T> | null;
  declare public parentManager: AutoUpdateServerManager<T, any>;

  constructor();
  constructor(
    classParam: Constructor<T>,
    socket: unknown,
    data: IsData<T>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateServerManager<T, any>,
    emitter: EventEmitter3
  );
  constructor(
    classParam?: Constructor<T>,
    socket?: unknown,
    data?: IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateServerManager<T, any>,
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
      super();
      this.isServer = true;
      this.entry = null;
      this.parentManager = parentManager as unknown as AutoUpdateServerManager<T, any>;
      if (
        !classParam &&
        !socket &&
        !data &&
        !loggers &&
        !className &&
        !parentManager &&
        !emitter
      ) {
        return;
      } else throw new Error("Missing arguments for AutoUpdatedServerObject: " + className);
    }

    super(
      classParam,
      socket as unknown as any,
      data,
      loggers,
      className,
      parentManager as unknown as IAutoUpdateManager<IAutoUpdatedClientObject<any>>,
      {
        update: (_x: IAutoUpdatedClientObject<T>, _key: string) => { },
        delete: (_x: IAutoUpdatedClientObject<T>) => { },
        new: (_x: IAutoUpdatedClientObject<T>) => { },
        progress: (_x: number) => { },
      },
      emitter,
      true
    );

    this.isServer = true;
    this.entry = null;
    this.parentManager = parentManager;

    // Convert reference IDs to ObjectIds on the server side
    const dataRec = this.data as Record<string, unknown>;
    for (const prop of this.properties) {
      if (typeof prop !== "string") continue;
      const isRef = getMetadataRecursive("isRef", this, prop);
      if (isRef && dataRec[prop]) {
        try {
          if (Array.isArray(dataRec[prop])) {
            dataRec[prop] = (dataRec[prop] as any[])
              .map((item) => {
                if (!item) return null;
                const idStr = (item as any)._id ? (item as any)._id.toString() : item.toString();
                return ObjectId.isValid(idStr) ? new ObjectId(idStr) : item;
              })
              .filter((item) => item !== null);
          } else {
            const idStr = (dataRec[prop] as any)._id ? (dataRec[prop] as any)._id.toString() : (dataRec[prop] as any).toString();
            if (ObjectId.isValid(idStr)) {
                dataRec[prop] = new ObjectId(idStr);
            }
          }
        } catch (error: any) {
          this.loggers.error(`Failed to set reference ${prop} to ${dataRec[prop]}: ${error.message}`);
        }
      }
    }
  }

  public async loadFromDB(): Promise<void> {
    const _id = this.data._id;
    if (!_id) throw new Error("No id.");
    
    // Use the model from the parent manager
    this.entry = await this.parentManager.model.findById(_id);
    
    if (!this.entry) throw new Error(`Object not found in DB: ${this.className} with ID ${_id}`);
    
    this.data = { ...(this.data as Record<string, unknown>), ...this.entry.toObject() } as IsData<T>;
    (this as any).isLoading = false;
    this.generateSettersAndGetters();
    this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + (this as any).EmitterID);
    
    await this.onUpdate();
  }

  public async loadFromDocument(document: DocumentType<T>): Promise<void> {
    this.entry = document;
    this.data = { ...(this.data as Record<string, unknown>), ...this.entry.toObject() } as IsData<T>;
    (this as any).isLoading = false;
    this.generateSettersAndGetters();
    this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + (this as any).EmitterID);
  }

  public override get extractedData(): ExtractedData<T, IAutoUpdatedClientObject<any>> {
    const dataToProcess = this.entry ? this.entry.toObject() : this.data;
    const extracted = processIsRefProperties(dataToProcess as any, this, null, [], {}, this.loggers).newData;
    return extracted as any;
  }

  protected override async setValueInternal(
    key: string,
    value: unknown,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    try {
      const _id = this.data._id;
      if (!_id) throw new Error(`Cannot update object ${this.className} - missing _id.`);

      this.entry ??= await this.parentManager.model.findById(_id);
      if (!this.entry) throw new Error("Object not found in DB.");

      if (!silent && !noUpdate) {
        (this.entry as any)[key] = value;
        await this.entry.save();
      }

      const update = this.makeUpdate(key, value);
      const event = EVENT_UPDATE + this.className + _id.toString();
      (this.socket as any).emit(event, update);

      return { success: true, msg: "Success" };
    } catch (error: any) {
      this.loggers.error?.(`Error saving object [${this.className}: ${this.data._id?.toString() ?? "not loaded"}]: ${error.message}`);
      return { success: false, msg: "Error saving object: " + error.message };
    }
  }

  public async destroy(once = false): Promise<{ success: boolean; message: string }> {
    const _id = this.data._id;
    if (!_id) return { success: false, message: "Missing _id" };

    if (!once) {
      return await this.parentManager.deleteObject(_id as any);
    }

    try {
      this.entry ??= await this.parentManager.model.findById(_id);
      if (this.entry) {
          await this.entry.deleteOne();
      }
      this.loggers.debug?.("Deleted object from server " + this.className);
    } catch (error: any) {
      this.loggers.error?.(`Error deleting object from database - ${this.className} - ${_id.toString()}: ${error.message}`);
      return { success: false, message: "Deletion unsuccessful: " + error.message };
    }

    (this.socket as any).emit(EVENT_DELETE + this.className, _id.toString());
    
    await this.wipeSelf();
    return { success: true, message: "Deleted" };
  }

  public override async onUpdate(noUpdate: boolean = false): Promise<void> {
    if (noUpdate) return;
    if (this.parentManager.options?.onUpdate) {
        await this.parentManager.options.onUpdate(this as unknown as T, async (key: string, val: any) => {
            return this.setValue(key as any, val);
        });
    }
  }
}

export async function createAutoUpdatedClass<T extends IAutoUpdatedClientObject<T>>(
  classParam: Constructor<T>,
  className: string,
  socket: unknown,
  data: string | IsData<T>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<T, any>,
  emitter: EventEmitter3,
  document?: DocumentType<T>,
): Promise<IAutoUpdatedServerObject<T>> {
  const obj = new (classParam as any)(
    classParam,
    socket,
    data,
    loggers,
    className,
    parentManager,
    emitter,
  ) as IAutoUpdatedServerObject<T>;
  if (document) {
    await obj.loadFromDocument(document);
  } else {
    await obj.loadFromDB();
  }
  return obj;
}
