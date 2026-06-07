import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass, } from "./AutoUpdatedServerObjectClass.js";
import { EVENT_NEW, EVENT_UPDATE, EVENT_DELETE, EVENT_GET, EVENT_STARTUP, globalCache, } from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";
import a from "node-machine-id";
import { getModelForClass } from "@typegoose/typegoose";
export var DEMEventTypes;
(function (DEMEventTypes) {
    DEMEventTypes["new"] = "new";
    DEMEventTypes["update"] = "update";
    DEMEventTypes["delete"] = "delete";
    DEMEventTypes["get"] = "get";
    DEMEventTypes["startup"] = "startup";
})(DEMEventTypes || (DEMEventTypes = {}));
function setupSocketMiddleware(socket_server, loggers, managers, models) {
    socket_server.use(async (socket, next) => {
        socket.use((async (event, next) => {
            if (event.length !== 3 ||
                typeof event[0] !== "string" ||
                typeof event[2] !== "function") {
                loggers.warn("Invalid event: [" +
                    event.map((e) => JSON.stringify(e)).join("], [") +
                    "]");
                return;
            }
            if (!socket
                .eventNames()
                .some((e) => e.toString() === event[0] ||
                e.toString() === event[0].slice(0, -24))) {
                loggers.warn("Undefined event: [" +
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
                let demEvent = {};
                const id = e.slice(-24);
                switch (true) {
                    case e.startsWith(EVENT_NEW):
                        demEvent.type = DEMEventTypes.new;
                        demEvent.manager = managers[e.replace(EVENT_NEW, "")];
                        demEvent.data = event[1];
                        break;
                    case e.startsWith(EVENT_UPDATE):
                        demEvent.type = DEMEventTypes.update;
                        demEvent.manager =
                            managers[e.replace(EVENT_UPDATE, "").replace(id, "")];
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
                        demEvent.manager =
                            managers[e.replace(EVENT_GET, "").replace(id, "")];
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
                    next();
                }
                catch (error) {
                    loggers.warn("Someone got access denied:\nUser (" +
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
            catch (error) {
                loggers.error("Error with event: " +
                    event[0] +
                    "\nError: " +
                    error.message);
                return;
            }
        }));
        next();
    });
}
export async function AUSManagerFactory(defs, loggers, socket, disableDEMDebugMessages = false, emitter = new EventEmitter(), models) {
    readyLoggers(loggers);
    if (disableDEMDebugMessages) {
        loggers.debug = (_) => { };
    }
    socket.use((socket, next) => {
        socket.onAny((event) => {
            loggers.debug("Recieved event: " + event + " from client: " + socket.id);
        });
        next();
    });
    const managers = {};
    let i = 0;
    for (const key in defs) {
        loggers.debug(`Creating manager for ${key}`);
        const def = defs[key];
        const model = getModelForClass(def.class);
        try {
            const c = new AutoUpdateServerManager(def.class, key, loggers, socket, model, managers, emitter, def.options);
            managers[key] = c;
        }
        catch (error) {
            loggers.error("Error creating manager: " + key);
            loggers.error(error.message);
            loggers.error(error.stack);
            continue;
        }
        loggers.debug("Loading DB for manager: " + key);
        try {
            await managers[key].preLoad();
        }
        catch (error) {
            loggers.error("Error loading DB for manager: " + key);
            loggers.error(error.message);
            loggers.error(error.stack);
        }
    }
    for (const manager of Object.values(managers)) {
        try {
            manager.loadReferences();
        }
        catch (error) {
            loggers.error("Error loading DB for manager: " +
                manager.className +
                " (loadReferences)");
            loggers.error(error.message);
            loggers.error(error.stack);
        }
    }
    socket.on("connection", async (socket) => {
        loggers.debug(`Client connected: ${socket.id}`);
        for (const manager of Object.values(managers)) {
            manager.registerSocket(socket);
        }
        // Client disconnect
        socket.on("disconnect", () => {
            loggers.debug(`Client disconnected: ${socket.id}`);
        });
    });
    try {
        setupSocketMiddleware(socket, loggers, managers, models);
    }
    catch (error) {
        loggers.error("Error setting up socket middleware");
        loggers.error(error.message);
        loggers.error(error.stack);
    }
    return managers;
}
export class AutoUpdateServerManager extends AutoUpdateManager {
    model;
    clientSockets = new Set();
    options;
    objects_ = {};
    managers;
    constructor(classParam, className, loggers, socket, model, managers, emitter, options) {
        super(classParam, className, socket, loggers, managers, emitter);
        this.managers = managers;
        this.model = model;
        this.options = options;
    }
    async preLoad() {
        this.loggers.debug("Loading manager DB " + this.className);
        const docs = await this.model.find({});
        let i = 0;
        for (const doc of docs.map((d) => d._id.toString())) {
            if (!doc) {
                this.loggers.debug("Invalid document, no _id: " + JSON.stringify(docs[i]));
                continue;
            }
            i++;
            this.objects_[doc] =
                this.objects_[doc] ??
                    (await createAutoUpdatedClass(this.classParam, this.className, this.socket, doc, this.loggers, this, this.emitter));
            globalCache.objects[doc] = {
                className: this.className,
                object: this.objects_[doc],
            };
        }
        for (const object of this.objectsAsArray) {
            await object.isPreLoadedAsync();
            await object.contactChildren();
            await object.loadMissingReferences();
        }
        this.loggers.debug("Loaded manager DB " +
            this.className +
            " - [" +
            docs.length +
            "] entries");
    }
    registerSocket(socket) {
        this.clientSockets.add(socket);
        socket.on(EVENT_STARTUP + this.className, async (_, ack) => {
            try {
                const ids = ((await this.options?.accessDefinitions?.startupMiddleware?.(this.objectsAsArray, this.managers, socket))?.map((obj) => obj._id) ?? this.objectIDs).filter(Boolean);
                this.loggers.debug("Sending startup data for manager " + this.className);
                if (ids.some((id) => this.objects_[id] === "undefined"))
                    this.loggers.error(ids.find((id) => this.objects_[id] === "undefined"));
                ack({
                    data: { ids, properties: this.properties },
                    success: true,
                });
            }
            catch (error) {
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
        socket.on(EVENT_DELETE + this.className, async (id, ack) => {
            this.loggers.debug("Deleting object from manager " + this.className + " - " + id);
            try {
                await this.deleteObject(id);
                ack({
                    success: true,
                    message: "Deleted successfully",
                    data: undefined,
                });
            }
            catch (error) {
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
        socket.on(EVENT_NEW + this.className, async (data, ack) => {
            this.loggers.debug("Recieved new object creation in manager " + this.className);
            try {
                const newDoc = await this.createObject(data);
                ack({
                    data: newDoc.extractedData,
                    success: true,
                    message: "Created successfully",
                });
            }
            catch (error) {
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
                    if (typeof obj === "string")
                        throw new Error(`Never... failed to get object somehow: ${obj}`);
                    const res = await obj.setValue(data.key, data.value);
                    res.success
                        ? ack({
                            data: null,
                            success: res.success,
                            message: res.msg,
                        })
                        : ack({ success: res.success, message: res.msg });
                }
                catch (error) {
                    this.loggers.warn("Failed to update object in manager " + this.className);
                    ack({ success: false, message: error.message });
                }
            }
            else if (event.startsWith(EVENT_GET + this.className) &&
                event.replace(EVENT_GET + this.className, "").length === 24) {
                try {
                    const id = event.replace(EVENT_GET + this.className, "");
                    let obj = this.objects_[id];
                    ack({
                        data: obj.extractedData,
                        success: true,
                        message: "Updated successfully",
                    });
                }
                catch (error) {
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
    getObject(_id) {
        if (!_id)
            return null;
        return this.objects_[_id];
    }
    get objects() {
        return this.objects_;
    }
    get objectsAsArray() {
        return Object.values(this.objects_);
    }
    async handleGetMissingObject(_id) {
        if (this.getObject(_id))
            return this.getObject(_id);
        const document = await this.model.findById(_id);
        if (!document)
            throw new Error(`No document with id ${_id} in DB.`);
        if (!this.managers)
            throw new Error(`No managers.`);
        const object = await createAutoUpdatedClass(this.classParam, this.className, this.socket, document, this.loggers, this, this.emitter);
        await object.waitForPreloaded();
        this.objects_[object._id] = object;
        globalCache.objects[object._id] = { className: this.className, object };
        await object.isPreLoadedAsync();
        await object.loadMissingReferences();
        await object.contactChildren();
        return object;
    }
    async createObject(data) {
        if (!this.managers)
            throw new Error(`No managers.`);
        this.loggers.debug("Creating new object from manager " + this.className);
        delete data._id;
        const object = await createAutoUpdatedClass(this.classParam, this.className, this.socket, data, this.loggers, this, this.emitter);
        await object.waitForPreloaded();
        this.objects_[object._id] = object;
        globalCache.objects[object._id] = { className: this.className, object };
        await object.isPreLoadedAsync();
        await object.loadMissingReferences();
        await object.onUpdate();
        await object.contactChildren();
        for (const socket of this.clientSockets) {
            try {
                const theTruth = (await this.options?.accessDefinitions?.startupMiddleware?.([object], this.managers, socket)) ?? ["gay"];
                if (theTruth.length > 0) {
                    if (!object._id)
                        this.loggers.error("Object ID is undefined for object: " + object);
                    this.loggers.debug("Emitting new object " + object._id);
                    socket.emit("new" + this.className, object._id);
                }
            }
            catch (error) {
                const _ = error;
                this.loggers.error("Error when emitting new object to client: " + error.name);
                this.loggers.error(error.message);
                this.loggers.error(error.stack);
            }
            if (!object._id)
                throw new Error(`Never... failed to get object somehow: ${object}`);
            this.loggers.debug("Emitting new object " + object._id);
        }
        return object;
    }
}
function readyLoggers(loggers) {
    const warn = loggers.warn;
    loggers.warn = (s) => {
        if (s == "-_-" &&
            a.machineIdSync() ==
                "534d99b372d61249ade303f9fb4255e3e552e2731f8c455ba42b8f3bef19d8d2")
            for (let i = 0; i < 100; i++)
                loggers.warn("WE HAVE BEEN COMPROMISED!!!!!");
        warn(s);
    };
}
//# sourceMappingURL=AutoUpdateServerManagerClass.js.map