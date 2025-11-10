import "reflect-metadata";
import {
  Constructor,
  DeRef,
  InstanceOf,
  IsData,
  LoggersType,
  LoggersTypeInternal,
  Paths,
  PathValueOf,
  ServerResponse,
  ServerUpdateRequest,
  SocketType,
} from "./CommonTypes.ts";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.ts";
import { ObjectId } from "bson";

export type AutoUpdated<T extends Constructor<any>> =
  AutoUpdatedClientObject<T> & DeRef<InstanceOf<T>>;
export async function createAutoUpdatedClass<C extends Constructor<any>>(
  classParam: C,
  socket: SocketType,
  data: IsData<InstanceType<C>> | string,
  loggers: LoggersType,
  autoClassers: { [key: string]: AutoUpdateManager<any> },
  emitter: EventTarget
): Promise<AutoUpdated<C>> {
  if (typeof data !== "string")
    processIsRefProperties(data, classParam.prototype, undefined, [], loggers);
  const props = Reflect.getMetadata("props", classParam.prototype);
  if (typeof data !== "string")
    checkForMissingRefs<C>(data, props, classParam, autoClassers);
  const instance = new (class extends AutoUpdatedClientObject<C> {})(
    socket,
    data,
    loggers,
    props,
    classParam.name,
    classParam,
    autoClassers,
    emitter

    
  );

  await instance.isLoadedAsync();

  return instance as any;
}

export abstract class AutoUpdatedClientObject<T extends Constructor<any>> {
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
  protected readonly emitter;
  protected readonly properties: (keyof T)[];
  protected readonly className: string;
  protected autoClassers: Record<string, AutoUpdateManager<any>>;
  protected isLoadingReferences = false;
  public readonly classProp: Constructor<T>;
  private readonly EmitterID = new ObjectId().toHexString();

  private readonly loadShit = async () => {
    if (this.isLoaded()) {
      try {
        await this.loadForceReferences();
      } catch (error) {
        this.loggers.error(error);
      }
      this.isLoadingReferences = false;

      return;
    }
    this.emitter.addEventListener("loaded"+this.EmitterID, async () => {
      try {
        await this.loadForceReferences();
      } catch (error) {
        this.loggers.error(error);
      }
      this.isLoadingReferences = false;
    });
  };
  constructor(
    socket: SocketType,
    data: string | IsData<T>,
    loggers: LoggersType,
    properties: (keyof T)[],
    className: string,
    classProperty: Constructor<T>,
    autoClassers: Record<string, AutoUpdateManager<any>>,
    emitter: EventTarget
  ) {
    this.emitter = emitter;
    this.classProp = classProperty;
    this.isLoadingReferences = true;
    this.isLoading = true;
    this.autoClassers = autoClassers;
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
      this.socket.emit(
        "get" + this.className + data,
        null,
        (res: ServerResponse<T>) => {
          if (!res.success) {
            this.isLoading = false;
            this.loggers.error("Could not load data from server:", res.message);
            this.emitter.dispatchEvent(new Event("loaded"+this.EmitterID));
            return;
          }
          checkForMissingRefs<T>(res.data as any, properties, classProperty as  any, autoClassers);
          this.data = res.data as IsData<T>;
          this.isLoading = false;
          this.emitter.dispatchEvent(new Event("loaded"+this.EmitterID));
        }
      );
      this.data = { _id: data } as IsData<T>;
    } else {
      this.isLoading = true;
      this.data = data;
      if (this.data._id === "") this.handleNewObject(data);
      else this.isLoading = false;
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
    this.socket.emit("new" + this.className, data, (res: ServerResponse<T>) => {
      if (!res.success) {
        this.isLoading = false;
        this.loggers.error("Could not create data on server:", res.message);
        this.emitter.dispatchEvent(new Event("loaded"+this.EmitterID));
        return;
      }
      this.data = res.data as IsData<T>;
      this.isLoading = false;
      this.emitter.dispatchEvent(new Event("loaded"+this.EmitterID));
    });
  }

  public get extractedData(): {
    [K in keyof InstanceType<T>]: InstanceOf<InstanceType<T>>[K];
  } {
    return structuredClone(this.data) as any as {
      [K in keyof InstanceType<T>]: InstanceOf<InstanceType<T>>[K];
    };
  }

  public isLoaded(): boolean {
    return !this.isLoading;
  }

  public async isLoadedAsync(): Promise<boolean> {
    await this.loadShit();
    return this.isLoading
      ? new Promise((resolve) => {
          this.emitter.addEventListener("loaded"+this.EmitterID, () => {
            resolve(this.isLoading === false);
          });
        })
      : true;
  }

  private openSockets() {
    this.loggers.debug(`[${this.data._id}] Opening socket listeners`);

    this.socket.on(
      "update" + this.className + this.data._id,
      async (update: ServerUpdateRequest<T>) => {
        await this.handleUpdateRequest(update);
      }
    );
  }
  // Example server-side handler
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
    } catch (error) {
      this.loggers.error(`[${this.data._id}] Error applying patch:`, error);
      return {
        success: false,
        message: "Error applying update: " + (error as Error).message,
      };
    }
  }

  private generateSettersAndGetters() {
    this.properties.forEach((key) => {
      if (typeof key !== "string") return;

      const k = key as keyof IsData<T>;
      const isRef = this.getMetadataRecursive(
        "isRef",
        this.classProp.prototype,
        key
      );

      Object.defineProperty(this, key, {
        get: () =>
          isRef ? this.findReference(this.data[k] as string) : this.data[k],
        set: () => {
          throw new Error(
            `Cannot set ${key} this way, use "setValue" function.`
          );
        },
        enumerable: true,
        configurable: true,
      });
    });
  }

  protected findReference(id: string): AutoUpdated<any> | undefined {
    for (const classer of Object.values(this.autoClassers)) {
      const result = classer.getObject(id);
      if (result) return result;
    }
  }

  public async setValue<K extends Paths<InstanceOf<T>>>(
    key: K,
    val: PathValueOf<T, K>
  ): Promise<boolean> {
    let value = val as any;
    this.loggers.debug(
      `[${(this.data as any)._id}] Setting ${key} to ${value}`
    );
    try {
      if (value instanceof AutoUpdatedClientObject)
        value = (value as any).extractedData._id;
      const path = key.split(".");
      let obj = this.data as any;
      let lastClass = this as any;
      let lastPath = key as string;
      for (let i = 0; i < path.length - 1; i++) {
        if (
          typeof obj[path[i]] !== "object" ||
          obj[path[i]] instanceof ObjectId
        ) {
          let temp = this.resolveReference(
            obj[path[i]].toString()
          ) as AutoUpdated<any>;
          if (!temp) {
            return false;
          }
          lastClass = temp;
          lastPath = path.slice(i + 1).join(".");
          return await lastClass.setValue(lastPath, value);
        } else obj = obj[path[i]];
      }

      if (lastClass !== this || lastPath !== (key as any))
        throw new Error("???");

      const success = await this.setValueInternal(lastPath, value);

      if (!success) {
        return false;
      }
      const pathArr = lastPath.split(".");
      if (pathArr.length === 1) {
        (this.data as any)[key as any] = value;
        return true;
      }
      const pathMinusLast = pathArr.splice(0, 1);
      let ref = this as any;
      for (const p of pathMinusLast) {
        ref = ref[p];
      }
      ref[pathArr.at(-1)!] = value;
      return true;
    } catch (error) {
      this.loggers.error(error);
      return false;
    }
  }

  protected async setValueInternal(key: string, value: any): Promise<boolean> {
    const update: ServerUpdateRequest<T> = this.makeUpdate(key, value);
    const promise = new Promise<boolean>((resolve) => {
      try {
        this.socket.emit(
          "update" + this.className + this.data._id,
          update,
          (res: ServerResponse<T>) => {
            resolve(res.success);
          }
        );
      } catch (error) {
        this.loggers.error("Error sending update:", error);
        resolve(false);
      }
    });
    return promise;
  }

  protected makeUpdate(key: string, value: any): any {
    const id = this.data._id.toString();
    return { _id: id, key, value } as any;
  }

  private getMetadataRecursive(metaKey: string, proto: any, prop: string) {
    while (proto) {
      const meta = Reflect.getMetadata(metaKey, proto, prop);
      if (meta !== undefined) return meta;
      proto = Object.getPrototypeOf(proto);
    }
    return undefined;
  }

  // return a properly typed AutoUpdatedClientClass (or null)
  // inside AutoUpdatedClientClass
  protected resolveReference(id: string): AutoUpdatedClientObject<any> | null {
    if (!this.autoClassers) throw new Error("No autoClassers");
    for (const autoClasser of Object.values(this.autoClassers)) {
      const data = autoClasser.getObject(id);
      if (data) return data;
    }
    return null;
  }

  private async loadForceReferences(
    obj: any = this.data,
    proto: any = this.classProp.prototype
  ) {
    const props: string[] = Reflect.getMetadata("props", proto) || [];

    for (const key of props) {
      const isRef = Reflect.getMetadata("isRef", proto, key);

      if (isRef) {
        await this.handleLoadOnForced(obj, key);
      }

      // If the property itself is a nested object, check deeper
      if (obj[key] && typeof obj[key] === "object") {
        const nestedProto = Object.getPrototypeOf(obj[key]);
        if (nestedProto) {
          await this.loadForceReferences(obj[key], nestedProto);
        }
      }
    }
  }

  private async handleLoadOnForced(obj: any, key: string) {
    if (!this.autoClassers) throw new Error("No autoClassers");
    const refId = obj[key];
    if (refId) {
      for (const classer of Object.values(this.autoClassers)) {
        const result = classer.getObject(refId);
        if (result) {
          obj[key] = result;

          // Recursively load refs inside the resolved object
          if (typeof result.loadForceReferences === "function") {
            await result.loadForceReferences();
          }
          break;
        }
      }
    }
  }
  public async destroy(): Promise<void> {
    this.socket.emit("delete" + this.className, this.data._id);
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
  prefix = "",
  allProps: string[] = [],
  loggers?: LoggersType
) {
  const props: string[] = Reflect.getMetadata("props", target) || [];

  for (const prop of props) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    allProps.push(path);
    if (Reflect.getMetadata("isRef", target, prop)) {
      // 👇 here’s where you mutate
      (loggers ?? console).debug("Changing isRef:", path);

      // Example: replace with a proxy or a marker object
      instance[prop] = typeof instance[prop]  === "string" ? instance[prop] : instance[prop]._id;
    }

    // recurse into nested objects
    const type = Reflect.getMetadata("design:type", target, prop);
    if (type?.prototype) {
      const nestedProps = Reflect.getMetadata("props", type.prototype);
      if (nestedProps && instance[prop]) {
        processIsRefProperties(instance[prop], type.prototype, path, allProps);
      }
    }
  }
  return allProps;
}

export function getMetadataRecursive(
  metaKey: string,
  proto: any,
  prop: string
) {
  while (proto) {
    const meta = Reflect.getMetadata(metaKey, proto, prop);
    if (meta !== undefined) return meta;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

function checkForMissingRefs<C extends Constructor<any>>(data: IsData<InstanceType<C>>, props: any, classParam: C, autoClassers: { [key: string]: AutoUpdateManager<any>; }) {
  if (typeof data !== "string") {
    const entryKeys = Object.keys(data);
    for (const prop of props) {
      if (!entryKeys.includes(prop.toString()) &&
        getMetadataRecursive("isRef", classParam.prototype, prop.toString())) {
        (data as any)[prop] = Object.values(autoClassers).find((autoClasser) => autoClasser.getObject((data as any)[prop])
        );
      }
    }
  }
}