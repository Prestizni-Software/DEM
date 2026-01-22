import "reflect-metadata";
import _ from "lodash";
import {
  Constructor,
  EventEmitter3,
  InstanceOf,
  IsData,
  LoggersType,
  PathValueOf,
  ServerResponse,
  ServerUpdateRequest,
  Paths,
  AutoUpdated,
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
type SocketType = Socket<any, any>;
export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  className: string,
  socket: SocketType,
  data: IsData<C> | string,
  loggers: LoggersType,
  parentManager: AutoUpdateManager<any>,
  emitter: EventEmitter3,
): Promise<any> {
  if (typeof data !== "string" && data._id) {
    processIsRefProperties(data, classParam.prototype, undefined, [], loggers);
  }
  const props = Reflect.getMetadata("props", classParam.prototype);
  const instance = new AutoUpdatedClientObject<C>(
    socket,
    data,
    loggers,
    props,
    className,
    classParam,
    parentManager,
    emitter,
  );
  return instance as any;
}

export class AutoUpdatedClientObject<T> {
  protected readonly socket: SocketType;
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  protected readonly loggers: LoggersType = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  };
  protected isLoading = true;
  protected readonly emitter: EventEmitter3;
  public readonly properties: (keyof T)[];
  public readonly className: string;
  public parentManager: AutoUpdateManager<any>;
  protected isLoadingReferences = true;
  public readonly classProp: Constructor<T>;
  private readonly EmitterID = new ObjectId().toHexString();
  protected readonly toChangeOnParents: { key: string; value: any }[] = [];
  private readonly loadShit = async (): Promise<void> => {
    if (this.isLoaded) {
      try {
        await this.loadForceReferences();
        for (const thing of this.toChangeOnParents) {
          await this.setValue__(thing.key, thing.value);
        }
      } catch (error: any) {
        this.loggers.error("Error loading references");
        this.loggers.error(error.message);
        this.loggers.error(error.stack);
      }
      this.isLoadingReferences = false;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.emitter.once(
        "pre-loaded" + this.EmitterID,
        (failed: boolean, reason: string) => {
          if (failed) {
            reject(new Error(reason));
          } else resolve();
        },
      );
    });
    try {
      await this.loadForceReferences();
      for (const thing of this.toChangeOnParents) {
        await this.setValue__(thing.key, thing.value);
      }
      this.isLoadingReferences = false;
    } catch (error: any) {
      this.isLoadingReferences = false;
      this.loggers.error("Error loading references");
      this.loggers.error(error.message);
      this.loggers.error(error.stack);
    }
  };

  constructor(
    socket: SocketType,
    data: string | IsData<T>,
    loggers: LoggersType,
    properties: (keyof T)[],
    className: string,
    classProperty: Constructor<T>,
    parentManager: AutoUpdateManager<any>,
    emitter: EventEmitter3,
    isServer = false,
  ) {
    this.isServer = isServer;
    this.emitter = emitter;
    this.classProp = classProperty;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.parentManager = parentManager;
    this.className = className;
    this.properties = properties;
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
        "get" + this.className + data,
        null,
        (res: ServerResponse<T>) => {
          if (!res.success) {
            this.isLoading = false;
            this.loggers.error(
              "Could not load data from server: " + res.message,
            );
            this.emitter.emit("pre-loaded" + this.EmitterID);
            return;
          }
          this.data = res.data as IsData<T>;
          this.isLoading = false;
          this.emitter.emit("pre-loaded" + this.EmitterID);
          this.openSockets();
        },
      );
      this.data = { _id: data } as IsData<T>;
    } else {
      this.isLoading = true;
      this.data = data as any;
      const dataKeys = Object.keys(data);
      for (const key of this.properties) {
        if (typeof key !== "string")
          throw new Error(
            "Only string keys allowed. Not this shit: " + String(key),
          );
        if (!dataKeys.includes(key) && key !== "_id")
          this.loggers.warn(
            "Property " +
              key +
              " not found in data. If should be null/undefined, please say so implicitly.",
          );
        dataKeys.splice(dataKeys.indexOf(key), 1);
        const isRef = getMetadataRecursive(
          "isRef",
          this.classProp.prototype,
          key,
        );
        if (isRef) {
          if (Array.isArray(this.data[key])) {
            this.data[key] = this.data[key].map(
              (obj: any) => obj._id?.toString() ?? obj?.toString(),
            ) as any;
          } else {
            this.data[key] =
              (this.data[key] as any)?._id?.toString() ??
              (this.data[key] as any)?.toString();
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
        this.handleNewObject(data as any);
      else {
        this.isLoading = false;
        if (!this.isServer) this.openSockets();
      }
    }
    this.generateSettersAndGetters();
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
    for (const key of this.properties) {
      if (typeof key !== "string") continue;
      let pointer = getMetadataRecursive(
        "refsTo",
        this.classProp.prototype,
        key,
      );
      if (pointer) {
        pointer = pointer.split(":");
        if (pointer.length != 2)
          throw new Error(
            "population ref incorrectly defined. Sould be 'ParentClass:PropName.Path'",
          );
        const temp = data[key];
        delete data[key];
        this.toChangeOnParents.push({ key: key, value: temp });
      }
    }
    try {
      data = _.cloneDeep(data);
    } catch (error: any) {
      this.loggers.error("Most likely cycled object: " + error.message);
      this.loggers.error(error.stack);
    }
    this.socket.emit("new" + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server: " + res.message);
        this.emitter.emit("pre-loaded" + this.EmitterID, true, res.message);
        return;
      }
      this.data = res.data as IsData<T>;
      this.isLoading = false;
      this.loggers.debug("Created new object: " + this.data._id);
      this.emitter.emit("pre-loaded" + this.EmitterID);
      if (!this.isServer) this.openSockets();
    });
  }

  public get extractedData(): {
    [K in keyof T]: T[K];
  } extends { prototype: infer U }
    ? U
    : {
        [K in keyof T]: T[K];
      } {
    const extracted = processIsRefProperties(
      this.data,
      this.classProp.prototype,
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

  public loadMissingReferences(): void {
    this.checkForMissingRefs();
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const event = "update" + this.className + this.data._id.toString();
    this.socket.on(event, async (update: ServerUpdateRequest<T>) => {
      await this.handleUpdateRequest(update);
    });
  }

  private async handleUpdateRequest(
    update: ServerUpdateRequest<T>,
  ): Promise<ServerResponse<undefined>> {
    try {
      await this.setValue__(update.key, update.value, true);
      this.loggers.debug(`Applied patch ${update.key} set to ${update.value}`);

      // Return success with the applied patch
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

  private generateSettersAndGetters() {
    for (const key of this.properties) {
      if (typeof key !== "string") return;

      const k = key as keyof IsData<T>;
      const isRef = getMetadataRecursive(
        "isRef",
        this.classProp.prototype,
        key,
      );

      Object.defineProperty(this, key, {
        get: () => {
          if (isRef) {
            if (Array.isArray(this.data[k])) {
              const filtered = this.data[k]
                .map((id: string) => this.findReference(id))
                .filter(Boolean);
              if (
                filtered.length !== this.data[k].length &&
                this.parentManager.isLoaded
              )
                this.data[k] = filtered.map(
                  (obj: any) => obj._id?.toString() ?? obj.toString(),
                ) as any;

              return filtered;
            } else {
              const result = this.findReference(this.data[k] as any);
              if (!result && this.data[k] && this.parentManager.isLoaded)
                this.data[k] = undefined!;
              return result;
            }
          } else return this.data[k];
        },
        set: () => {
          throw new Error(
            `Cannot set ${key} this way, use "setValue" function.`,
          );
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  protected findReference(id: string | ObjectId): any {
    if (typeof id !== "string" && !ObjectId.isValid(id)) return id;
    for (const manager of Object.values(this.parentManager.managers)) {
      const result = manager.getObject(id.toString());
      if (result) return result;
    }
    return undefined;
  }

  public async setValue<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>,
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key, val);
  }

  protected async setValue__(
    key: any,
    val: any,
    silent: boolean = false,
    noGet: boolean = false,
    noUpdate: boolean = false,
  ): Promise<{ success: boolean; msg: string }> {
    let message = "Setting value " + key + " of " + this.className + " to ";
    const isRef = getMetadataRecursive("isRef", this.classProp.prototype, key);
    if (isRef)
      val = Array.isArray(val)
        ? val.map((v) => {
            return v._id?.toString() ?? v;
          })
        : (val?._id ?? val);
    message += JSON.stringify(val);
    this.loggers.debug(message);
    try {
      if (val instanceof AutoUpdatedClientObject) val = val.extractedData._id;
      const path = key.split(".");
      let obj = this.data as any;
      let lastClass = this as any;
      let lastPath = key as string;
      for (let i = 0; i < path.length - 1; i++) {
        if (
          typeof obj[path[i]] === "string" ||
          ObjectId.isValid(obj[path[i]])
        ) {
          let temp;
          try {
            temp = this.resolveReference(obj[path[i]]?.toString()) as any;
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
          if(!noUpdate)await this.onUpdate(noUpdate);
          return res;
        } else obj = obj[path[i]];
      }

      if (lastClass !== this || lastPath !== key) {
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

      let success;
      try {
        let isPopulated = getMetadataRecursive(
          "refsTo",
          this.classProp.prototype,
          lastPath,
        );
        if (isPopulated) {
          isPopulated = isPopulated.split(":");
          const parentObj =
            this.parentManager.managers[isPopulated[0]].getObject(val);
          if (!parentObj) {
            message +=
              "\nFailed to set value for " +
              this.className +
              " parent not found";
            this.loggers.error(message);
            return { success: false, msg: message };
          }
          let res;
          if (this.isServer) {
            const value = parentObj.getValue(isPopulated[1]);
            if (Array.isArray(value)) {
              res = await parentObj.setValue__(
                isPopulated[1],
                value.concat(this.data._id.toString()),false,false,true
              );
            } else
              res = await parentObj.setValue__(
                isPopulated[1],
                this.data._id.toString(),false,false,true
              );
          } else
            ({ res, val } = await this.preInnerSetValue(
              noGet,
              key,
              val,
              lastPath,
              silent,
              noUpdate
            ));
          success = res.success;
          message +=
            "\nReport from inner setValue function: " +
            res.msg.split("\n").join("\n  ");
        } else {
          const isRef = getMetadataRecursive(
            "isRef",
            this.classProp.prototype,
            key,
          );
          if (isRef && this.isServer && ObjectId.isValid(val))
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
            noUpdate
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
      if(!noUpdate)await this.onUpdate(noUpdate);
      this.findAndLoadReferences(lastPath, val);
      const isRef = getMetadataRecursive(
        "isRef",
        this.classProp.prototype,
        path.at(-1),
      );
      if (isRef && this.parentManager.isLoaded) {
        this.contactChildren();
      }
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
    noUpdate: boolean
  ) {
    if (
      !noGet &&
      this.isServer &&
      this.getValue(key) &&
      Array.isArray(this.getValue(key)) &&
      !Array.isArray(val)
    ) {
      val = this.getValue(key).concat(val);
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
            .map((v: any) => v.toString()),
        ),
      ];
    }
    return { res, val };
  }

  private findAndLoadReferences(lastPath: string, value: any) {
    const isRef = getMetadataRecursive(
      "isRef",
      this.classProp.prototype,
      lastPath,
    );
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        let result;
        for (const manager of Object.values(this.parentManager.managers)) {
          result = manager.getObject(id?.toString());
          if (result) break;
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
        result.loadMissingReferences();
      }
    }
  }

  public getValue(key: Paths<T>) {
    let value: any;

    for (const part of key.split(".")) {
      try {
        if (value) value = value[part];
        else value = (this as any)[part];
      } catch (error: any) {
        this.loggers.error(
          "Error getting value for " +
            this.className +
            " on key " +
            key +
            " on index " +
            part +
            ":" +
            error.message,
        );
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
          if (noUpdate) return
          return this.onUpdate(true).then(() => {
            return resolve({ success: true, msg: "Success - silent" });
          });
        }
        try {
          this.socket.emit(
            "update" + this.className + this.data._id,
            update,
            async (res: ServerResponse<never>) => {
              if (!res.success) {
                this.loggers.error("Error sending update: " + res.message);
                resolve({ success: false, msg: res.message });
                return;
              }
              if(!noUpdate)await this.onUpdate(noUpdate);
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

  public async onUpdate(noUpdate:boolean) {
    return;
  }

  // return a properly typed AutoUpdatedClientClass (or null)
  // inside AutoUpdatedClientClass
  protected resolveReference(id: string): AutoUpdatedClientObject<any> | null {
    if (!this.parentManager) throw new Error("No Manager");
    for (const manager of Object.values(this.parentManager.managers)) {
      const data = manager.getObject(id);
      if (data) return data;
    }
    return null;
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this.classProp.prototype,
    alreadySeen: any[] = [],
  ) {
    const props = Reflect.getMetadata("props", proto) || [];

    for (const key of props) {
      if (typeof key !== "string") return;
      const isRef = Reflect.getMetadata("isRef", proto, key);
      const pointer = Reflect.getMetadata("refsTo", proto, key);
      if (pointer && obj === this.data && obj[key])
        await this.createdWithParent(pointer.split(":"), obj[key]);
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
    const refId = obj[key];
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

  protected async createdWithParent(
    pointer: string[],
    parent: AutoUpdatedClientObject<any> | string,
  ) {
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
      (parent as any)._id?.toString() ?? (parent as any).toString(),
    );
    const val = obj?.getValue(pointer[1]);
    if (!val) return;
    if (Array.isArray(val)) {
      const originalLength = val.length;
      const filtred = val.filter(Boolean);
      if (filtred.length !== originalLength) {
        await obj?.setValue(pointer[1], filtred);
        this.loggers.warn(
          "Array value changed from " +
            originalLength +
            " to " +
            filtred.length +
            " - some values were undefined",
        );
      }
      if (
        filtred
          .map((id: AutoUpdated<any>) => id?._id.toString())
          .includes(this.data._id)
      )
        obj?.contactChildren();
      else
        await obj?.setValue(pointer[1], [
          ...new Set([...filtred, this.data._id]),
        ]);
    } else if (val?.toString() === this.data?._id.toString())
      obj?.contactChildren();
    else await obj?.setValue(pointer[1], this.data?._id.toString());
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
          "delete" + this.className,
          this.data._id,
          (res: ServerResponse<undefined>) => {
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
            this.socket.removeAllListeners(
              "update" + this.className + this.data._id,
            );
            this.socket.removeAllListeners("delete" + this.className);
            this.wipeSelf();
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

  private checkForMissingRefs() {
    for (const prop of this.properties) {
      let pointer = getMetadataRecursive(
        "refsTo",
        this.classProp.prototype,
        prop.toString(),
      );
      if (pointer) {
        pointer = pointer.split(":");
        if (pointer.length != 2)
          throw new Error(
            "population rf incorrectly defined. Sould be 'ParentClass:PropName'",
          );
        this.findMissingObjectReference(prop, pointer);
      }
    }
  }
  private findMissingObjectReference(prop: any, pointer: string[]) {
    const ac = this.parentManager.managers[pointer[0]];
    if (!ac)
      throw new Error(`No AutoUpdateManager found for class ${pointer[0]}`);

    for (const obj of ac.objectsAsArray) {
      let eData = obj.extractedData;
      let found;
      for (const pathPart of pointer[1].split(".")) {
        if (
          !eData[pathPart] ||
          (Array.isArray(eData[pathPart]) &&
            !eData[pathPart]
              .map((id) => id.toString())
              .includes((this as any)._id.toString())) ||
          (!Array.isArray(eData[pathPart]) &&
            eData[pathPart].toString() !== this.data._id.toString())
        ) {
          found = false;
          break;
        }
        found = eData = eData[pathPart];
      }
      if (found) {
        (this.data as any)[prop] = (obj as any)._id;
        return;
      }
    }
  }
  protected wipeSelf() {
    if ((this.data as any).Wiped) return;
    const _id = this.data._id.toString();
    for (const key of Object.keys(this.data)) {
      delete (this.data as any)[key];
    }
    this.data = { Wiped: true } as any;
    this.loggers.info(`[${_id}] ${this.className} object wiped`);
  }

  public contactChildren() {
    for (const prop of this.properties) {
      const pointer = getMetadataRecursive(
        "refsTo",
        this.classProp.prototype,
        prop.toString(),
      );
      const isRef = getMetadataRecursive(
        "isRef",
        this.classProp.prototype,
        prop.toString(),
      );
      if (isRef && !pointer) {
        if (!this.getValue(prop as any)) continue;
        if (Array.isArray(this.getValue(prop as any))) {
          for (const child of this.getValue(prop as any)) {
            try {
              child?.loadMissingReferences();
            } catch (error: any) {
              this.loggers.error(error.message);
            }
          }
        } else this.getValue(prop as any)?.loadMissingReferences();
      }
    }
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
