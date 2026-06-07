import { Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { AutoUpdatedServerObject } from "./AutoUpdatedServerObjectClass.js";
import { Constructor, EventEmitter3, IsData, LoggersType, Pure } from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types.js";
import { Paths, PathValueOf } from "./CommonTypes_server.js";
export type WrappedInstances<T extends Record<string, AutoUpdatedServerObject<any>>> = {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
};
export type AUSDefinitions<T extends Record<string, AutoUpdatedServerObject<any>>> = {
    [K in keyof T]: ServerManagerDefinition<T[K], T>;
};
export type EventMiddlewareFunction<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = (event: DEMEvent<C>, managers: {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
}, socket: Socket) => Promise<void>;
export type StartupMiddlewareFunction<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = (ids: C[], managers: {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
}, socket: Socket) => Promise<C[]>;
export type AccessMiddleware<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = {
    eventMiddleware?: EventMiddlewareFunction<T, C>;
    startupMiddleware?: StartupMiddlewareFunction<T, C>;
};
export type AUSOption<C extends AutoUpdatedServerObject<any>, T extends Record<string, AutoUpdatedServerObject<any>>> = {
    accessDefinitions?: AccessMiddleware<T, C>;
    onUpdate?: (obj: C, set: <K extends Paths<C, AutoUpdatedServerObject<C>>>(key: K, val: PathValueOf<C, K>) => Promise<{
        success: boolean;
        msg: string;
    }>) => Promise<void>;
};
export type ServerManagerDefinition<C extends AutoUpdatedServerObject<any>, T extends Record<string, AutoUpdatedServerObject<any>>> = {
    class: Constructor<C>;
    options?: AUSOption<C, T>;
};
export declare enum DEMEventTypes {
    "new" = "new",
    "update" = "update",
    "delete" = "delete",
    "get" = "get",
    "startup" = "startup"
}
export type DEMEvent<C extends AutoUpdatedServerObject<C>> = {
    type: DEMEventTypes.delete | DEMEventTypes.get;
    manager: AutoUpdateServerManager<C>;
    object: C;
    data: never;
} | {
    type: DEMEventTypes.update;
    manager: AutoUpdateServerManager<C>;
    object: C;
    data: {
        _id: string;
        key: Paths<C, AutoUpdatedServerObject<C>>;
        value: any;
    };
} | {
    type: DEMEventTypes.startup;
    manager: AutoUpdateServerManager<C>;
    object: never;
    data: never;
} | {
    type: DEMEventTypes.new;
    manager: AutoUpdateServerManager<C>;
    object: never;
    data: IsData<C>;
};
export declare function AUSManagerFactory<T extends Record<string, AutoUpdatedServerObject<any>>>(defs: AUSDefinitions<T>, loggers: LoggersType, socket: Server, disableDEMDebugMessages?: boolean, emitter?: EventEmitter3, models?: any): Promise<{
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
}>;
export declare class AutoUpdateServerManager<T extends AutoUpdatedServerObject<any>> extends AutoUpdateManager<T> {
    readonly model: ReturnModelType<Constructor<T>, BeAnObject>;
    private readonly clientSockets;
    readonly options?: AUSOption<T, any>;
    protected objects_: {
        [_id: string]: T;
    };
    readonly managers: Record<string, AutoUpdateServerManager<AutoUpdatedServerObject<any>>>;
    constructor(classParam: Constructor<T>, className: string, loggers: LoggersType, socket: Server, model: ReturnModelType<Constructor<T>, BeAnObject>, managers: Record<string, AutoUpdateServerManager<AutoUpdatedServerObject<any>>>, emitter: EventEmitter3, options?: AUSOption<T, any>);
    preLoad(): Promise<void>;
    registerSocket(socket: Socket): void;
    getObject(_id?: string): T | null;
    get objects(): {
        [_id: string]: T;
    };
    get objectsAsArray(): T[];
    handleGetMissingObject(_id: string): Promise<T>;
    createObject(data: Omit<IsData<Pure<T, AutoUpdatedServerObject<any>>>, "_id">): Promise<T>;
}
