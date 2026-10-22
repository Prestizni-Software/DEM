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
  DEMError,
  DEMErrorCode,
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

  /**
   * Initializes an AutoUpdatedServerObject instance.
   *
   * @param classParam - Target entity constructor class.
   * @param socket - Socket server or transport instance.
   * @param data - Initial entity data payload.
   * @param loggers - Logging interfaces.
   * @param className - Managed entity class name.
   * @param parentManager - Host server manager.
   * @param emitter - Shared event emitter.
   * @throws {DEMError} Throws DEMErrorCode.MISSING_ARGUMENT when required arguments are omitted.
   */
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
        throw new DEMError(
          DEMErrorCode.MISSING_ARGUMENT,
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

  /**
   * Persists active document changes to MongoDB with queue serialization.
   *
   * @returns Promise resolving when database write finishes.
   */
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

  /**
   * Loads entity document data directly from MongoDB by ID.
   *
   * @returns Promise resolving when data is populated.
   * @throws {DEMError} Throws DEMErrorCode.MISSING_ID or DOCUMENT_NOT_FOUND.
   */
  public async loadFromDB(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const _id = this.data._id;
      if (!_id) throw new DEMError(DEMErrorCode.MISSING_ID, "No id.");

      // Use the model from the parent manager
      this.entry = await this.parentManager.model.findById(_id);

      if (!this.entry)
        throw new DEMError(
          DEMErrorCode.DOCUMENT_NOT_FOUND,
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

  /**
   * Ingests existing MongoDB Mongoose document into instance state.
   *
   * @param document - Mongoose Typegoose document.
   */
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

  /**
   * Cleans raw object data and invalidates the cached extracted data representation.
   *
   * @param data - Raw entity data object.
   * @returns Cleaned entity data object.
   */
  public override handleDataCleanup(data: IsData<T>): IsData<T> {
    this._cachedExtractedData = null;
    return super.handleDataCleanup(data);
  }

  /**
   * Serialized data payload with resolved reference identifiers, cached for performance.
   *
   * @returns Extracted data representation of the entity.
   */
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

  /**
   * Sets a property value on the entity with deadlock-safe queueing during onUpdate hooks.
   *
   * @param key - Property key to modify.
   * @param val - Value to set.
   * @returns Promise resolving to operation outcome.
   */
  public override async setValue<K extends string>(
    key: K,
    val: any,
  ): Promise<{ success: boolean; msg: string }> {
    if (
      this._isUpdating &&
      typeof (this as any).setValueQueueInternal === "function"
    ) {
      return (this as any).setValueQueueInternal(
        key,
        val,
        false,
        false,
        true,
      );
    }
    return await super.setValue(key as any, val);
  }

  /**
   * Internal setter with re-entrant write queue lock support.
   *
   * @param key - Property key.
   * @param val - Value to set.
   * @param silent - Whether socket broadcast is skipped.
   * @param noGet - Whether local update bypasses get.
   * @param noUpdate - Whether onUpdate hook is skipped.
   * @param isParentUpdate - Whether mutation originated from parent.
   * @returns Promise resolving to update outcome.
   */
  protected override async setValue__(
    key: string,
    val: unknown,
    silent = false,
    noGet = false,
    noUpdate = false,
    isParentUpdate = false,
  ): Promise<{ success: boolean; msg: string }> {
    if (
      this._isUpdating &&
      typeof (this as any).setValueQueueInternal === "function"
    ) {
      return (this as any).setValueQueueInternal(
        key,
        val,
        silent,
        noGet,
        noUpdate,
        isParentUpdate,
      );
    }
    return await super.setValue__(
      key,
      val,
      silent,
      noGet,
      noUpdate,
      isParentUpdate,
    );
  }

  /**
   * Internal database and memory setter executing MongoDB updates and socket events.
   *
   * @param key - Property key to modify.
   * @param value - Value to set.
   * @param silent - Whether socket broadcast is bypassed.
   * @param noUpdate - Whether onUpdate hook is bypassed.
   * @returns Promise resolving to setter outcome.
   */
  protected override async setValueInternal(
    key: string,
    value: unknown,
    silent = false,
    noUpdate = false,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }> {
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
        throw new DEMError(
          DEMErrorCode.MISSING_ID,
          `Cannot update object ${this.className} - missing _id.`,
        );

      this.entry ??= await this.parentManager.model.findById(_id);
      if (!this.entry)
        throw new DEMError(
          DEMErrorCode.OBJECT_NOT_FOUND,
          "Object not found in DB.",
        );

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
              if (key.includes(".")) {
                _.set(this.entry, key, value);
              } else {
                (this.entry as any)[key] = value;
              }
            }
          });
        await this.saveLock;
      }

      if (key.includes(".")) {
        _.set(this.data as any, key, value);
      } else {
        (this.data as any)[key] = value;
      }
      this._cachedExtractedData = null;
      if (this.parentManager) {
        (this.parentManager as any).startupPayloadCache = null;
      }
      if (!silent) {
        if (this.parentManager && (this.parentManager as any).changeTracker) {
          (this.parentManager as any).changeTracker.recordChange(
            "update",
            _id.toString(),
            { [key]: value },
          );
        }
        const update = this.makeUpdate(key, value);
        const event = EVENT_UPDATE + this.className + _id.toString();
        (this.socket as any).emit(event, update);
        if (
          this.parentManager &&
          typeof (this.parentManager as any).checkPermissionBoundaries ===
            "function"
        ) {
          await (this.parentManager as any).checkPermissionBoundaries(
            this as unknown as T,
          );
        }
      }

      return { success: true, msg: "Success" };
    } catch (error: any) {
      this.loggers.error?.(
        `Error saving object [${this.className}: ${this.data._id?.toString() ?? "not loaded"}]: ${error.message}`,
      );
      return { success: false, msg: "Error saving object: " + error.message };
    }
  }

  /**
   * Deletes entity from MongoDB and emits delete socket events.
   *
   * @param once - Internal flag for single-pass deletion.
   * @returns Promise resolving to deletion outcome.
   */
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

  /**
   * Executes configured onUpdate hook with deadlock-safe write execution.
   *
   * @param noUpdate - Whether hook execution is skipped.
   * @param key - Modified property key.
   */
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
      if (
        this.parentManager &&
        typeof (this.parentManager as any).checkPermissionBoundaries ===
          "function"
      ) {
        await (this.parentManager as any).checkPermissionBoundaries(
          this as unknown as T,
        );
      }
    }
  }

  /**
   * Executes configured onDeletion hook prior to database removal.
   */
  protected override async onDeletion(): Promise<void> {
    if (this.parentManager.options?.onDeletion) {
      await this.parentManager.options.onDeletion(this as unknown as T);
    }
  }
}

/**
 * Instantiates and loads an AutoUpdatedServerObject instance.
 *
 * @param classParam - Constructor of the server entity class.
 * @param className - Managed entity class name.
 * @param socket - Socket server or transport instance.
 * @param data - Entity identifier or initial data object.
 * @param loggers - Logging interfaces.
 * @param parentManager - Host server manager.
 * @param emitter - Shared event emitter.
 * @param document - Optional pre-loaded Mongoose document.
 * @returns Promise resolving to the initialized server entity.
 */
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
