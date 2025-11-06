import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, IsData, LoggersType } from "./CommonTypes.js";
export type WrappedInstances<T extends Record<string, Constructor<any>>> = {
  [K in keyof T]: AutoUpdateClientManager<T[K]>;
};
// ---------------------- Factory ----------------------
export async function AUCManagerFactory<
  T extends Record<string, Constructor<any>>
>(defs: T, loggers: LoggersType, socket: Socket): Promise<WrappedInstances<T>> {
  const classers = {} as WrappedInstances<T>;

  for (const key in defs) {
    const Model = defs[key];
    const c = new AutoUpdateClientManager(
      Model,
      loggers,
      socket,
      classers as any
    );
    classers[key] = c;
  }

  return classers;
}

export class AutoUpdateClientManager<
  T extends Constructor<any>
> extends AutoUpdateManager<T> {
  constructor(
    classParam: T,
    loggers: LoggersType,
    socket: Socket,
    classers: Record<string, AutoUpdateManager<any>>
  ) {
    super(classParam, socket, loggers, classers);
    socket.emit("startup" + classParam.name, async (data: string[]) => {
      for (const id of data) {
        this.classes[id] = await this.handleGetMissingObject(id);
        this.classesAsArray.push(this.classes[id]);
      }
    });
    socket.on("new" + classParam.name, async (id: string) => {
      this.classes[id] = await this.handleGetMissingObject(id);
      this.classesAsArray.push(this.classes[id]);
    });
    socket.on("delete" + classParam.name, (id: string) => {
      this.deleteObject(id);
    });
  }

  protected async handleGetMissingObject(_id: string) {
    if (!this.classers) throw new Error(`No classers.`);
    return await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      _id,
      this.loggers,
      this.classers
    );
  }

  public async createObject(data: IsData<InstanceType<T>>) {
    if (!this.classers) throw new Error(`No classers.`);
    const object = await createAutoUpdatedClass(
      this.classParam,
      this.socket,
      data,
      this.loggers,
      this.classers
    );
    this.classes[object._id as any] = object;
    return object;
  }
}
