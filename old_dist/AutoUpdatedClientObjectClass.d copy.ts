import "reflect-metadata";
import { Constructor, EventEmitter3, IsData, LoggersType, PathValueOf, ServerUpdateRequest, Paths, OnlyAddedKeys, ExtractedData } from "./CommonTypes.js";
import { ObjectId } from "bson";
import { Socket } from "socket.io-client";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
export type DEMClientCallbacks<T> = {
    new: (obj: T) => Promise<void> | void;
    update: (obj: T, key: string) => Promise<void> | void;
    delete: (obj: T) => Promise<void> | void;
    progress: (percent: number) => void;
};
type SocketType = Socket<any, any>;
export declare abstract class AutoUpdatedClientObject<T> {
    protected entry: any;
    preLoad: any;
    registerSocket: any;
    readyLoggers: any;
    loadFromDB(a: any): any;
    setValue_(a: any, b: any): any;
    protected readonly socket: SocketType;
    protected data: IsData<T>;
    protected readonly isServer: boolean;
    abstract readonly _id: any;
    protected readonly loggers: LoggersType;
    protected isLoading: boolean;
    protected isLoadingReferences: boolean;
    protected checkedMissingRefs: boolean;
    protected readonly emitter: EventEmitter3;
    readonly properties: (keyof OnlyAddedKeys<T, AutoUpdatedClientObject<T>>)[];
    readonly classParam: Constructor<T>;
    readonly className: string;
    parentManager: AutoUpdateManager<AutoUpdatedClientObject<T>>;
    private readonly EmitterID;
    protected readonly toChangeOnParents: {
        key: string;
        value: any;
    }[];
    callbacks: DEMClientCallbacks<T>;
    private readonly loadReferencesAsync;
    /** @deprecated Use loadReferencesAsync instead */
    private readonly loadShit;
    constructor(classParam?: Constructor<T>, socket?: SocketType, data?: string | IsData<T>, loggers?: LoggersType, className?: string, parentManager?: AutoUpdateManager<any>, callback?: DEMClientCallbacks<T>, emitter?: EventEmitter3, isServer?: boolean);
    waitForPreloaded(): Promise<void>;
    protected handleNewObject(data: IsData<T>): void;
    get extractedData(): ExtractedData<T, AutoUpdatedClientObject<T>>;
    get isLoaded(): boolean;
    isPreLoadedAsync(): Promise<boolean>;
    loadMissingReferences(): Promise<void>;
    private openSockets;
    private handleUpdateRequest;
    protected generateSettersAndGetters(): void;
    getValue(key_: Paths<T, AutoUpdatedClientObject<unknown>>): any;
    protected findReference(id: string | ObjectId, key: string): any;
    setValue<K extends Paths<T, AutoUpdatedClientObject<T>>>(key: K, val: PathValueOf<IsData<T>, K>): Promise<{
        success: boolean;
        msg: string;
    }>;
    protected setValue__(key: any, val: any, silent?: boolean, noGet?: boolean, noUpdate?: boolean, isParentUpdate?: boolean): Promise<{
        success: boolean;
        msg: string;
    }>;
    protected setValueInternal(key: string, value: any, silent?: boolean, noUpdate?: boolean): Promise<{
        success: boolean;
        msg: string;
    }>;
    protected makeUpdate(key: string, value: any): ServerUpdateRequest<T>;
    protected resolveReference(id: string): Promise<AutoUpdatedClientObject<any> | null>;
    private findAndLoadReferences;
    protected wipeSelf(): Promise<void>;
    private loadForceReferences;
    private handleLoad;
    onUpdate(noUpdate?: boolean): Promise<void>;
    protected createdWithParent(pointer: string[], parent: T | string): Promise<void>;
    destroy(once?: boolean): Promise<{
        success: boolean;
        message: string;
    }>;
    private checkForMissingRefs;
    private findMissingObjectReference;
    contactChildren(): Promise<void>;
}
export declare function processIsRefProperties(instance: any, target: any, prefix: string | null, allProps: string[], newData: any, loggers: LoggersType): {
    allProps: string[];
    newData: any;
};
export declare function getMetadataRecursive(metaKey: string, proto: any, prop: string): any;
export {};
