import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { AutoUpdatedClientObject, DEMClientCallbacks } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, IsData, LoggersType, Pure } from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";
export type WrappedInstances<T extends Record<string, Constructor<AutoUpdatedClientObject<any>>>> = {
    [K in keyof T]: AutoUpdateClientManager<InstanceType<T[K]>>;
};
export declare function AUCManagerFactory<T extends Record<string, Constructor<AutoUpdatedClientObject<any>>>>(defs: T, loggers: LoggersType, socket: Socket, doDebug?: boolean, emitter?: EventEmitter, callbacks?: Partial<{
    [K in keyof T]: Partial<DEMClientCallbacks<InstanceType<T[K]>>>;
} & Partial<DEMClientCallbacks<any>>>): Promise<WrappedInstances<T>>;
export declare class AutoUpdateClientManager<T extends AutoUpdatedClientObject<any>> extends AutoUpdateManager<T> {
    protected objects_: {
        [_id: string]: T;
    };
    readonly managers: Record<string, AutoUpdateClientManager<AutoUpdatedClientObject<any>>>;
    callbacks: DEMClientCallbacks<T>;
    socket: Socket;
    totalObjects: number;
    loadedObjects: number;
    constructor(classParam: Constructor<T>, className: string, loggers: LoggersType, socket: Socket, managers: Record<string, AutoUpdateClientManager<AutoUpdatedClientObject<any>>>, emitter: EventEmitter, callbacks: DEMClientCallbacks<T>);
    private startSocketListeners;
    loadFromServer(t?: {
        s: number;
        f: number;
    }): Promise<void>;
    private checkLoadability;
    getObject(_id?: string): T | null;
    get objects(): {
        [_id: string]: T;
    };
    get objectsAsArray(): T[];
    handleGetMissingObject(_id: string): Promise<T>;
    createObject(data: Omit<IsData<Pure<T>>, "_id">): Promise<T>;
}
