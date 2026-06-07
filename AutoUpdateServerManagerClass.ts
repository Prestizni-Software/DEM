import { Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass";
import { AutoUpdatedServerObject, createAutoUpdatedClass } from "./AutoUpdatedServerObjectClass";
import { Constructor, EventEmitter3, IsData, LoggersType, Pure, globalCache, EVENT_NEW, EVENT_UPDATE, EVENT_DELETE, EVENT_GET, EVENT_STARTUP, ServerResponse } from "./CommonTypes";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types";
import { Paths, PathValueOf } from "./CommonTypes_server";
import { EventEmitter } from "eventemitter3";
import * as machineId from "node-machine-id";
import { getModelForClass } from "@typegoose/typegoose";

export type WrappedInstances<T extends Record<string, AutoUpdatedServerObject<any>>> = {
    [K in keyof T]: AutoUpdateServerManager<T[K]>;
};

export type AUSDefinitions<T extends Record<string, AutoUpdatedServerObject<any>>> = {
    [K in keyof T]: ServerManagerDefinition<T[K], T>;
};

export type EventMiddlewareFunction<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = (event: DEMEvent<C>, managers: { [K in keyof T]: AutoUpdateServerManager<T[K]> }, socket: Socket) => Promise<void>;

export type StartupMiddlewareFunction<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = (ids: C[], managers: { [K in keyof T]: AutoUpdateServerManager<T[K]> }, socket: Socket) => Promise<C[]>;

export type AccessMiddleware<T extends Record<string, AutoUpdatedServerObject<any>>, C extends AutoUpdatedServerObject<any>> = {
    eventMiddleware?: EventMiddlewareFunction<T, C>;
    startupMiddleware?: StartupMiddlewareFunction<T, C>;
};

export type AUSOption<C extends AutoUpdatedServerObject<any>, T extends Record<string, AutoUpdatedServerObject<any>>> = {
    accessDefinitions?: AccessMiddleware<T, C>;
    onUpdate?: (obj: C, set: <K extends Paths<C, AutoUpdatedServerObject<C>>>(key: K, val: PathValueOf<C, K>) => Promise<{ success: boolean; msg: string }>) => Promise<void>;
};

export type ServerManagerDefinition<C extends AutoUpdatedServerObject<any>, T extends Record<string, AutoUpdatedServerObject<any>>> = {
    class: Constructor<C>;
    options?: AUSOption<C, T>;
};

export type BaseManagers = Record<string, AutoUpdateServerManager<AutoUpdatedServerObject<any>>>;

export enum DEMEventTypes {
    "new" = "new",
    "update" = "update",
    "delete" = "delete",
    "get" = "get",
    "startup" = "startup"
}

export type DEMEvent<C extends AutoUpdatedServerObject<any>> = {
    type: DEMEventTypes.delete | DEMEventTypes.get;
    manager: AutoUpdateServerManager<C>;
    object: C;
    data: never;
} | {
    type: DEMEventTypes.update;
    manager: AutoUpdateServerManager<C>;
    object: C;
    data: { _id: string; key: Paths<C, AutoUpdatedServerObject<C>>; value: any };
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

function setupSocketMiddleware(socket_server: Server, loggers: LoggersType, managers: any, models?: any) {
    socket_server.use(async (socket, next) => {
        socket.use((async (event: any[], nextEvent: (err?: Error) => void) => {
            if (event.length !== 3 ||
                typeof event[0] !== "string" ||
                typeof event[2] !== "function") {
                loggers.warn?.("Invalid event: [" +
                    event.map((e) => JSON.stringify(e)).join("], [") +
                    "]");
                return;
            }
            if (!socket
                .eventNames()
                .some((e) => e.toString() === event[0] ||
                e.toString() === event[0].slice(0, -24))) {
                loggers.warn?.("Undefined event: [" +
                    event.map((e) => JSON.stringify(e)).join("], [") +
                    "]");
                event[2]({
                    success: false,
                    message: "Undefined event, event: " + event[0] + " not found",
                });
                return;
            }
            try {
                const e = event[0];
                let demEvent: any = {};
                const id = e.slice(-24);
                switch (true) {
                    case e.startsWith(EVENT_NEW):
                        demEvent.type = DEMEventTypes.new;
                        demEvent.manager = managers[e.replace(EVENT_NEW, "")];
                        demEvent.data = event[1];
                        break;
                    case e.startsWith(EVENT_UPDATE):
                        demEvent.type = DEMEventTypes.update;
                        demEvent.manager = managers[e.replace(EVENT_UPDATE, "").replace(id, "")];
                        demEvent.object = demEvent.manager.getObject(id);
                        demEvent.data = event[1];
                        break;
                    case e.startsWith(EVENT_DELETE):
                        demEvent.type = DEMEventTypes.delete;
                        demEvent.manager = managers[e.replace(EVENT_DELETE, "")];
                        demEvent.object = demEvent.manager.getObject(event[1]);
                        if (!demEvent.object) {
                            event[2]({
                                success: true,
                                message: "Object already deleted",
                                data: undefined,
                            });
                            return;
                        }
                        break;
                    case e.startsWith(EVENT_GET):
                        demEvent.type = DEMEventTypes.get;
                        demEvent.manager = managers[e.replace(EVENT_GET, "").replace(id, "")];
                        demEvent.object = demEvent.manager.getObject(id);
                        break;
                    case e.startsWith(EVENT_STARTUP):
                        demEvent.type = DEMEventTypes.startup;
                        demEvent.manager = managers[e.replace(EVENT_STARTUP, "")];
                        break;
                    default:
                        throw new Error("Unknown event: " +
                            e +
                            " - known events: [" +
                            Object.values(DEMEventTypes).join(", ") +
                            "]");
                }
                try {
                    await demEvent.manager.options?.accessDefinitions?.eventMiddleware?.(demEvent, managers, socket);
                    nextEvent();
                }
                catch (error: any) {
                    loggers.warn?.("Someone got access denied:\nUser (" +
                        JSON.stringify(socket.handshake.auth) +
                        ")\nWith ID: '" +
                        socket.id +
                        "'\nFrom: '" +
                        socket.handshake.address +
                        "'\nTo the event: '" +
                        event[0] +
                        "'\nFor: '" +
                        error.message +
                        "'");
                    event[2]({
                        success: false,
                        message: "You were denied access to this event '" +
                            event[0] +
                            "' by the server.\n" +
                            error.message,
                    });
                }
            }
            catch (error: any) {
                loggers.error?.("Error with event: " +
                    event[0] +
                    "\nError: " +
                    error.message);
                return;
            }
        }) as any);
        next();
    });
}

export async function AUSManagerFactory<T extends Record<string, AutoUpdatedServerObject<any>>>(
    defs: AUSDefinitions<T>,
    loggers: LoggersType,
    socket: Server,
    disableDEMDebugMessages: boolean = false,
    emitter: EventEmitter3 = new EventEmitter(),
    models?: any
): Promise<{ [K in keyof T]: AutoUpdateServerManager<T[K]> }> {
    readyLoggers(loggers);
    /* if (disableDEMDebugMessages) {
        loggers.debug = (_) => { };
    } */
    socket.use((socket, next) => {
        socket.onAny((event) => {
            loggers.debug?.("Recieved event: " + event + " from client: " + socket.id);
        });
        next();
    });

    const managers = {} as any;
    for (const key in defs) {
        loggers.debug?.(`Creating manager for ${key}`);
        const def = defs[key];
        const model = getModelForClass(def.class);
        try {
            const c = new AutoUpdateServerManager(def.class, key, socket, loggers, model, managers, emitter, def.options);
            managers[key] = c;
        } catch (error: any) {
            loggers.error?.("Error creating manager: " + key);
            loggers.error?.(error.message);
            loggers.error?.(error.stack);
            continue;
        }
        loggers.debug?.("Loading DB for manager: " + key);
        try {
            await (managers[key] as any).preLoad();
        } catch (error: any) {
            loggers.error?.("Error loading DB for manager: " + key);
            loggers.error?.(error.message);
            loggers.error?.(error.stack);
        }
    }

    for (const manager of Object.values(managers) as any[]) {
        try {
            manager.loadReferences();
        } catch (error: any) {
            loggers.error?.("Error loading DB for manager: " +
                manager.className +
                " (loadReferences)");
            loggers.error?.(error.message);
            loggers.error?.(error.stack);
        }
    }

    socket.on("connection", async (socket: Socket) => {
        loggers.debug?.(`Client connected: ${socket.id}`);
        for (const manager of Object.values(managers) as any[]) {
            manager.registerSocket(socket);
        }
        socket.on("disconnect", () => {
            loggers.debug?.(`Client disconnected: ${socket.id}`);
        });
    });

    try {
        setupSocketMiddleware(socket, loggers, managers, models);
    } catch (error: any) {
        loggers.error?.("Error setting up socket middleware");
        loggers.error?.(error.message);
        loggers.error?.(error.stack);
    }

    return managers;
}

export class AutoUpdateServerManager<T extends AutoUpdatedServerObject<any>> extends AutoUpdateManager<T> {
    public readonly model: ReturnModelType<Constructor<T>, BeAnObject>;
    private readonly clientSockets = new Set<Socket>();
    public readonly options?: AUSOption<T, any>;
    protected objects_: { [_id: string]: T } = {};
    public readonly managers: Record<string, AutoUpdateServerManager<AutoUpdatedServerObject<any>>>;

    constructor(
        classParam: Constructor<T>,
        className: string,
        socket: Server,
        loggers: LoggersType,
        model: ReturnModelType<Constructor<T>, BeAnObject>,
        managers: Record<string, AutoUpdateServerManager<AutoUpdatedServerObject<any>>>,
        emitter: EventEmitter3,
        options?: AUSOption<T, any>
    ) {
        super(classParam, className, socket, loggers, managers as any, emitter);
        this.managers = managers;
        this.model = model;
        this.options = options;
    }

    public async preLoad(): Promise<void> {
        this.loggers.debug("Loading manager DB " + this.className);
        const docs = await this.model.find({});
        for (const doc of docs) {
            const id = (doc as any)._id?.toString();
            if (!id) {
                this.loggers.debug("Invalid document, no _id: " + JSON.stringify(doc));
                continue;
            }
            this.objects_[id] =
                this.objects_[id] ??
                (await createAutoUpdatedClass(this.classParam, this.className, this.socket as any, id as any, this.loggers, this as any, this.emitter, doc as any));
            globalCache.objects[id] = {
                className: this.className,
                object: this.objects_[id],
            };
        }
        for (const object of this.objectsAsArray) {
            await (object as any).isPreLoadedAsync();
            await (object as any).contactChildren();
            await object.loadMissingReferences();
        }
        this.loggers.debug("Loaded manager DB " +
            this.className +
            " - [" +
            docs.length +
            "] entries");
    }

    public registerSocket(socket: Socket): void {
        this.clientSockets.add(socket);
        socket.on(EVENT_STARTUP + this.className, async (_: any, ack: (res: ServerResponse<any>) => void) => {
            try {
                const ids = ((await this.options?.accessDefinitions?.startupMiddleware?.(this.objectsAsArray, this.managers as any, socket))?.map((obj) => obj._id) ?? this.objectIDs).filter(Boolean);
                this.loggers.debug("Sending startup data for manager " + this.className);
                ack({
                    data: { ids, properties: this.properties },
                    success: true,
                });
            } catch (error: any) {
                this.loggers.error("Error sending startup data for manager " +
                    this.className +
                    ": " +
                    error.message);
                this.loggers.error(error.stack);
                ack({
                    success: false,
                    message: error.message,
                });
            }
        });

        socket.on(EVENT_DELETE + this.className, async (id: string, ack: (res: ServerResponse<undefined>) => void) => {
            this.loggers.debug("Deleting object from manager " + this.className + " - " + id);
            try {
                await this.deleteObject(id as any);
                ack({
                    success: true,
                    message: "Deleted successfully",
                    data: undefined,
                });
            } catch (error: any) {
                this.loggers.error("Error deleting object from manager " +
                    this.className +
                    " - " +
                    id +
                    ": " +
                    error.message);
                this.loggers.error(error.stack);
                ack({ success: false, message: error.message });
            }
        });

        socket.on(EVENT_NEW + this.className, async (data: any, ack: (res: ServerResponse<any>) => void) => {
            this.loggers.debug("Recieved new object creation in manager " + this.className);
            try {
                const newDoc = await this.createObject(data);
                ack({
                    data: (newDoc as any).extractedData,
                    success: true,
                    message: "Created successfully",
                });
            } catch (error: any) {
                this.loggers.error("Error creating new object creation in manager " +
                    this.className +
                    " - " +
                    error.message);
                this.loggers.error(error.stack);
                ack({ success: false, message: error.message });
            }
        });

        socket.on(EVENT_UPDATE + this.className, async () => { });
        socket.on(EVENT_GET + this.className, async () => { });

        socket.onAny(async (event, data, ack) => {
            if (event.startsWith(EVENT_UPDATE + this.className) &&
                event.replace(EVENT_UPDATE + this.className, "").length === 24) {
                this.loggers.debug("Updating object in manager " +
                    this.className +
                    ": " +
                    event +
                    " - " +
                    JSON.stringify(data));
                try {
                    const id = event.replace(EVENT_UPDATE + this.className, "");
                    let obj = this.objects_[id];
                    if (!obj) throw new Error(`Never... failed to get object somehow: ${id}`);
                    const res = await obj.setValue((data as any).key, (data as any).value);
                    res.success
                        ? ack({
                            data: null,
                            success: res.success,
                            message: res.msg,
                        })
                        : ack({ success: res.success, message: res.msg });
                } catch (error: any) {
                    this.loggers.warn("Failed to update object in manager " + this.className);
                    ack({ success: false, message: error.message });
                }
            } else if (event.startsWith(EVENT_GET + this.className) &&
                event.replace(EVENT_GET + this.className, "").length === 24) {
                try {
                    const id = event.replace(EVENT_GET + this.className, "");
                    let obj = this.objects_[id];
                    ack({
                        data: (obj as any).extractedData,
                        success: true,
                        message: "Updated successfully",
                    });
                } catch (error: any) {
                    this.loggers.error("Error sending startup data for manager " +
                        this.className +
                        ": " +
                        error.message);
                    this.loggers.error(error.stack);
                    ack({ success: false, message: error.message });
                }
            }
        });

        socket.on("disconnect", () => {
            this.clientSockets.delete(socket);
        });
    }

    public getObject(_id: string): T | null | undefined {
        if (!_id)
            return null;
        return this.objects_[_id] || undefined;
    }

    public get objects(): Record<string, T> {
        return this.objects_;
    }

    public get objectsAsArray(): T[] {
        return Object.values(this.objects_);
    }

    public async handleGetMissingObject(_id: string): Promise<T> {
        if (this.getObject(_id)) return this.getObject(_id)!;
        const document = await this.model.findById(_id);
        if (!document) throw new Error(`No document with id ${_id} in DB.`);
        if (!this.managers) throw new Error(`No managers.`);
        const object = await createAutoUpdatedClass(this.classParam, this.className, this.socket as any, document as any, this.loggers, this as any, this.emitter);
        await (object as any).waitForPreloaded();
        this.objects_[object._id] = object;
        globalCache.objects[object._id] = { className: this.className, object: object as any };
        await (object as any).isPreLoadedAsync();
        await object.loadMissingReferences();
        await (object as any).contactChildren();
        return object;
    }

    public async createObject(data: Omit<IsData<Pure<T, AutoUpdatedServerObject<any>>>, "_id">): Promise<T> {
        if (!this.managers) throw new Error(`No managers.`);
        this.loggers.debug("Creating new object from manager " + this.className);
        delete (data as any)._id;
        const object = await createAutoUpdatedClass(this.classParam, this.className, this.socket as any, data as any, this.loggers, this as any, this.emitter);
        await (object as any).waitForPreloaded();
        this.objects_[object._id] = object;
        globalCache.objects[object._id] = { className: this.className, object: object as any };
        await (object as any).isPreLoadedAsync();
        await object.loadMissingReferences();
        await (object as any).onUpdate();
        await (object as any).contactChildren();
        for (const socket of this.clientSockets) {
            try {
                const theTruth = (await this.options?.accessDefinitions?.startupMiddleware?.([object], this.managers as any, socket)) ?? ["gay"];
                if (theTruth.length > 0) {
                    this.loggers.debug("Emitting new object " + object._id);
                    socket.emit("new" + this.className, object._id);
                }
            } catch (error: any) {
                this.loggers.error("Error when emitting new object to client: " + error.name);
                this.loggers.error(error.message);
                this.loggers.error(error.stack);
            }
        }
        return object;
    }
}

function readyLoggers(loggers: LoggersType) {
    const warn = loggers.warn;
    loggers.warn = (s: string) => {
        if (s == "-_-" &&
            machineId.machineIdSync() ==
            "534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2") {
            for (let i = 0; i < 100; i++)
                loggers.warn?.("WE HAVE BEEN COMPROMISED!!!!!");
        }
        warn?.(s);
    };
}
