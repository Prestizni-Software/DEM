import _ from "lodash";
import {
  AutoUpdatedClientObject,
  getMetadataRecursive,
  processIsRefProperties,
} from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import {
  Constructor,
  IsData,
  LoggersType,
  EVENT_UPDATE,
  EVENT_DELETE,
  EventEmitter3,
  IAutoUpdatedClientObject,
  IAutoUpdatedServerObject,
  EVENT_INTERNAL_PRE_LOADED,
  IAutoUpdateManager,
  ExtractedData,
} from "./CommonTypes.js";
import { DocumentType } from "@typegoose/typegoose";
import { ObjectId } from "mongodb";

export abstract class AutoUpdatedServerObject<
  T extends IAutoUpdatedClientObject<T>,
>
  extends AutoUpdatedClientObject<T>
  implements IAutoUpdatedServerObject<T>
{
  protected override readonly isServer: boolean;
  protected entry: DocumentType<T> | null;
  declare public parentManager: AutoUpdateServerManager<T, any>;
  private saveLock: Promise<any> = Promise.resolve();
  private loadPromise: Promise<void> | null = null;
  private _isUpdating: boolean = false;

  constructor();
  constructor(
    classParam: Constructor<T>,
    socket: unknown,
    data: IsData<T>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateServerManager<T, any>,
    emitter: EventEmitter3,
  );
  constructor(
    classParam?: Constructor<T>,
    socket?: unknown,
    data?: IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateServerManager<T, any>,
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
      super();
      this.isServer = true;
      this.entry = null;
      this.parentManager = parentManager as unknown as AutoUpdateServerManager<
        T,
        any
      >;
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
      } else
        throw new Error(
          "Missing arguments for AutoUpdatedServerObject: " + className,
        );
    }

    super(
      classParam,
      socket as unknown as any,
      data,
      loggers,
      className,
      parentManager as unknown as IAutoUpdateManager<
        IAutoUpdatedClientObject<any>
      >,
      {
        update: (_x: IAutoUpdatedClientObject<T>, _key: string) => {},
        delete: (_x: IAutoUpdatedClientObject<T>) => {},
        new: (_x: IAutoUpdatedClientObject<T>) => {},
        progress: (_x: number) => {},
      },
      emitter,
      true,
    );

    this.isServer = true;
    this.entry = null;
    this.parentManager = parentManager;

    // Cache refProps statically on constructor
    const classParamAny = classParam as any;
    if (!classParamAny.__refPropsCache) {
      classParamAny.__refPropsCache = this.properties.filter((prop) =>
        getMetadataRecursive("isRef", this, prop),
      );
    }

    // Convert reference IDs to ObjectIds on the server side in-place
    const dataRec = this.data as Record<string, unknown>;
    if (dataRec && typeof dataRec === "object") {
      for (const prop of classParamAny.__refPropsCache) {
        const val = dataRec[prop];
        if (!val) continue;
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            const item = val[i];
            if (item && !(item instanceof ObjectId)) {
              const idStr = (item as any)._id ? (item as any)._id.toString() : item.toString();
              if (idStr !== {}.toString() && ObjectId.isValid(idStr)) {
                val[i] = new ObjectId(idStr);
              }
            }
          }
        } else if (!(val instanceof ObjectId)) {
          const idStr = (val as any)._id ? (val as any)._id.toString() : (val as any).toString();
          if (idStr !== {}.toString() && ObjectId.isValid(idStr)) {
            dataRec[prop] = new ObjectId(idStr);
          }
        }
      }
    }
  }

  public async save(): Promise<void> {
    this.saveLock = (this.saveLock ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.entry && (this.entry as any) !== this) {
          await this.entry.save();
        } else if (this.entry && typeof (this.entry as any).$__save === "function") {
          await (this.entry as any).$__save();
        }
      });
    await this.saveLock;
  }

  public async loadFromDB(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const _id = this.data._id;
      if (!_id) throw new Error("No id.");

      // Use the model from the parent manager
      this.entry = await this.parentManager.model.findById(_id);

      if (!this.entry)
        throw new Error(
          `Object not found in DB: ${this.className} with ID ${_id}`,
        );

      const docObj = typeof (this.entry as any).toObject === "function" ? (this.entry as any).toObject() : this.entry;
      this.data = this.handleDataCleanup(docObj);
      this.isLoading = false;
      this.generateSettersAndGetters();
      this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
    })();
    return this.loadPromise;
  }

  public loadFromDocument(document: DocumentType<T>): void {
    this.entry = document;
    const docObj = typeof (document as any).toObject === "function" ? (document as any).toObject() : document;
    this.data = this.handleDataCleanup(docObj);
    this.isLoading = false;
    this.generateSettersAndGetters();
    this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
  }

  private _cachedExtractedData: ExtractedData<
    T,
    IAutoUpdatedClientObject<any>
  > | null = null;

  public override handleDataCleanup(data: IsData<T>): IsData<T> {
    this._cachedExtractedData = null;
    return super.handleDataCleanup(data);
  }

  /** Override extractedData to return processed copy with cache */
  public override get extractedData(): ExtractedData<
    T,
    IAutoUpdatedClientObject<any>
  > {
    if (this._cachedExtractedData) return this._cachedExtractedData;
    const extracted = processIsRefProperties(
      this.data as any,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData as ExtractedData<T, IAutoUpdatedClientObject<any>>;
    this._cachedExtractedData = extracted;
    return extracted;
  }

  protected override async setValueInternal(
    key: string,
    value: unknown,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      return { success: false, msg: `Invalid property key: ${key}` };
    }

    try {
      const _id = this.data._id;
      if (!_id)
        throw new Error(
          `Cannot update object ${this.className} - missing _id.`,
        );

      this.entry ??= await this.parentManager.model.findById(_id);
      if (!this.entry) throw new Error("Object not found in DB.");

      // Check if property is part of properties or schema, regardless of current undefined value
      const isPersisted =
        this.properties.includes(key) ||
        (this.entry as any)[key] !== undefined ||
        Boolean((this.entry.schema as any)?.path?.(key));

      if (isPersisted) {
        this.saveLock = (this.saveLock ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            if (typeof this.parentManager.model?.updateOne === "function") {
              await this.parentManager.model.updateOne(
                { _id },
                { $set: { [key]: value } },
              );
            } else if (this.entry && typeof (this.entry as any).save === "function") {
              await (this.entry as any).save();
            }
            if (this.entry) {
              (this.entry as any)[key] = value;
            }
          });
        await this.saveLock;
      }

      this._cachedExtractedData = null;
      if (!silent) {
        const update = this.makeUpdate(key, value);
        const event = EVENT_UPDATE + this.className + _id.toString();
        (this.socket as any).emit(event, update);
      }

      return { success: true, msg: "Success" };
    } catch (error: any) {
      this.loggers.error?.(
        `Error saving object [${this.className}: ${this.data._id?.toString() ?? "not loaded"}]: ${error.message}`,
      );
      return { success: false, msg: "Error saving object: " + error.message };
    }
  }

  public async destroy(
    once = false,
  ): Promise<{ success: boolean; message: string }> {
    const _id = this.data._id;
    if (!_id) return { success: false, message: "Missing _id" };

    if (!once) {
      return await this.parentManager.deleteObject(_id as any);
    }

    // Wait for any pending saves to complete before deleting
    await (this.saveLock ?? Promise.resolve()).catch(() => {});

    try {
      this.entry ??= await this.parentManager.model.findById(_id);
      if (this.entry) {
        await this.onDeletion();
        await this.entry.deleteOne();
      }
      this.loggers.debug?.("Deleted object from server " + this.className);
    } catch (error: any) {
      this.loggers.error?.(
        `Error deleting object from database - ${this.className} - ${_id.toString()}: ${error.message}`,
      );
      return {
        success: false,
        message: "Deletion unsuccessful: " + error.message,
      };
    }

    (this.socket as any).emit(EVENT_DELETE + this.className, _id.toString());

    await this.wipeSelf();
    return { success: true, message: "Deleted" };
  }

  protected override async onUpdate(
    noUpdate: boolean = false,
    key: string,
  ): Promise<void> {
    if (noUpdate || this._isUpdating) return;
    this._isUpdating = true;
    try {
      if (this.parentManager.options?.onUpdate) {
        await this.parentManager.options.onUpdate(
          this as unknown as T,
          async (key: string, val: any) => {
            // Bypass writeQueue chaining to prevent recursive deadlock while in onUpdate
            return (this as any).setValueQueueInternal(key, val, false, false, true);
          },
          key as any,
        );
      }
    } finally {
      this._isUpdating = false;
    }
  }

  protected override async onDeletion(): Promise<void> {
    if (this.parentManager.options?.onDeletion) {
      await this.parentManager.options.onDeletion(this as unknown as T);
    }
  }
}

export async function createAutoUpdatedClass<
  T extends IAutoUpdatedServerObject<T>,
>(
  classParam: Constructor<T>,
  className: string,
  socket: unknown,
  data: string | IsData<T>,
  loggers: LoggersType,
  parentManager: AutoUpdateServerManager<T, any>,
  emitter: EventEmitter3,
  document?: DocumentType<T>,
): Promise<IAutoUpdatedServerObject<T>> {
  const obj = new classParam(
    classParam,
    socket,
    data,
    loggers,
    className,
    parentManager,
    emitter,
  );
  if (document) {
    obj.loadFromDocument(document);
  } else {
    await obj.loadFromDB();
  }
  return obj;
}
