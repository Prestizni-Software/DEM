import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { Constructor, EventEmitter3, LoggersType, Cache } from "./CommonTypes.js";
import "reflect-metadata";
export declare abstract class AutoUpdateManager<T extends AutoUpdatedClientObject<any>> {
    protected abstract objects_: {
        [_id: string]: T;
    };
    protected isLoaded_: boolean;
    readonly socket: any;
    protected classParam: Constructor<T>;
    protected properties: (keyof T)[];
    readonly className: string;
    readonly cache: Cache<any>;
    readonly managers: Record<string, AutoUpdateManager<AutoUpdatedClientObject<any>>>;
    protected preloaded: boolean;
    protected waitingToResolveReferences: {
        [_id: string]: string;
    };
    protected loggers: LoggersType;
    protected emitter: EventEmitter3;
    constructor(classParam: Constructor<T>, className: string, socket: any, loggers: LoggersType, managers: Record<string, AutoUpdateManager<AutoUpdatedClientObject<any>>>, emitter: EventEmitter3);
    get isLoaded(): boolean;
    close(): void;
    loadReferences(): Promise<void>;
    deleteObject(_id: string): Promise<{
        success: boolean;
        message: string;
    }>;
    get objectIDs(): string[];
    abstract handleGetMissingObject(_id: string): Promise<T>;
    abstract createObject(data: Omit<any, "_id">): Promise<T>;
    abstract getObject(_id: string): T | null;
    abstract get objects(): {
        [_id: string]: T;
    };
    abstract get objectsAsArray(): T[];
}
