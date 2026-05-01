import "reflect-metadata";
import _ from "lodash";
import {
  Constructor,
  EventEmitter3,
  IsData,
  LoggersType,
  PathValueOf,
  ServerResponse,
  ServerUpdateRequest,
  Paths,
  OnlyAddedKeys,
  ExtractedData,
  EVENT_INTERNAL_PRE_LOADED,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_NEW,
  EVENT_UPDATE,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { stringSimilarity } from "string-similarity-js";
export type DEMClientCallbacks<T> = {
  new: (obj: T) => Promise<void> | void;
  update: (obj: T, key: string) => Promise<void> | void;
  delete: (obj: T) => Promise<void> | void;
  progress: (percent: number) => void;
};

type SocketType = Socket<any, any>;

export abstract class AutoUpdatedClientObject<T> {
  //From server type for overlapping keys

  protected entry: any;
  public preLoad: any;
  public registerSocket: any;
  public readyLoggers: any;
  public loadFromDB(a: any): any {}
  public setValue_(a: any, b: any): any {}
  //-*--

  protected readonly socket: SocketType;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  public abstract readonly _id: any;
  protected readonly loggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  };
  protected isLoading = true;
  protected isLoadingReferences = true;
  protected checkedMissingRefs = false;
  protected readonly emitter: EventEmitter3;
  public readonly properties: (keyof OnlyAddedKeys<
    T,
    AutoUpdatedClientObject<T>
  >)[];
  public readonly classParam: Constructor<T>;
  public readonly className: string;
  public parentManager: AutoUpdateManager<AutoUpdatedClientObject<T>>;
  private readonly EmitterID = new ObjectId().toHexString();
  protected readonly toChangeOnParents: { key: string; value: any }[] = [];
  public callbacks: DEMClientCallbacks<T>;
  private readonly loadReferencesAsync = async (): Promise<void> => {
    if (this.isLoaded) {
      try {
        this.generateSettersAndGetters();
        await this.loadForceReferences();
        for (const thing of this.toChangeOnParents) {
          await this.setValue__(thing.key, thing.value, true, false, true);
        }
      } catch (error: any) {
        this.loggers.error("Error loading references");
        this.loggers.error(error.message);
        this.loggers.error(error.stack);
      }
      this.isLoadingReferences = false;
      return;
    }

    await this.waitForPreloaded();
    this.generateSettersAndGetters();
    try {
      await this.loadForceReferences();
      for (const thing of this.toChangeOnParents) {
        await this.setValue__(thing.key, thing.value, true, false, true);
      }
      this.isLoadingReferences = false;
    } catch (error: any) {
      this.isLoadingReferences = false;
      this.loggers.error("Error loading references");
      this.loggers.error(error.message);
      this.loggers.error(error.stack);
    }
  };

  /** @deprecated Use loadReferencesAsync instead */
  private readonly loadShit = this.loadReferencesAsync;

  constructor();
  constructor(
    classParam: Constructor<T>,
    socket: SocketType,
    data: string | IsData<T>,
    loggers: LoggersType,
    className: string,
    parentManager: AutoUpdateManager<any>,
    callback: DEMClientCallbacks<T>,
    emitter: EventEmitter3,
    isServer?: boolean,
  );
  constructor(
    classParam?: Constructor<T>,
    socket?: SocketType,
    data?: string | IsData<T>,
    loggers?: LoggersType,
    className?: string,
    parentManager?: AutoUpdateManager<any>,
    callback?: DEMClientCallbacks<T>,
    emitter?: EventEmitter3,
    isServer: boolean = false,
  ) {
    if (
      !classParam ||
      !socket ||
      !data ||
      !loggers ||
      !className ||
      !parentManager ||
      !callback ||
      !emitter
    ) {
      this.classParam = classParam as any;
      this.socket = socket as any;
      this.data = data as any;
      this.loggers = loggers as any;
      this.className = className as any;
      this.parentManager = parentManager as any;
      this.callbacks = callback as any;
      this.emitter = emitter as any;
      this.properties = undefined as any;
      if (
        !classParam &&
        !socket &&
        !data &&
        !loggers &&
        !className &&
        !parentManager &&
        !callback &&
        !emitter
      )
        return;
      else throw new Error("Missing arguments???");
    }
    this.classParam = classParam;
    if (typeof data !== "string" && data._id) {
      processIsRefProperties(data, this, undefined, [], loggers);
    }
    this.isServer = isServer;
    this.emitter = emitter;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.parentManager = parentManager;
    this.className = className;
    this.properties = Reflect.getMetadata("props", classParam.prototype);
    this.callbacks = callback;
    this.loggers.debug = (s: string) =>
      loggers.debug(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s,
      );
    this.loggers.info = (s: string) =>
      loggers.info(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s,
      );
    this.loggers.error = (s: string) =>
      loggers.error(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s,
      );
    this.loggers.warn = (s: string) =>
      loggers.warn(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s,
      );

    for (const prop of this.properties) {
      if (typeof prop !== "string")
        throw new Error("Property '" + prop.toString() + "' is not a string");
      if (prop.includes("."))
        throw new Error(
          "Property '" +
            prop.toString() +
            "' constain the illegal character '.'",
        );
    }
    this.socket = socket;
    if (typeof data === "string") {
      if (this.isServer) {
        this.isLoading = false;
        this.data = { _id: data } as IsData<T>;
        return;
      }
      if (!data || data === "" || data === "undefined") {
        this.loggers.error(
          "Cannot create a new AutoUpdatedClientClass with an empty string for ID. Data typeof: " +
            typeof data +
            " Data: " +
            data,
        );
        throw new Error(
          "Cannot create a new AutoUpdatedClientClass with an empty string for ID.",
        );
      }
      this.loggers.debug(
        "Getting new object from server " + this.className + " - " + data,
      );
      this.socket.emit(
        EVENT_GET + this.className + data,
        null,
        (res: ServerResponse<T>) => {
          if (!res.success) {
            this.isLoading = false;
            this.loggers.error(
              "Could not load data from server: " + res.message,
            );
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
            return;
            }
            this.data = res.data as IsData<T>;
            this.generateSettersAndGetters();
            this.isLoading = false;
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
            this.openSockets();
            },
            );      this.data = { _id: data } as IsData<T>;
    } else {
      this.isLoading = true;
      this.data = data;
      const dataKeys = Object.keys(data);
      for (const key of this.properties) {
        if (typeof key !== "string")
          throw new Error(
            "Only string keys allowed. Not this shit: " + String(key),
          );
        dataKeys.splice(dataKeys.indexOf(key), 1);
        const isRef = getMetadataRecursive("isRef", this, key);
        if (isRef) {
          if (Array.isArray(this.data[key])) {
            this.data[key] = this.data[key].map(
              (obj) => obj._id?.toString() ?? obj?.toString(),
            ) as any;
          } else {
            this.data[key] =
              (this.data[key] as any)?._id?.toString() ??
              this.data[key]?.toString();
          }
        }
      }
      if (dataKeys.includes("__v")) dataKeys.splice(dataKeys.indexOf("__v"), 1);
      if (dataKeys.length > 0)
        this.loggers.warn(
          (dataKeys.length > 1 ? "Properties " : "Property ") +
            dataKeys.join(", ") +
            (dataKeys.length > 1 ? " were " : " was ") +
            "unexpected. These properties are not known by the class. Please check your level of skill issue. Known properties are:\n" +
            this.properties.join("\n"),
        );

      if ((!this.data._id || this.data._id === "") && !this.isServer)
        this.handleNewObject(data);
      else {
        this.isLoading = false;
        if (!this.isServer) this.openSockets();
      }
    }
    this.generateSettersAndGetters();
  }

  public async waitForPreloaded() {
    if (this.isLoaded) return;
    await new Promise<void>((resolve, reject) => {
      this.emitter.once(
        EVENT_INTERNAL_PRE_LOADED + this.EmitterID,
        (failed: boolean, reason: string) => {
          if (failed) {
            reject(new Error(reason));
          } else resolve();
        },
      );
    });
  }

  protected handleNewObject(data: IsData<T>) {
    this.isLoading = true;
    if (!this.className)
      throw new Error(
        "Cannot create a new AutoUpdatedClientClass without a class name.",
      );
    this.loggers.debug(
      this.className + " - Requesting new object creation on server",
    );
    if (this.isServer)
      for (const key of this.properties) {
        if (typeof key !== "string") continue;
        let pointer = getMetadataRecursive("refsTo", this, key);
        if (pointer) {
          pointer = pointer.split(":");
          if (pointer.length != 2)
            throw new Error(
              "population ref incorrectly defined. Sould be 'ParentClass:PropName.Path'",
            );
          const temp = data[key];
          delete data[key];
          if (temp) this.toChangeOnParents.push({ key: key, value: temp });
        }
      }
    try {
      data = _.cloneDeep(data);
    } catch (error: any) {
      this.loggers.error("Most likely cycled object: " + error.message);
      this.loggers.error(error.stack);
    }
    this.socket.emit(EVENT_NEW + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server: " + res.message);
        this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, true, res.message);
        return;
      }
      this.data = res.data as IsData<T>;
      this.generateSettersAndGetters();
      this.isLoading = false;
      this.loggers.debug("Created new object: " + this.data._id);
      this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
      if (!this.isServer) this.openSockets();
    });
  }

  public get extractedData(): ExtractedData<T, AutoUpdatedClientObject<T>> {
    const extracted = processIsRefProperties(
      this.data,
      this,
      null,
      [],
      {},
      this.loggers,
    ).newData;

    return _.cloneDeep(extracted);
  }

  public get isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isPreLoadedAsync(): Promise<boolean> {
    await this.loadShit();
    this.generateSettersAndGetters();
    return true;
  }

  public async loadMissingReferences(): Promise<void> {
    await this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const event = EVENT_UPDATE + this.className + this.data._id.toString();
    this.socket.on(
      event,
      async (
        update: ServerUpdateRequest<T>,
        ack: (res: ServerResponse<undefined>) => void,
      ) => {
        const res = await this.handleUpdateRequest(update);
        if (ack && typeof ack === "function") ack(res);
        return res;
      },
    );
  }

  private async handleUpdateRequest(
    update: ServerUpdateRequest<T>,
  ): Promise<ServerResponse<undefined>> {
    try {
      await this.setValue__(update.key, update.value, true);
      this.loggers.debug(
        `Applied patch ${update.key} set to ${JSON.stringify(update.value)}`,
      );

      // Return success with the applied patch
      if (this.isLoaded) this.callbacks.update(this as any, update.key);
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      this.loggers.error(
        `[${this.data._id}] Error applying patch: ` +
          error.message +
          "\n" +
          error.stack,
      );
      return {
        success: false,
        message: "Error applying update: " + (error as Error).message,
      };
    }
  }

  protected generateSettersAndGetters() {
    for (const key of this.properties) {
      if (typeof key !== "string") return;

      const k = key as keyof IsData<T>;
      const isRef = getMetadataRecursive("isRef", this, key);

      Object.defineProperty(this, key, {
        get: () => {
          if (isRef) {
            if (Array.isArray(this.data[k])) {
              const filtered = this.data[k]
                .map((id: string) => this.findReference(id, key))
                .filter(Boolean);
              return filtered;
            } else {
              const result = this.findReference(this.data[k], key);
              return result;
            }
          } else return this.data[k];
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  protected findReference(id: string | ObjectId, key: string): any {
    if (typeof id !== "string" && !ObjectId.isValid(id)) return id;
    if (this.parentManager.cache.references[key])
      return this.parentManager.cache.references[key].getObject(id.toString());
    for (const manager of Object.values(this.parentManager.managers)) {
      const result = manager.getObject(id.toString());
      if (result) {
        this.parentManager.cache.references[key] = manager;
        return result;
      }
    }
    return undefined;
  }

  public async setValue<K extends Paths<T, AutoUpdatedClientObject<T>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string }> {
    const result = await this.setValue__(key, val);
    return result;
  }
  protected async setValue__(
    key: any,
    val: any,
    silent: boolean = false,
    noGet: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    let message = "Setting value " + key + " of " + this.className + " to ";
    const isRef = getMetadataRecursive("isRef", this, key);
    if (isRef)
      val = Array.isArray(val)
        ? val.map((v) => {
            return v._id?.toString() ?? v;
          })
        : (val?._id ?? val);
    try {
      message += JSON.stringify(val);
    } catch (error) {
      const _ = error;
      this.loggers.error("Circular object detected when setting value: " + key);
      if (val instanceof AutoUpdatedClientObject) {
        val = val.extractedData._id;
        message += JSON.stringify(val);
      }
    }
    this.loggers.debug(message);
    try {
      if (val instanceof AutoUpdatedClientObject) val = val.extractedData._id;
      if (Array.isArray(val))
        val = val.map((v) =>
          v instanceof AutoUpdatedClientObject ? v.extractedData._id : v,
        );
      let originalVal = this.getValue(key);
      if (Array.isArray(originalVal)) {
        originalVal = originalVal.map((v) =>
          v instanceof AutoUpdatedClientObject ? v.extractedData._id : v,
        );
      } else {
        originalVal =
          originalVal instanceof AutoUpdatedClientObject
            ? originalVal.extractedData._id
            : originalVal;
      }
      if (
        (Array.isArray(originalVal) &&
          Array.isArray(val) &&
          originalVal.length === val.length &&
          !originalVal.some((v) => !val.includes(v))) ||
        (Array.isArray(originalVal) &&
          !Array.isArray(val) &&
          originalVal.includes(val)) ||
        (!Array.isArray(originalVal) &&
          !Array.isArray(val) &&
          originalVal === val)
      ) {
        return { success: true, msg: "" };
      }
      const path = key.split(".");
      let obj = this.data as any;
      let lastClass = this as any;
      let lastPath = path[0];
      for (let i = 0; i < path.length - 1; i++) {
        if (
          typeof obj[path[i]] === "string" ||
          ObjectId.isValid(obj[path[i]])
        ) {
          let temp;
          try {
            temp = (await this.resolveReference(
              obj[path[i]]?.toString(),
            )) as any;
          } catch (error: any) {
            message +=
              "\n Error: likely undefined property on path: " +
              path +
              " on index: " +
              i +
              " with error: " +
              error.message;
          }
          if (!temp) {
            message +=
              "\nLikely undefined property " +
              path[i] +
              " on path: " +
              path +
              " at index: " +
              i;
            this.loggers.warn(
              "Failed to set value for " + this.className + "\n" + message,
            );
            return {
              success: false,
              msg: message,
            };
          }
          lastClass = temp;
          lastPath = path.slice(i + 1).join(".");
          const res = await lastClass.setValue(lastPath, val);
          if (!noUpdate) await this.onUpdate(noUpdate);
          return res;
        } else obj = obj[path[i]];
      }

      if (lastClass !== this) {
        message +=
          "\n What the actual fuckity fuck error on path: " +
          path +
          " on index: " +
          (path.length - 1);
        this.loggers.error(
          "Failed to set value for " + this.className + "\n" + message,
        );
        return {
          success: false,
          msg: message,
        };
      }

      if (!this.properties.includes(lastPath) && !lastPath.includes(".")) {
        let nearest = "";
        for (const prop of this.properties) {
          if (typeof prop !== "string") continue;
          if (
            stringSimilarity(lastPath, prop) > 0 &&
            stringSimilarity(lastPath, prop) > stringSimilarity(nearest, prop)
          ) {
            nearest = prop;
          }
        }
        throw new Error(
          `Property ${lastPath} not found in class ${this.className}, did you mean ${nearest ?? "--No similar prop found--"}?`,
        );
      }

      let success;
      try {
        let isPopulated = getMetadataRecursive("refsTo", this, lastPath);
        if (isPopulated) {
          isPopulated = isPopulated.split(":");
          if (val !== null && val !== undefined) {
            const parentObj = this.parentManager.managers[
              isPopulated[0]
            ].getObject(val) as AutoUpdatedClientObject<any>;
            if (!parentObj) {
              message +=
                "\n   Failed to set value for " +
                this.className +
                " parent not found";
              this.loggers.error(message);
              return { success: false, msg: message };
            }
            if (
              parentObj.getValue(isPopulated[1]) &&
              !Array.isArray(parentObj.getValue(isPopulated[1]))
            ) {
              message +=
                "\nThis is a 1:1 relationship and the parent already has a parent with the ID: " +
                (parentObj.getValue(isPopulated[1])._id?.toString() ??
                  parentObj.getValue(isPopulated[1]).toString()) +
                this.loggers.error(message);
              return { success: false, msg: message };
            }
            let res;
            if (this.isServer) {
              const value = parentObj.getValue(isPopulated[1]);
              if (Array.isArray(value)) {
                if (
                  value
                    .map((v) => v._id?.toString() ?? v.toString())
                    .includes(this.data._id.toString())
                )
                  return {
                    success: true,
                    msg: message + "\nValue already set",
                  };
                res = await parentObj.setValue__(
                  isPopulated[1],
                  value.concat(this.data._id.toString()),
                  false,
                  false,
                  true,
                );
              } else {
                if (
                  (value?._id?.toString() ?? value?.toString()) ===
                  this.data._id.toString()
                )
                  return {
                    success: true,
                    msg: message + "\nValue already set",
                  };
                res = await parentObj.setValue__(
                  isPopulated[1],
                  this.data._id.toString(),
                  false,
                  false,
                  true,
                );
              }
            } else {
              const value = parentObj.getValue(isPopulated[1]);
              if (
                Array.isArray(value)
                  ? value
                      .map((v) => v._id?.toString() ?? v.toString())
                      .includes(this.data._id.toString())
                  : (value._id?.toString() ?? value.toString()) ===
                    this.data._id.toString()
              )
                return { success: true, msg: message + "\nValue already set" };
              ({ res, val } = await this.preInnerSetValue(
                noGet,
                key,
                val,
                lastPath,
                silent,
                noUpdate,
              ));
            }
            success = res.success;
            message +=
              "\nReport from inner setValue function: " +
              res.msg.split("\n").join("\n  ");
          } else {
            const originalParenValue = this.getValue(key).getValue(
              isPopulated[1],
            );
            if (
              !originalParenValue ||
              (Array.isArray(originalParenValue) &&
                !originalParenValue.some(
                  (v: any) =>
                    (v._id?.toString() ?? v.toString()) === this._id.toString(),
                ))
            ) {
              message += "\n   Value already set";
              return { success: true, msg: message };
            }
            const parentObj = this.parentManager.managers[
              isPopulated[0]
            ].getObject(originalVal) as AutoUpdatedClientObject<any>;
            if (!parentObj) {
              message +=
                "\n   Failed to set value for " +
                this.className +
                " parent not found";
              this.loggers.error(message);
              return { success: false, msg: message };
            }
            let res;
            if (Array.isArray(originalParenValue)) {
              res = await parentObj.setValue__(
                isPopulated[1],
                originalParenValue
                  .map((v: any) => v._id?.toString() ?? v.toString())
                  .filter((v) => v !== this._id.toString()),
              );
            } else {
              res = await parentObj.setValue__(isPopulated[1], null);
            }
            success = res.success;
            message +=
              "\nReport from inner setValue function: " +
              res.msg.split("\n").join("\n  ");
          }
        } else {
          const isRef = getMetadataRecursive("isRef", this, key);
          if (
            isRef && this.isServer && Array.isArray(val)
              ? !val.some((v) => !ObjectId.isValid(v))
              : ObjectId.isValid(val)
          )
            val = Array.isArray(val)
              ? val.map((v) => new ObjectId(v as string | ObjectId))
              : new ObjectId(val as string | ObjectId);
          let res;
          ({ res, val } = await this.preInnerSetValue(
            noGet,
            key,
            val,
            lastPath,
            silent,
            noUpdate,
          ));
          if (res.success) {
            const originalValue = obj[path.at(-1)];
            if (!Array.isArray(val) && Array.isArray(originalValue)) {
              if (!originalValue.includes(val)) originalValue.push(val);
              val = originalValue;
            } else obj[path.at(-1)] = val;
          }
          success = res.success;
          message += "\nReport from inner setValue function: \n " + res.msg;
        }
      } catch (error: any) {
        success = false;
        message += "\nError from inner setValue function: \n  " + error.message;
        message += error.stack;
      }

      if (!success) {
        this.loggers.warn(
          "Failed to set value for " + this.className + "\n" + message,
        );
        return { success: false, msg: message };
      }
      const pathArr = lastPath.split(".");
      if (pathArr.length === 1) {
        (this.data as any)[key] = val;
      } else {
        const last = pathArr.splice(-1, 1);
        let ref = this as any;
        for (const p of pathArr) {
          ref = ref[p];
        }
        ref[last.at(-1)!] = val;
      }
      if (!noUpdate) await this.onUpdate(noUpdate);
      await this.findAndLoadReferences(lastPath, val);
      const isRef = getMetadataRecursive("isRef", this, path.at(-1));
      if (isRef && this.parentManager.isLoaded) {
        await this.contactChildren();
      }
      if (this.isLoaded) this.callbacks.update(this as any, key);
      return {
        success: true,
        msg: "Successfully set " + key + " to " + val,
      };
    } catch (error: any) {
      this.loggers.error(
        "An error occurred setting value for " +
          this.className +
          "\n" +
          message +
          "\n Random error here: " +
          error.message +
          "\n" +
          error.stack,
      );
      this.loggers.error(error);
      return {
        success: false,
        msg:
          message +
          "\n Random error here: " +
          error.message +
          "\n" +
          error.stack,
      };
    }
  }

  private async preInnerSetValue(
    noGet: boolean,
    key: any,
    val: any,
    lastPath: string,
    silent: boolean,
    noUpdate: boolean,
  ) {
    if (
      !noGet &&
      this.isServer &&
      this.getValue(key) &&
      Array.isArray(this.getValue(key)) &&
      !Array.isArray(val)
    ) {
      val = [
        ...new Set(
          this.getValue(key)
            .concat(val)
            .map(
              (v: any) =>
                v?._id?.toString() ?? new ObjectId(v as string | ObjectId),
            )
            .filter(Boolean),
        ),
      ];
    }
    const res = await this.setValueInternal(lastPath, val, silent, noUpdate);
    if (
      !noGet &&
      !this.isServer &&
      this.getValue(key) &&
      Array.isArray(this.getValue(key)) &&
      !Array.isArray(val)
    ) {
      val = [
        ...new Set(
          this.getValue(key)
            .concat(val)
            .map(
              (v: any) =>
                v?._id?.toString() ?? new ObjectId(v as string | ObjectId),
            )
            .filter(Boolean),
        ),
      ];
    }
    return { res, val };
  }

  private async findAndLoadReferences(lastPath: string, value: any) {
    const isRef = getMetadataRecursive("isRef", this, lastPath);
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (!id) continue;
        let result;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = manager.getObject(id?.toString());
          if (result) break;
        }
        if (!result) {
          for (const manager of Object.values(this.parentManager.managers)) {
            try {
              result = await manager.handleGetMissingObject(id?.toString());
              if (result) break;
            } catch (error) {
              const _ = error;
            }
          }
          if (!result) {
            this.loggers.warn(
              "Failed to update childerns parent for " +
                this.className +
                " updating " +
                id +
                "'s parent to " +
                this.data._id,
            );
            continue;
          }
        }
        if (result && typeof (result as any).loadMissingReferences === "function") {
          await result.loadMissingReferences();
        } else if (result) {
          this.loggers.warn(
            `Object in reference resolution is missing loadMissingReferences function. Type: ${typeof result}, ID: ${
              (result as any)._id ?? result
            }`,
          );
        }
      }
    }
  }

  public getValue(key_: Paths<T, AutoUpdatedClientObject<unknown>>) {
  const key = key_ as string;

  if (!key.includes(".")) {
    let val = (this as any)[key];
    val ??= (this.data as any)[key];
    return val;
  }

  let value: any;
  const parts = key.split(".");
  
  for (const part of parts) {
    try {
      if (value !== undefined && value !== null) {
        value = value[part];
      } else {
        value = (this as any)[part];
      }
    } catch (error: any) {
      this.loggers.error(
        `Error getting value for ${this.className} on key ${key} at index ${part}: ${error.message}`
      );
      return undefined;
    }
  }
  return value;
}

  protected async setValueInternal(
    key: string,
    value: any,
    silent: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    const update: ServerUpdateRequest<T> = this.makeUpdate(key, value);
    const promise = new Promise<{ success: boolean; msg: string }>(
      (resolve) => {
        if (silent) {
          if (noUpdate) return resolve({ success: true, msg: "Success - no update" });
          return this.onUpdate(true).then(() => {
            if (this.isLoaded) this.callbacks.update(this as any, key);
            return resolve({ success: true, msg: "Success - silent" });
          });
        }
        try {
          this.socket.emit(
            EVENT_UPDATE + this.className + this.data._id,
            update,
            async (res: ServerResponse<never>) => {
              if (!res.success) {
                this.loggers.error("Error sending update: " + res.message);
                resolve({ success: false, msg: res.message });
                return;
              }
              if (!noUpdate) await this.onUpdate(noUpdate);
              resolve({
                success: res.success,
                msg: res.message ?? "Success",
              });
            },
          );
        } catch (error: any) {
          this.loggers.error("Error sending update:" + error.message);
          this.loggers.error(error.stack);
          resolve({ success: false, msg: error.message });
        }
      },
    );
    return promise;
  }

  protected makeUpdate(key: string, value: any): ServerUpdateRequest<T> {
    try {
      const id = this.data._id.toString();
      return { _id: id, key, value } as any;
    } catch (error: any) {
      this.loggers.error(
        "Probably missing the fucking identifier ['_id'] again: " +
          error.message,
      );
      throw error;
    }
  }

  public async onUpdate(_: boolean) {
    return;
  }

  // return a properly typed AutoUpdatedClientClass (or null)
  // inside AutoUpdatedClientClass
  protected async resolveReference(
    id: string,
  ): Promise<AutoUpdatedClientObject<T> | null> {
    if (!this.parentManager) throw new Error("No Manager");
    for (const manager of Object.values(this.parentManager.managers)) {
      const data = manager.getObject(id);
      if (data) return data;
    }
    return null;
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this,
    alreadySeen: any[] = [],
  ) {
    const props = Reflect.getMetadata("props", proto) || [];

    for (const key of props) {
      if (typeof key !== "string") return;
      const isRef = Reflect.getMetadata("isRef", proto, key);
      const pointer = Reflect.getMetadata("refsTo", proto, key);
      if (
        pointer &&
        obj === this.data &&
        obj[key] &&
        !alreadySeen.includes(obj)
      )
        await this.createdWithParent(pointer.split(":"), obj[key]);
      alreadySeen.push(obj[key]);
      if (isRef) {
        await this.handleLoad(obj, key, alreadySeen);
      }

      await this.checkRecursiveReferenceLoading(obj, key, alreadySeen);
    }
  }

  private async checkRecursiveReferenceLoading(
    obj: any,
    key: string,
    alreadySeen: any[],
  ) {
    const val = obj ? obj[key] : null;
    if (val && typeof val === "object") {
      const nestedProto = Object.getPrototypeOf(val);
      if (nestedProto && !alreadySeen.includes(val)) {
        alreadySeen.push(val);
        await this.loadForceReferences(val, nestedProto, alreadySeen);
      }
    }
  }

  private async handleLoad(obj: any, key: string, alreadySeen: any[]) {
    if (!this.parentManager) throw new Error("No manager");
    const refIds = Array.isArray(obj[key]) ? obj[key] : [obj[key]];

    for (const refId of refIds) {
      if (refId) {
        for (const manager of Object.values(this.parentManager.managers)) {
          const result = manager.getObject(refId);
          if (result && !alreadySeen.includes(refId)) {
            alreadySeen.push(refId);
            await result.loadForceReferences(undefined, undefined, alreadySeen);
            break;
          }
        }
      }
    }
  }

  protected async createdWithParent(pointer: string[], parent: T | string) {
    if (pointer.length !== 2) {
      throw new Error(
        "Invalid pointer: " +
          JSON.stringify(pointer) +
          " for " +
          this.className +
          ", poiter must be 'className:pathToParentProperty'",
      );
    }
    if (!parent)
      throw new Error(
        "Invalid pointer: " +
          JSON.stringify(pointer) +
          " for " +
          this.className +
          ", parent is null",
      );
    const obj = this.parentManager.managers[pointer[0]]?.getObject(
      (parent as any)._id?.toString() ?? parent.toString(),
    ) as AutoUpdatedClientObject<any>;
    if (!obj) return;
    const val = obj.getValue(pointer[1]);

    if (Array.isArray(val)) {
      const originalLength = val.length;
      const filtred = val.filter(Boolean);
      if (filtred.length !== originalLength) {
        await obj.setValue__(pointer[1], filtred, true, false, true);
        this.loggers.warn(
          "Array value changed from " +
            originalLength +
            " to " +
            filtred.length +
            " - some values were undefined",
        );
      }
      if (filtred.map((id: any) => id?._id?.toString()).includes(this.data._id))
        await obj.contactChildren();
      else
        await obj.setValue__(pointer[1] as any, [
          ...new Set([...filtred, this.data._id]),
        ], true, false, true);
    } else if (val?.toString() === this.data?._id?.toString())
      await obj.contactChildren();
    else await obj.setValue__(pointer[1] as any, this.data?._id?.toString(), true, false, true);
  }

  public async destroy(
    once: boolean = false,
  ): Promise<{ success: boolean; message: string }> {
    if (!once) {
      return await this.parentManager.deleteObject(this.data._id);
    }
    const res = await new Promise<{ success: boolean; message: string }>(
      (resolve) => {
        this.socket.emit(
          EVENT_DELETE + this.className,
          this.data._id,
          async (res: ServerResponse<undefined>) => {
            if (!res.success) {
              this.loggers.error(
                "Error deleting object from database - " +
                  this.className +
                  " - " +
                  this.data._id,
              );
              this.loggers.error(res.message);
              resolve({
                success: false,
                message: res.message,
              });
              return;
            }
            resolve({
              success: true,
              message: "Deleted",
            });
          },
        );
      },
    );
    return res;
  }

  private async checkForMissingRefs() {
    for (const prop of this.properties) {
      let pointer = getMetadataRecursive("refsTo", this, prop.toString());
      if (pointer) {
        pointer = pointer.split(":");
        if (pointer.length != 2)
          throw new Error(
            "population ref incorrectly defined. Sould be 'ParentClass:PropName'",
          );
        await this.findMissingObjectReference(prop, pointer);
      }
    }
  }

private async findMissingObjectReference(prop: any, pointer: string[]) {
  if (this.checkedMissingRefs && this.isLoadingReferences) return;
  this.checkedMissingRefs = true;

  const ac = this.parentManager.managers[pointer[0]];
  if (!ac)
    throw new Error(`No AutoUpdateManager found for class ${pointer[0]}`);

  const targetId = this.data._id.toString();
  const pointerKey = pointer[1];
  
  const isNested = pointerKey.includes(".");
  const pathParts = isNested ? pointerKey.split(".") : [];

  const pendingObjects = ac.objectsAsArray.filter(obj => !obj.isLoaded);
  if (pendingObjects.length > 0) {
    await Promise.all(pendingObjects.map(obj => obj.waitForPreloaded()));
  }

  for (const obj of ac.objectsAsArray) {
    if (!obj.isLoaded) {
      await obj.waitForPreloaded();
    }

    let val: any;
    if (isNested) {
      val = obj;
      for (const element of pathParts) {
        if (!val) break;
        val = val[element] ?? val.data?.[element];
      }
    } else {
      val = (obj as any)[pointerKey] ?? (obj as any).data?.[pointerKey];
    }

    if (!val) continue;

    let found = false;

    if (Array.isArray(val)) {
      for (const element of val) {
        const item = element;
        if (!item) continue;
        
        const idStr = item._id ? item._id.toString() : item.toString();
        if (idStr === targetId) {
          found = true;
          break; 
        }
      }
    } else {
      const idStr = val._id ? val._id.toString() : val.toString();
      found = (idStr === targetId);
    }

    if (found) {
      (this.data as any)[prop] = obj._id;
      return; 
    }
  }
}
  protected async wipeSelf() {
    if ((this.data as any).Wiped) return;
    const _id = this.data._id.toString();
    for (const key of Object.keys(this.data)) {
      delete (this.data as any)[key];
    }
    this.data = { Wiped: true } as any;
    this.loggers.info(`[${_id}] ${this.className} object wiped`);
  }

  public async contactChildren() {
    let childsManager: null | AutoUpdateManager<AutoUpdatedClientObject<any>> =
      null;
    const findMissingObjectWithoutKnownManager = async (
      o: any,
    ): Promise<any> => {
      if (o instanceof AutoUpdatedClientObject) return o;
      if (childsManager)
        try {
          return await childsManager.handleGetMissingObject(
            o._id?.toString() ?? o.toString(),
          );
        } catch (error:any) {
          this.loggers.error("This should fucking not happen wtffffff");
          this.loggers.error(error.message);
          childsManager = null;
        }
      else {
        for (const manager of Object.values(this.parentManager.managers)) {
          try {
            const newO = await manager.handleGetMissingObject(
              o._id?.toString() ?? o.toString(),
            );
            childsManager = manager;
            return newO;
          } catch (e) {
            const _ = e;
          }
        }
        return undefined;
      }
    };

    for (const prop of this.properties) {
      const pointer = getMetadataRecursive("refsTo", this, prop.toString());
      const isRef = getMetadataRecursive("isRef", this, prop.toString());
      if (!isRef || pointer) continue;
      let obj = this.getValue(prop as any);
      if (!obj || (Array.isArray(obj) && obj.length == 0)) {
        obj = this.getValueInternal(prop);
        try {
          if (Array.isArray(obj))
            obj = await Promise.all(
              obj.map(findMissingObjectWithoutKnownManager),
            );
          else obj = await findMissingObjectWithoutKnownManager(obj);
        } catch (error: any) {
          const _ = error;
        }
      }

      if (!obj) continue;
      if (Array.isArray(obj)) {
        for (const child of obj) {
          try {
            if (child && typeof (child as any).loadMissingReferences === "function") {
              await (child as any).loadMissingReferences();
            } else if (child) {
              this.loggers.warn(
                `Object in property ${prop.toString()} is missing loadMissingReferences function. Type: ${typeof child}, ID: ${
                  (child as any)._id ?? child
                }`,
              );
            }
          } catch (error: any) {
            this.loggers.error(error.message);
          }
        }
      } else {
        if (obj && typeof (obj as any).loadMissingReferences === "function") {
          await (obj as any).loadMissingReferences();
        } else if (obj) {
          this.loggers.warn(
            `Object in property ${prop.toString()} is missing loadMissingReferences function. Type: ${typeof obj}, ID: ${
              (obj as any)._id ?? obj
            }`,
          );
        }
      }
    }
  }

  private getValueInternal(key: string | number | symbol) {
    const keys = key.toString().split(".");
    let value = this.data as any;
    for (const k of keys) {
      value = value[k];
    }
    return value;
  }
}

export function processIsRefProperties(
  instance: any,
  target: any,
  prefix: string | null = null,
  allProps: string[] = [],
  newData = {} as any,
  loggers = console as LoggersType,
) {
  const props: string[] = Reflect.getMetadata("props", target) || [];

  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
    newData[prop] = ObjectId.isValid(instance[prop])
      ? instance[prop]?.toString()
      : instance[prop];
    if (Reflect.getMetadata("isRef", target, prop)) {
      if (Array.isArray(instance[prop]))
        newData[prop] = instance[prop]
          .map(
            (item: any) =>
              item?._id?.toString() ?? item?.toString() ?? undefined,
          )
          .filter(Boolean);
      else
        newData[prop] =
          instance[prop]?._id?.toString() ??
          instance[prop]?.toString() ??
          undefined;
    }

    const type = Reflect.getMetadata("design:type", target, prop);
    if (type?.prototype) {
      const nestedProps = Reflect.getMetadata("props", type.prototype);
      if (nestedProps && instance[prop]) {
        newData[prop] = processIsRefProperties(
          instance[prop],
          type.prototype,
          path,
          allProps,
          undefined,
          loggers,
        ).newData;
      }
    }
  }
  return { allProps, newData };
}

export function getMetadataRecursive(
  metaKey: string,
  proto: any,
  prop: string,
) {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
