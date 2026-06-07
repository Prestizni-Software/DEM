import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { AutoUpdateServerManager } from "./AutoUpdateServerManagerClass.js";
import "reflect-metadata";
import { DefaultEventsMap, Server } from "socket.io";
import { Constructor, LoggersType, EventEmitter3, IsData } from "./CommonTypes.js";
import { Paths, PathValueOf } from "./CommonTypes_server.js";
import { DocumentType } from "@typegoose/typegoose";
type SocketType = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;
export declare function createAutoUpdatedClass<C extends AutoUpdatedServerObject<C>>(classParam: Constructor<C>, className: string, socket: SocketType, data: IsData<C>, loggers: LoggersType, parentManager: AutoUpdateServerManager<any>, emitter: EventEmitter3): Promise<C>;
export declare abstract class AutoUpdatedServerObject<T> extends AutoUpdatedClientObject<T> {
    protected readonly isServer: boolean;
    protected entry: DocumentType<T>;
    parentManager: AutoUpdateServerManager<AutoUpdatedServerObject<T>>;
    constructor();
    constructor(classParam: Constructor<T>, socket: SocketType, data: IsData<T>, loggers: LoggersType, className: string, parentManager: AutoUpdateServerManager<any>, emitter: EventEmitter3);
    loadFromDB(): Promise<void>;
    setValue_<K extends Paths<T, AutoUpdatedServerObject<T>>>(key: K, val: PathValueOf<IsData<T>, K>): Promise<{
        success: boolean;
        msg: string;
    }>;
    protected handleNewObject(_data: any): void;
    protected setValueInternal(key: any, value: any, _silent?: boolean): Promise<{
        success: boolean;
        msg: string;
    }>;
    destroy(once?: boolean): Promise<{
        success: boolean;
        message: string;
    }>;
    onUpdate(noUpdate?: boolean): Promise<void>;
}
export {};
