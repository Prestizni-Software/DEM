import "reflect-metadata";
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
} from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
type SocketType = Socket<any, any>;
export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: IsData<InstanceType<C>> | string,
  loggers: LoggersType,
  autoClassers: AutoUpdateManager<any>,
  emitter: EventEmitter3
): Promise<any> {
  if (typeof data !== "string") {
    processIsRefProperties(data, classParam.prototype, undefined, [], loggers);
  }
  const props = Reflect.getMetadata("props", classParam.prototype);
  const instance = new AutoUpdatedClientObject<C>(
    socket,
    data,
    loggers,
    props,
    classParam.name,
    classParam,
    autoClassers,
    emitter
  );

  await instance.isPreLoadedAsync();
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
  protected isLoading = false;
  protected readonly emitter: EventEmitter3;
  protected readonly properties: (keyof T)[];
  protected readonly className: string;
  protected autoClasser: AutoUpdateManager<any>;
  protected isLoadingReferences = false;
  public readonly classProp: Constructor<T>;
  private readonly EmitterID = new ObjectId().toHexString();
  private readonly loadShit = async (): Promise<void> => {
    if (this.isLoaded) {
      try {
        await this.loadForceReferences();
      } catch (error) {
        this.loggers.error("Error loading references");
        this.loggers.error((error as any).message);
      }
      this.isLoadingReferences = false;
      return;
    }
    return new Promise((resolve) => {
      this.emitter.on("pre-loaded" + this.EmitterID, async () => {
        try {
          await this.loadForceReferences();
        } catch (error) {
          this.loggers.error("Error loading references");
          this.loggers.error((error as any).message);
        }
        this.isLoadingReferences = false;
        resolve();
      });
    });
  };
  constructor(
    socket: SocketType,
    data: string | IsData<T>,
    loggers: LoggersType,
    properties: (keyof T)[],
    className: string,
    classProperty: Constructor<T>,
    autoClasser: AutoUpdateManager<any>,
    emitter: EventEmitter3,
    isServer = false
  ) {
    this.isServer = isServer;
    this.emitter = emitter;
    this.classProp = classProperty;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.autoClasser = autoClasser;
    this.className = className;
    this.properties = properties;
    this.loggers.debug = (s: string) =>
      loggers.debug(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s
      );
    this.loggers.info = (s: string) =>
      loggers.info(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s
      );
    this.loggers.error = (s: string) =>
      loggers.error(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s
      );
    this.loggers.warn = (s: string) =>
      loggers.warn(
        "[DEM - " +
          this.className +
          ": " +
          (this.data?._id ?? "not loaded") +
          "] " +
          s
      );
    this.socket = socket;
    if (typeof data === "string") {
      if (this.isServer) {
        this.isLoading = false;
        this.data = { _id: data } as IsData<T>;
        return;
      }
      if (!data || data === "")
        throw new Error(
          "Cannot create a new AutoUpdatedClientClass with an empty string for ID."
        );
      this.loggers.debug("Getting new object from server " + this.className);
      this.socket.emit(
        "get" + this.className + data,
        null,
        (res: ServerResponse<T>) => {
          if (!res.success) {
            this.isLoading = false;
            this.loggers.error(
              "Could not load data from server: " + res.message
            );
            this.emitter.emit("pre-loaded" + this.EmitterID);
            return;
          }
          this.data = res.data as IsData<T>;
          this.isLoading = false;
          this.emitter.emit("pre-loaded" + this.EmitterID);
          this.openSockets();
        }
      );
      this.data = { _id: data } as IsData<T>;
    } else {
      this.isLoading = true;
      this.data = data as any;
      const dataKeys = Object.keys(data);
      for (const key of this.properties) {
        if (typeof key !== "string")
          throw new Error(
            "Only string keys allowed. Not this shit: " + String(key)
          );
        if (!dataKeys.includes(key) && key !== "_id")
          this.loggers.warn(
            "Property " +
              key +
              " not found in data. If should be null/undefined, please say so implicitly."
          );
        dataKeys.splice(dataKeys.indexOf(key), 1);
        const isRef = getMetadataRecursive(
          "isRef",
          this.classProp.prototype,
          key
        );
        if (isRef) {
          if (Array.isArray(this.data[key])) {
            this.data[key] = this.data[key].map(
              (obj: any) => obj._id ?? obj
            ) as any;
          } else {
            this.data[key] = (this.data[key] as any)?._id ?? this.data[key];
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
            this.properties.join("\n")
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
        "Cannot create a new AutoUpdatedClientClass without a class name."
      );
    this.loggers.debug(
      this.className + " - Requesting new object creation on server"
    );
    this.socket.emit("new" + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server: " + res.message);
        this.emitter.emit("pre-loaded" + this.EmitterID);
        throw new Error("Error creating new object: " + res.message);
      }
      this.data = res.data as IsData<T>;
      this.isLoading = false;
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
      this.loggers
    ).newData;

    return structuredClone(extracted);
  }

  public get isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isPreLoadedAsync(): Promise<boolean> {
    await this.loadShit();
    if (this.isLoading)
      return new Promise((resolve) => {
        this.emitter.on("pre-loaded" + this.EmitterID, async () => {
          this.generateSettersAndGetters();
          resolve(this.isLoading === false);
        });
      });

    this.generateSettersAndGetters();
    return true;
  }

  public loadMissingReferences(obj?: AutoUpdatedClientObject<any>): void {
    this.checkForMissingRefs(obj);
    this.generateSettersAndGetters();
  }

  private openSockets() {
    const event = "update" + this.className + this.data._id.toString();
    this.socket.on(event, async (update: ServerUpdateRequest<T>) => {
      await this.handleUpdateRequest(update);
    });
  }

  private async handleUpdateRequest(
    update: ServerUpdateRequest<T>
  ): Promise<ServerResponse<undefined>> {
    try {
      const path = update.key.split(".");
      let dataRef: any = this.data;
      for (let i = 0; i < path.length - 1; i++) {
        if (!dataRef[path[i]]) dataRef[path[i]] = {};
        dataRef = dataRef[path[i]];
      }
      dataRef[path.at(-1)!] = update.value;
      await this.loadForceReferences();
      await this.contactChildren();
      this.loggers.debug(`Applied patch ${update.key} set to ${update.value}`);

      // Return success with the applied patch
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      this.loggers.error(
        `[${this.data._id}] Error applying patch: ` +
          error.message +
          "\n" +
          error.stack
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
        key
      );

      Object.defineProperty(this, key, {
        get: () => {
          if (isRef) {
            if (Array.isArray(this.data[k]))
              return this.data[k].map((id: string) => this.findReference(id));
            else return this.findReference(this.data[k] as any);
          } else return this.data[k];
        },
        set: () => {
          throw new Error(
            `Cannot set ${key} this way, use "setValue" function.`
          );
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  protected findReference(id: string | ObjectId): any {
    if (typeof id !== "string" && !ObjectId.isValid(id)) return id;
    for (const classer of Object.values(this.autoClasser.classers)) {
      const result = classer.getObject(id.toString());
      if (result) return result;
    }
  }

  public async setValue<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>
  ): Promise<{ success: boolean; msg: string }> {
    return await this.setValue__(key, val);
  }

  protected async setValue__(
    key: any,
    val: any
  ): Promise<{ success: boolean; msg: string }> {
    let message = "Setting value " + key + " of " + this.className;
    let value = Array.isArray(val) ? val.map((v) => v._id ?? v) : val;
    this.loggers.debug(message);
    try {
      if (value instanceof AutoUpdatedClientObject)
        value = value.extractedData._id;
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
              "Failed to set value for " + this.className + "\n" + message
            );
            return {
              success: false,
              msg: message,
            };
          }
          lastClass = temp;
          lastPath = path.slice(i + 1).join(".");
          const res = await lastClass.setValue(lastPath, value);
          this.checkAutoStatusChange();
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
          "Failed to set value for " + this.className + "\n" + message
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
          lastPath
        );
        if (isPopulated) {
          isPopulated = isPopulated.split(":");
          const parentObj =
            this.autoClasser.classers[isPopulated[0]].getObject(value);
          if (!parentObj) {
            this.loggers.error(
              "Failed to set value for " +
                this.className +
                " ParentObject not found\n" +
                message
            );
            return { success: false, msg: message };
          }
          const res = await parentObj.setValue(isPopulated[1], this.data._id);
          success = res.success;
          message += "\nReport from inner setValue function: \n " + res.msg;
        } else {
          if (this.getValue(key) && Array.isArray(this.getValue(key))) {
            if (this.getValue(key).includes(value)) value = this.getValue(key);
            else value = [...new Set(this.getValue(key).concat(value))];
          }
          const res = await this.setValueInternal(lastPath, value);
          if (res.success) {
            const originalValue = obj[path.at(-1)];
            if (!Array.isArray(value) && Array.isArray(originalValue)) {
              if (!originalValue.includes(value)) originalValue.push(value);
              value = originalValue;
            } else obj[path.at(-1)] = value;
          }
          success = res.success;
          message += "\nReport from inner setValue function: \n " + res.message;
        }
      } catch (error: any) {
        success = false;
        message += "\nError from inner setValue function: \n  " + error.message;
      }

      if (!success) {
        this.loggers.warn(
          "Failed to set value for " + this.className + "\n" + message
        );
        return { success: false, msg: message };
      }
      const pathArr = lastPath.split(".");
      if (pathArr.length === 1) {
        if (Array.isArray(value)) value = [...new Set(value)];
        (this.data as any)[key] = value;
        await this.checkAutoStatusChange();
        this.findAndLoadReferences(lastPath, value);
        return {
          success: true,
          msg: "Successfully set " + key + " to " + value,
        };
      }
      const pathMinusLast = pathArr.splice(0, 1);
      let ref = this as any;
      for (const p of pathMinusLast) {
        ref = ref[p];
      }
      if (Array.isArray(value)) value = [...new Set(value)];
      ref[pathArr.at(-1)!] = value;
      await this.checkAutoStatusChange();
      this.findAndLoadReferences(lastPath, value);
      return {
        success: true,
        msg: "Successfully set " + key + " to " + value,
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
          error.stack
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

  private findAndLoadReferences(lastPath: string, value: any) {
    const isRef = getMetadataRecursive(
      "isRef",
      this.classProp.prototype,
      lastPath
    );
    if (isRef) {
      for (const id of Array.isArray(value) ? value : [value]) {
        let result;
        for (const classer of Object.values(this.autoClasser.classers)) {
          result = classer.getObject(id.toString());
          if (result) break;
        }
        if (!result) {
          this.loggers.warn(
            "Failed to update childerns parent for " +
              this.className +
              " updating " +
              id +
              "'s parent to " +
              this.data._id
          );
          continue;
        }
        result.loadMissingReferences(this);
      }
    }
  }

  public getValue(key: Paths<T>) {
    let value: any;

    for (const part of key.split(".")) {
      try {
        if (value) value = value[part];
        else value = (this.data as any)[part];
      } catch (error: any) {
        this.loggers.error(
          "Error getting value for " +
            this.className +
            " on key " +
            key +
            " on index " +
            part +
            ":" +
            error.message
        );
      }
    }
    return value;
  }

  protected async setValueInternal(
    key: string,
    value: any
  ): Promise<{ success: boolean; message: string }> {
    const update: ServerUpdateRequest<T> = this.makeUpdate(key, value);
    const promise = new Promise<{ success: boolean; message: string }>(
      (resolve) => {
        try {
          this.socket.emit(
            "update" + this.className + this.data._id,
            update,
            (res: ServerResponse<T>) => {
              resolve({ success: res.success, message: "Success" });
            }
          );
          this.checkAutoStatusChange();
        } catch (error: any) {
          this.loggers.error("Error sending update:" + error.message);
          this.loggers.error(error.stack);
          resolve({ success: false, message: error.message });
        }
      }
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
          error.message
      );
      throw error;
    }
  }

  public async checkAutoStatusChange() {
    return;
  }

  // return a properly typed AutoUpdatedClientClass (or null)
  // inside AutoUpdatedClientClass
  protected resolveReference(id: string): AutoUpdatedClientObject<any> | null {
    if (!this.autoClasser) throw new Error("No autoClasser");
    for (const autoClasser of Object.values(this.autoClasser.classers)) {
      const data = autoClasser.getObject(id);
      if (data) return data;
    }
    return null;
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this.classProp.prototype,
    alreadySeen: any[] = []
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

      const val = obj[key];
      if (val && typeof val === "object") {
        const nestedProto = Object.getPrototypeOf(val);
        if (nestedProto && !alreadySeen.includes(val)) {
          alreadySeen.push(val);
          await this.loadForceReferences(val, nestedProto, alreadySeen);
        }
      }
    }
  }

  private async handleLoad(obj: any, key: string, alreadySeen: any[]) {
    if (!this.autoClasser) throw new Error("No autoClassers");
    const refId = obj[key];
    if (refId) {
      for (const classer of Object.values(this.autoClasser.classers)) {
        const result = classer.getObject(refId);
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
    parent: AutoUpdatedClientObject<any> | string
  ) {
    if (pointer.length !== 2) {
      throw new Error(
        "Invalid pointer: " + JSON.stringify(pointer) + " for " + this.className
      );
    }
    const obj = this.autoClasser.classers[pointer[0]]?.getObject(
      (parent as any)._id?.toString() ?? (parent as any).toString()
    );
    const val = obj?.getValue(pointer[1]);
    if (!val) return;
    if (Array.isArray(val)) {
      if (val.includes(this.data._id)) await obj?.contactChildren();
      else await obj?.setValue(pointer[1], [...new Set(val), this.data._id]);
    } else if (val.toString() === this.data._id.toString())
      await obj?.contactChildren();
    else await obj?.setValue(pointer[1], this.data._id.toString());
  }

  public async destroy(
    once: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    if (!once) {
      return await this.autoClasser.deleteObject(this.data._id);
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
                  this.data._id
              );
              this.loggers.error(res.message);
              resolve({
                success: false,
                message: res.message,
              });
              return;
            }
            this.socket.removeAllListeners(
              "update" + this.className + this.data._id
            );
            this.socket.removeAllListeners(
              "delete" + this.className + this.data._id
            );
            this.wipeSelf();
            resolve({
              success: true,
              message: "Deleted",
            });
          }
        );
      }
    );
    return res;
  }

  private checkForMissingRefs(obj?: AutoUpdatedClientObject<any>) {
    for (const prop of this.properties) {
      let pointer = getMetadataRecursive(
        "refsTo",
        this.classProp.prototype,
        prop.toString()
      );
      if (pointer) {
        pointer = pointer.split(":");
        if (pointer.length != 2)
          throw new Error(
            "population rf incorrectly defined. Sould be 'ParentClass:PropName'"
          );
        this.findMissingObjectReference(prop, pointer, obj);
      }
    }
  }
  private findMissingObjectReference(
    prop: any,
    pointer: string[],
    obj?: AutoUpdatedClientObject<any>
  ) {
    if (obj) {
      (this.data as any)[prop] = (obj as any)._id;
      return;
    }
    let foundAnAC = false;
    for (const ac of Object.values(this.autoClasser.classers)) {
      if (ac.className !== pointer[0]) {
        continue;
      }
      foundAnAC = true;
      for (const obj of ac.objectsAsArray) {
        let eData = obj.extractedData;
        let found;
        for (const pathPart of pointer[1].split(".")) {
          if (!eData[pathPart]) {
            found = false;
            break;
          }
          if (
            Array.isArray(eData[pathPart]) &&
            !eData[pathPart].includes(this.data._id.toString())
          ) {
            found = false;
            break;
          }
          if (eData[pathPart].toString() !== this.data._id.toString()) {
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
    if (!foundAnAC) {
      throw new Error(`No AutoUpdateManager found for class ${pointer[0]}`);
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

  public async contactChildren() {
    for (const prop of this.properties) {
      const pointer = getMetadataRecursive(
        "refsTo",
        this.classProp.prototype,
        prop.toString()
      );
      const isRef = getMetadataRecursive(
        "isRef",
        this.classProp.prototype,
        prop.toString()
      );
      if (isRef && !pointer) {
        if (!(this as any)[prop]) continue;
        if (Array.isArray((this as any)[prop])) {
          for (const child of (this as any)[prop]) {
            child?.loadMissingReferences(this);
          }
        } else (this as any)[prop]?.loadMissingReferences(this);
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
  loggers = console as LoggersType
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
        newData[prop] = instance[prop].map((item: any) =>
          typeof item === "string" ? item : item?._id?.toString()
        );
      else
        newData[prop] =
          typeof instance[prop] === "string"
            ? instance[prop]
            : instance[prop]?._id.toString();
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
          loggers
        ).newData;
      }
    }
  }
  return { allProps, newData };
}

export function getMetadataRecursive(
  metaKey: string,
  proto: any,
  prop: string
) {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}
