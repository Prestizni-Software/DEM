import "reflect-metadata";
import {
  Constructor,
  EventEmitter3,
  InstanceOf,
  IsData,
  LoggersType,
  LoggersTypeInternal,
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
  //protected updates: string[] = [];
  protected data: IsData<T>;
  protected readonly isServer: boolean = false;
  protected readonly loggers: LoggersTypeInternal = {
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
  private readonly token?: string;
  private readonly loadShit = async (): Promise<void> => {
    if (this.isLoaded) {
      try {
        await this.loadForceReferences();
      } catch (error) {
        this.loggers.error(error);
      }
      this.isLoadingReferences = false;
      return;
    }
    return new Promise((resolve) => {
      this.emitter.on("pre-loaded" + this.EmitterID, async () => {
        try {
          await this.loadForceReferences();
        } catch (error) {
          this.loggers.error(error);
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
    emitter: EventEmitter3
  ) {
    this.emitter = emitter;
    this.classProp = classProperty;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.autoClasser = autoClasser;
    this.className = className;
    this.properties = properties;
    this.loggers.debug = loggers.debug;
    this.loggers.info = loggers.info;
    this.loggers.error = loggers.error;
    this.loggers.warn = loggers.warn ?? loggers.info;
    this.socket = socket;
    if (typeof data === "string") {
      if (data === "")
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
            this.loggers.error("Could not load data from server:", res.message);
            this.emitter.emit("pre-loaded" + this.EmitterID);
            return;
          }
          this.data = res.data as IsData<T>;
          this.isLoading = false;
          this.emitter.emit("pre-loaded" + this.EmitterID);
        }
      );
      this.data = { _id: data } as IsData<T>;
    } else {
      this.isLoading = true;
      this.data = data as any;

      if (!this.data._id || this.data._id === "")
        this.handleNewObject(data as any);
      else {
        this.isLoading = false;
      }
    }
    if (!this.isServer) this.openSockets();
    this.generateSettersAndGetters();
  }

  protected handleNewObject(data: IsData<T>) {
    this.isLoading = true;
    if (!this.className)
      throw new Error(
        "Cannot create a new AutoUpdatedClientClass without a class name."
      );
    this.loggers.debug(
      this.className + "Requesting new object creation on server "
    );
    this.socket.emit("new" + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server:", res.message);
        this.emitter.emit("pre-loaded" + this.EmitterID);
        throw new Error("Error creating new object: " + res.message);
      }
      this.data = res.data as IsData<T>;
      this.isLoading = false;
      this.emitter.emit("pre-loaded" + this.EmitterID);
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
    return this.isLoading
      ? new Promise((resolve) => {
          this.emitter.on("pre-loaded" + this.EmitterID, async () => {
            resolve(this.isLoading === false);
          });
        })
      : true;
  }

  public async loadMissingReferences(): Promise<void> {
    checkForMissingRefs(
      this.data,
      this.properties,
      this.classProp,
      this.autoClasser
    );
    this.generateSettersAndGetters();
  }

  private openSockets() {
    this.socket.on(
      "update" + this.className + this.data._id.toString(),
      async (update: ServerUpdateRequest<T>) => {
        await this.handleUpdateRequest(update);
      }
    );
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

      this.loggers.debug(
        `[${this.data._id}] Applied patch ${update.key} set to ${update.value}`
      );

      // Return success with the applied patch
      return { success: true, data: undefined, message: "" };
    } catch (error: any) {
      this.loggers.error(
        `[${this.data._id}] Error applying patch:`,
        error.message,
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

  public setValue<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>
  ): Promise<{ success: boolean; msg: string }> {
    return this.setValue__(key, val);
  }

  protected async setValue__(
    key: any,
    val: any
  ): Promise<{ success: boolean; msg: string }> {
    let message = "Setting value " + key + " of " + this.className;
    let value = Array.isArray(val) ? val.map((v) => v._id ?? v) : val;
    this.loggers.debug(
      `[${(this.data as any)._id}] Setting ${key} to ${value}`
    );
    try {
      if (value instanceof AutoUpdatedClientObject)
        value = value.extractedData._id;
      const path = key.split(".");
      let obj = this.data as any;
      let lastClass = this as any;
      let lastPath = key as string;
      for (let i = 0; i < path.length - 1; i++) {
        if (
          typeof obj[path[i]] !== "object" ||
          obj[path[i]] instanceof ObjectId
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
          return await lastClass.setValue(lastPath, value);
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
          const originalValue = (this.data as any)[lastPath];
          if (!Array.isArray(value) && Array.isArray(originalValue)) {
            originalValue.push(value);
            value = originalValue;
          }
          const res = await this.setValueInternal(lastPath, value);
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
          for (const property of result.properties) {
            let isPopulated = getMetadataRecursive(
              "refsTo",
              result.classProp.prototype,
              property as any
            );
            if (!isPopulated) continue;
            isPopulated = isPopulated.split(":");
            if (
              isPopulated[0] !== this.className ||
              isPopulated[1] !== lastPath
            )
              continue;
            try {
              await result.loadMissingReferences();
              this.loggers.debug(
                "Successfully set value for " +
                  this.className +
                  " updating " +
                  id +
                  "'s parent to " +
                  this.data._id
              );
            } catch (error: any) {
              this.loggers.error(
                "Failed to set value for " +
                  this.className +
                  " updating " +
                  id +
                  "'s parent to " +
                  this.data._id
              );
              this.loggers.error(error.message);
              this.loggers.error(error.stack);
              return {
                success: false,
                msg:
                  "Failed to set value for " +
                  this.className +
                  " updating " +
                  id +
                  "'s parent to " +
                  this.data._id,
              };
            }
          }
        }
      }
      const pathArr = lastPath.split(".");
      if (pathArr.length === 1) {
        (this.data as any)[key] = value;
        await this.checkAutoStatusChange();
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
      ref[pathArr.at(-1)!] = value;
      await this.checkAutoStatusChange();
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
            ":",
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
              resolve({ success: res.success, message: res.message });
            }
          );
        } catch (error: any) {
          this.loggers.error("Error sending update:", error);
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

  protected async checkAutoStatusChange() {
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
    const props: string[] = Reflect.getMetadata("props", proto) || [];

    for (const key of props) {
      const isRef = Reflect.getMetadata("isRef", proto, key);

      if (isRef) {
        await this.handleLoadOnForced(obj, key, alreadySeen);
      }

      const val = obj[key];
      if (val && typeof val === "object") {
        const nestedProto = Object.getPrototypeOf(val);
        if (nestedProto && !alreadySeen.includes(nestedProto)) {
          alreadySeen.push(val);
          await this.loadForceReferences(val, nestedProto, alreadySeen);
        }
      }
    }
  }

  private async handleLoadOnForced(obj: any, key: string, alreadySeen: any[]) {
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
  public async destroy(once: boolean = false): Promise<void> {
    if (!once) {
      await this.autoClasser.deleteObject(this.data._id);
      return;
    }
    this.socket.emit("delete" + this.className, this.data._id);
    this.socket.removeAllListeners("update" + this.className + this.data._id);
    this.socket.removeAllListeners("delete" + this.className + this.data._id);
    this.wipeSelf();
  }

  protected wipeSelf() {
    for (const key of Object.keys(this.data)) {
      delete (this.data as any)[key];
    }
    this.loggers.info(`[${this.data._id}] ${this.className} object wiped`);
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

function checkForMissingRefs<C extends Constructor<any>>(
  data: IsData<InstanceType<C>>,
  props: any,
  classParam: C,
  autoClassers: AutoUpdateManager<any>
) {
  if (typeof data !== "string") {
    const entryKeys = Object.keys(data);
    for (const prop of props) {
      let pointer = getMetadataRecursive(
        "refsTo",
        classParam.prototype,
        prop.toString()
      );
      if (!entryKeys.includes(prop.toString()) && pointer) {
        pointer = pointer.split(":");
        if (pointer.length != 2)
          throw new Error(
            "population rf incorrectly defined. Sould be 'ParentClass:PropName'"
          );
        findMissingObjectReference(data, prop, autoClassers.classers, pointer);
      }
    }
  }
}
function findMissingObjectReference(
  data: any,
  prop: any,
  autoClassers: { [key: string]: AutoUpdateManager<any> },
  pointer: string[]
) {
  let foundAnAC = false;
  for (const ac of Object.values(autoClassers)) {
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
        found = eData = eData[pathPart];
      }
      if (found) {
        data[prop] = obj._id;
        return;
      }
    }
  }
  if (!foundAnAC) {
    throw new Error(`No AutoUpdateManager found for class ${pointer[0]}`);
  }
}
