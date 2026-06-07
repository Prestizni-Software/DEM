import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { globalCache, } from "./CommonTypes.js";
import { EventEmitter } from "eventemitter3";
// ---------------------- Factory ----------------------
export async function AUCManagerFactory(defs, loggers, socket, doDebug = false, emitter = new EventEmitter(), callbacks = {}) {
    const defaultCallbacks = {
        new: callbacks.new ?? ((x) => { }),
        update: callbacks.update ?? ((x, y) => { }),
        delete: callbacks.delete ?? ((x) => { }),
        progress: callbacks.progress ?? ((x) => { }),
    };
    if (!doDebug) {
        loggers.debug = (_) => { };
    }
    let wholeProgress = 0;
    let numberOfManagers = Object.keys(defs).length || 1;
    const progressUpdater = callbacks.progress ?? ((x) => { });
    const innerProgressUpdater = (fraction) => {
        progressUpdater(wholeProgress + (numberOfManagers == 0 ? 1 : fraction / numberOfManagers));
        if (fraction == 1)
            wholeProgress += numberOfManagers == 0 ? 1 : fraction / numberOfManagers;
    };
    const managers = {};
    const startStartTime = Date.now();
    let startTime = Date.now();
    for (const key in defs) {
        try {
            const Model = defs[key];
            const c = new AutoUpdateClientManager(Model, key, loggers, socket, managers, emitter, {
                ...defaultCallbacks,
                ...callbacks[key],
                progress: innerProgressUpdater,
            });
            managers[key] = c;
        }
        catch (error) {
            if (error.message.includes("Local type does not match server type for manager"))
                throw error;
            let message = `Creating manager for: ${key}`;
            message += "\n Error creating manager: " + key;
            message += "\n " + error.message;
            loggers.error(message);
            loggers.error(error.stack);
            continue;
        }
    }
    loggers.debug("Created all managers in " + (Date.now() - startTime) + "ms");
    startTime = Date.now();
    const loadPromises = Object.keys(defs).map(async (key) => {
        let temp2 = { s: Date.now(), f: 0 };
        try {
            if (!managers[key]) {
                throw new Error(`Manager ${key} was not created due to previous error`);
            }
            await managers[key].loadFromServer(temp2);
            loggers.debug("Loaded data from server for manager: " +
                key +
                " in " +
                (temp2.f - temp2.s) +
                "ms");
        }
        catch (error) {
            if (error.message.includes("Local type does not match server type for manager"))
                throw error;
            let message = "Error loading data from server for manager: " + key;
            message += "\n " + error.message;
            message += "\n Failed in " + (temp2.f - temp2.s) + "ms";
            loggers.error(message);
            loggers.error(error.stack);
        }
    });
    await Promise.all(loadPromises);
    loggers.debug("Loaded data from server for all managers in " +
        (Date.now() - startTime) +
        "ms");
    loggers.info("Loaded all managers in " + (Date.now() - startStartTime) + "ms");
    return managers;
}
export class AutoUpdateClientManager extends AutoUpdateManager {
    objects_ = {};
    managers;
    callbacks;
    totalObjects = 0;
    loadedObjects = 0;
    constructor(classParam, className, loggers, socket, managers, emitter, callbacks) {
        super(classParam, className, socket, loggers, managers, emitter);
        this.managers = managers;
        this.callbacks = callbacks;
    }
    startSocketListeners() {
        this.socket.on("new" + this.className, async (id) => {
            this.loggers.debug("Applying new object from manager " + this.className + " - " + id);
            try {
                this.totalObjects += 1;
                await this.handleGetMissingObject(id);
                this.loadedObjects += 1;
            }
            catch (error) {
                this.loggers.error("Error loading object " +
                    id +
                    " from manager " +
                    this.className +
                    " - " +
                    error.message);
                this.loggers.error(error.stack);
            }
        });
        this.socket.on("delete" + this.className, async (id) => {
            this.loggers.debug("Applying object deletion from manager " + this.className + " - " + id);
            try {
                this.totalObjects -= 1;
                this.loadedObjects -= 1;
                await this.deleteObject(id);
            }
            catch (error) {
                this.loggers.error("Error applying object deletion from manager " +
                    this.className +
                    " - " +
                    id);
                this.loggers.error(error.message);
                this.loggers.error(error.stack);
            }
        });
    }
    async loadFromServer(t) {
        await new Promise((resolve, reject) => {
            this.socket.emit("startup" + this.className, null, async (res) => {
                if (!res.success) {
                    this.loggers.error("Error loading ids from server for manager");
                    this.loggers.error(res.message);
                    reject(new Error(res.message));
                    return;
                }
                const data = res.data;
                let extraProperties = [];
                for (const property of this.properties) {
                    if (typeof property !== "string")
                        throw new Error("Only string keys allowed. Not this shit: " + String(property));
                    if (data.properties.includes(property))
                        data.properties.splice(data.properties.indexOf(property), 1);
                    else
                        extraProperties.push(property);
                }
                let { allowedToLoad, errorMessage } = this.checkLoadability(extraProperties, data);
                if (!allowedToLoad) {
                    this.loggers.error(errorMessage);
                    reject(new Error(errorMessage));
                    return;
                }
                this.loggers.debug("Loading manager DB " +
                    this.className +
                    " - [" +
                    data.ids.length +
                    "] entries");
                // Only join and log if we're actually going to use the debug log
                if (this.loggers.debug && this.loggers.debug.toString().length > 15) {
                    this.loggers.debug(data.ids.join(", "));
                }
                this.totalObjects = data.ids.length;
                for (const id of data.ids) {
                    try {
                        this.objects_[id] = new this.classParam(this.classParam, this.socket, id, this.loggers, this.className, this, this.callbacks, this.emitter);
                        globalCache.objects[id] = {
                            className: this.className,
                            object: this.objects_[id],
                        };
                    }
                    catch (error) {
                        this.loggers.error("Error loading object " +
                            id +
                            " from manager " +
                            this.className +
                            " - " +
                            error.message);
                        this.loggers.error(error.stack);
                    }
                }
                const objectPromises = Object.keys(this.objects_).map(async (id) => {
                    const obj = this.objects_[id];
                    try {
                        await obj.isPreLoadedAsync();
                        await obj.loadMissingReferences();
                        this.loadedObjects += 1;
                        if (this.totalObjects < 100 || this.loadedObjects % Math.ceil(this.totalObjects / 100) === 0 || this.loadedObjects === this.totalObjects) {
                            this.callbacks.progress(this.loadedObjects / this.totalObjects);
                        }
                    }
                    catch (error) {
                        this.loggers.error("Error loading object " +
                            id +
                            " from manager " +
                            this.className +
                            " - " +
                            error.message);
                        this.loggers.error(error.stack);
                    }
                });
                await Promise.all(objectPromises);
                this.loggers.info("Loaded " + this.className + " - [" + Object.keys(this.objects_).length + "] entries");
                this.startSocketListeners();
                this.isLoaded_ = true;
                resolve();
            });
        });
        t ? (t.f = Date.now()) : void 0;
    }
    checkLoadability(extraProperties, data) {
        let allowedToLoad = true;
        let errorMessage = "Local type does not match server type for manager " + this.className;
        if (extraProperties.length > 0) {
            allowedToLoad = false;
            errorMessage +=
                "\n\nLocal type has " +
                    (extraProperties.length > 1
                        ? "these extra properties"
                        : "this extra property") +
                    ":\n" +
                    extraProperties.join("\n");
        }
        if (data.properties.length > 0) {
            allowedToLoad = false;
            errorMessage +=
                "\n\nLocal type is missing " +
                    (data.properties.length > 1 ? "these properties" : "this property") +
                    ":\n" +
                    data.properties.join("\n");
        }
        return { allowedToLoad, errorMessage };
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
        if (!_id)
            throw new Error("No id.");
        if (!this.managers)
            throw new Error(`No managers.`);
        if (this.objects_[_id])
            return this.objects_[_id];
        if (await new Promise((resolve, _) => this.socket.emit("startup" + this.className, null, async (res) => {
            if (res.success && res.data.ids.includes(_id))
                resolve(false);
            resolve(true);
        })))
            throw new Error("Non existent or not accesable.");
        const object = new this.classParam(this.classParam, this.socket, _id, this.loggers, this.className, this, this.callbacks, this.emitter);
        await object.waitForPreloaded();
        this.objects_[object._id] = object;
        globalCache.objects[object._id] = { className: this.className, object };
        await object.isPreLoadedAsync();
        await object.loadMissingReferences();
        this.callbacks.new(this);
        return object;
    }
    async createObject(data) {
        if (!this.managers)
            throw new Error(`No managers.`);
        this.loggers.debug("Creating new object from manager " + this.className);
        try {
            const object = new this.classParam(this.classParam, this.socket, data, this.loggers, this.className, this, this.callbacks, this.emitter);
            await object.waitForPreloaded();
            const id = object._id;
            this.objects_[id] = object;
            await this.objects_[id].isPreLoadedAsync();
            await this.objects_[id].loadMissingReferences();
            await this.objects_[id].contactChildren();
            this.callbacks.new(this.objects_[id]);
            return this.objects_[id];
        }
        catch (error) {
            this.loggers.error("Error creating new object from manager " + this.className);
            this.loggers.error(error.message);
            throw error;
        }
    }
}
//# sourceMappingURL=AutoUpdateClientManagerClass.js.map