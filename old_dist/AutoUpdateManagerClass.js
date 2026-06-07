import { globalCache } from "./CommonTypes.js";
import "reflect-metadata";
export class AutoUpdateManager {
    isLoaded_ = false;
    socket;
    classParam;
    properties;
    className;
    cache = {
        references: {}
    };
    managers;
    preloaded = false;
    waitingToResolveReferences = {};
    loggers = {
        info: () => { },
        debug: () => { },
        error: () => { },
        warn: () => { },
    };
    emitter;
    constructor(classParam, className, socket, loggers, managers, emitter) {
        this.className = className;
        this.managers = managers;
        this.emitter = emitter;
        this.socket = socket;
        this.classParam = classParam;
        this.properties = Reflect.getMetadata("props", classParam.prototype);
        this.loggers.debug = (s) => loggers.debug("[DEM - " + className + " MANAGER] " + s);
        this.loggers.info = (s) => loggers.info("[DEM - " + className + " MANAGER] " + s);
        this.loggers.error = (s) => loggers.error("[DEM - " + className + " MANAGER] " + s);
        this.loggers.warn = (s) => loggers.warn("[DEM - " + className + " MANAGER] " + s);
    }
    get isLoaded() {
        return this.isLoaded_;
    }
    close() {
        for (const id of this.objectIDs) {
            delete this.objects_[id];
            delete globalCache.objects[id];
        }
        this.socket.disconnect?.() ?? this.socket.disconnectSockets(true);
        this.loggers.info("Goodbye, see you next time!");
    }
    async loadReferences() {
        for (const obj of this.objectsAsArray) {
            await obj.loadMissingReferences();
        }
        this.isLoaded_ = true;
    }
    async deleteObject(_id) {
        const o = this.objects_[_id];
        const res = await o?.destroy(true);
        if (res?.success) {
            delete this.objects_[_id];
            delete globalCache.objects[_id];
        }
        await o?.callbacks.delete(this);
        return res ?? { success: true, message: "Already gone" };
    }
    get objectIDs() {
        return Object.keys(this.objects_);
    }
}
//# sourceMappingURL=AutoUpdateManagerClass.js.map