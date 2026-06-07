import "reflect-metadata";
import _ from "lodash";
import { EVENT_INTERNAL_PRE_LOADED, EVENT_DELETE, EVENT_GET, EVENT_NEW, EVENT_UPDATE, globalCache, } from "./CommonTypes.js";
import { ObjectId } from "bson";
export class AutoUpdatedClientObject {
    entry;
    preLoad;
    registerSocket;
    readyLoggers;
    loadFromDB(a) { }
    setValue_(a, b) { }
    socket;
    data;
    isServer = false;
    loggers;
    isLoading = true;
    isLoadingReferences = true;
    checkedMissingRefs = false;
    emitter;
    properties;
    classParam;
    className;
    parentManager;
    EmitterID = new ObjectId().toHexString();
    toChangeOnParents = [];
    callbacks;
    loadReferencesAsync = async () => {
        try {
            if (!this.isLoaded) {
                await this.waitForPreloaded();
            }
            this.generateSettersAndGetters();
            await this.loadForceReferences();
            for (const thing of this.toChangeOnParents) {
                await this.setValue__(thing.key, thing.value, true, false, false, true);
            }
        }
        catch (error) {
            this.loggers.error("Error loading references: " + error.message);
        }
        finally {
            this.isLoadingReferences = false;
        }
    };
    /** @deprecated Use loadReferencesAsync instead */
    loadShit = this.loadReferencesAsync;
    constructor(classParam, socket, data, loggers, className, parentManager, callback, emitter, isServer = false) {
        if (!classParam ||
            !socket ||
            !data ||
            !loggers ||
            !className ||
            !parentManager ||
            !emitter) {
            this.classParam = classParam;
            this.socket = socket;
            this.data = data;
            this.loggers = loggers;
            this.className = className;
            this.parentManager = parentManager;
            this.callbacks = callback;
            this.emitter = emitter;
            this.properties = undefined;
            if (!classParam &&
                !socket &&
                !data &&
                !loggers &&
                !className &&
                !parentManager &&
                !callback &&
                !emitter)
                return;
            else
                throw new Error("Missing arguments???");
        }
        this.classParam = classParam;
        this.socket = socket;
        this.isServer = isServer;
        this.emitter = emitter;
        this.isLoadingReferences = true;
        this.isLoading = true;
        this.parentManager = parentManager;
        this.className = className;
        const allProps = new Set();
        let proto_ = classParam.prototype;
        while (proto_ && proto_ !== Object.prototype) {
            const props = Reflect.getOwnMetadata("props", proto_) || [];
            for (const p of props)
                allProps.add(p);
            proto_ = Object.getPrototypeOf(proto_);
        }
        this.properties = Array.from(allProps);
        this.callbacks = callback;
        this.loggers = {
            debug: (s) => loggers.debug(`[DEM - ${this.className}: ${this.data?._id ?? this._id ?? "not loaded"}] ${s}`),
            info: (s) => loggers.info(`[DEM - ${this.className}: ${this.data?._id ?? this._id ?? "not loaded"}] ${s}`),
            warn: (s) => loggers.warn(`[DEM - ${this.className}: ${this.data?._id ?? this._id ?? "not loaded"}] ${s}`),
            error: (s) => loggers.error(`[DEM - ${this.className}: ${this.data?._id ?? this._id ?? "not loaded"}] ${s}`),
        };
        if (typeof data === "string") {
            this.data = { _id: data };
            if (this.isServer) {
                this.isLoading = false;
                this.generateSettersAndGetters();
                return;
            }
            this.socket.emit(EVENT_GET + this.className + data, null, (res) => {
                if (!res.success) {
                    this.isLoading = false;
                    this.loggers.error("Could not load data from server: " + res.message);
                    this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
                    return;
                }
                this.data = res.data;
                this.generateSettersAndGetters();
                this.isLoading = false;
                this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
                this.openSockets();
            });
        }
        else {
            this.isLoading = true;
            this.data = data;
            for (const key of this.properties || []) {
                const isRef = getMetadataRecursive("isRef", this, key);
                if (isRef && this.data[key]) {
                    if (Array.isArray(this.data[key])) {
                        this.data[key] = this.data[key].map((obj) => obj._id?.toString() ?? obj?.toString());
                    }
                    else {
                        this.data[key] = this.data[key]?._id?.toString() ?? this.data[key]?.toString();
                    }
                }
            }
            if ((!this.data._id || this.data._id === "") && !this.isServer) {
                this.handleNewObject(data);
            }
            else {
                this.isLoading = false;
                if (!this.isServer)
                    this.openSockets();
            }
        }
        this.generateSettersAndGetters();
        // Re-apply getters in a microtask to override any shadowing from subclass field initializers.
        Promise.resolve().then(() => {
            this.generateSettersAndGetters();
        });
    }
    async waitForPreloaded() {
        if (this.isLoaded)
            return;
        await new Promise((resolve, reject) => {
            this.emitter.once(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, (failed, reason) => {
                if (failed)
                    reject(new Error(reason));
                else
                    resolve();
            });
        });
    }
    handleNewObject(data) {
        this.isLoading = true;
        this.socket.emit(EVENT_NEW + this.className, data, (res) => {
            if (!res.success) {
                this.isLoading = false;
                this.loggers.error("Could not create data on server: " + res.message);
                this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID, true, res.message);
                return;
            }
            this.data = res.data;
            this.generateSettersAndGetters();
            this.isLoading = false;
            this.emitter.emit(EVENT_INTERNAL_PRE_LOADED + this.EmitterID);
            if (!this.isServer)
                this.openSockets();
        });
    }
    get extractedData() {
        const extracted = processIsRefProperties(this.data, this, null, [], {}, this.loggers).newData;
        return _.cloneDeep(extracted);
    }
    get isLoaded() {
        return !this.isLoading;
    }
    async isPreLoadedAsync() {
        await this.loadShit();
        return true;
    }
    async loadMissingReferences() {
        await this.checkForMissingRefs();
        this.generateSettersAndGetters();
    }
    openSockets() {
        const id = this.data?._id ?? this._id;
        const event = EVENT_UPDATE + this.className + id.toString();
        this.socket.on(event, async (update, ack) => {
            const res = await this.handleUpdateRequest(update);
            if (ack && typeof ack === "function")
                ack(res);
            return res;
        });
    }
    async handleUpdateRequest(update) {
        try {
            await this.setValue__(update.key, update.value, true);
            if (this.isLoaded)
                this.callbacks.update(this, update.key);
            return { success: true, data: undefined, message: "" };
        }
        catch (error) {
            this.loggers.error(`[${this.data._id}] Error applying patch: ${error.message}`);
            return { success: false, message: "Error applying update: " + error.message };
        }
    }
    generateSettersAndGetters() {
        if (!this.properties)
            return;
        for (const key of this.properties) {
            if (typeof key !== "string")
                continue;
            const isRef = getMetadataRecursive("isRef", this, key);
            // CRITICAL: Delete any existing property on the instance to ensure our getter is used.
            delete this[key];
            Object.defineProperty(this, key, {
                get: () => {
                    if (!this.data)
                        return undefined;
                    let val = this.data[key];
                    if (val === null)
                        val = undefined; // Fix for server-side MongoDB nulls
                    if (isRef && val) {
                        if (Array.isArray(val)) {
                            return val.map((id) => this.findReference(id, key)).filter(Boolean);
                        }
                        else {
                            return this.findReference(val, key);
                        }
                    }
                    return val;
                },
                set: (v) => {
                    if (this.data)
                        this.data[key] = v;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }
    getValue(key_) {
        const key = key_;
        const parts = key.split(".");
        let value = this;
        for (const part of parts) {
            if (value === undefined || value === null)
                return undefined;
            // Try instance first (getters), then fallback to data
            const nextValue = value[part];
            if (nextValue !== undefined) {
                value = nextValue;
            }
            else if (value.data && value.data[part] !== undefined) {
                value = value.data[part];
            }
            else {
                return undefined;
            }
        }
        return value;
    }
    findReference(id, key) {
        if (!id)
            return undefined;
        const idStr = id.toString();
        if (this.parentManager.cache.references[key])
            return this.parentManager.cache.references[key].getObject(idStr);
        for (const manager of Object.values(this.parentManager.managers)) {
            const result = manager.getObject(idStr);
            if (result) {
                this.parentManager.cache.references[key] = manager;
                return result;
            }
        }
        return undefined;
    }
    async setValue(key, val) {
        return await this.setValue__(key, val);
    }
    async setValue__(key, val, silent = false, noGet = false, noUpdate = false, isParentUpdate = false) {
        try {
            const isRef = getMetadataRecursive("isRef", this, key);
            const pointer = getMetadataRecursive("refsTo", this, key);
            if (pointer && !isParentUpdate && !silent && !this.isServer) {
                throw new Error("Cannot set value of a reference pointer directly.");
            }
            let valueToStore = val;
            if (isRef) {
                valueToStore = Array.isArray(val)
                    ? val.map((v) => v._id?.toString() ?? v.toString())
                    : (val?._id ?? val?.toString() ?? val);
            }
            const currentVal = this.getValue(key);
            const currentValId = Array.isArray(currentVal)
                ? currentVal.map(v => v._id?.toString() ?? v.toString())
                : (currentVal?._id ?? currentVal?.toString());
            if (_.isEqual(currentValId, valueToStore))
                return { success: true, msg: "Successfully set " + key + " to " + val };
            const path = key.split(".");
            if (path.length > 1) {
                let obj = this.data;
                for (let i = 0; i < path.length - 1; i++) {
                    const currentKey = path[i];
                    if (typeof obj[currentKey] === 'string' || ObjectId.isValid(obj[currentKey])) {
                        const ref = await this.resolveReference(obj[currentKey].toString());
                        if (!ref)
                            throw new Error("Could not resolve reference on path: " + key);
                        return await ref.setValue(path.slice(i + 1).join("."), val);
                    }
                    obj = obj[currentKey];
                }
            }
            const res = await this.setValueInternal(key, valueToStore, silent, noUpdate);
            if (res.success) {
                const pathArr = key.split(".");
                let obj = this.data;
                for (let i = 0; i < pathArr.length - 1; i++) {
                    obj = obj[pathArr[i]];
                }
                obj[pathArr[pathArr.length - 1]] = valueToStore;
                await this.findAndLoadReferences(key, valueToStore);
                if (isRef && this.parentManager.isLoaded)
                    await this.contactChildren();
                if (this.isLoaded)
                    this.callbacks.update(this, key);
            }
            return { ...res, msg: res.msg ?? "Successfully set " + key + " to " + val };
        }
        catch (error) {
            this.loggers.error(`Error setting value ${key}: ${error.message}`);
            return { success: false, msg: error.message };
        }
    }
    async setValueInternal(key, value, silent = false, noUpdate = false) {
        if (silent)
            return { success: true, msg: "Silent" };
        return new Promise((resolve) => {
            const id = this.data?._id ?? this._id;
            this.socket.emit(EVENT_UPDATE + this.className + id, { _id: id.toString(), key, value }, (res) => {
                resolve({ success: res.success, msg: res.message ?? (res.success ? "Success" : "Error") });
            });
        });
    }
    makeUpdate(key, value) {
        const id = this.data?._id ?? this._id;
        if (!id) {
            this.loggers.error(`Probably missing the identifier ['_id'] again: ${key} = ${value}`);
            throw new Error(`Cannot make update for ${this.className} because _id is missing.`);
        }
        return { _id: id.toString(), key, value };
    }
    async resolveReference(id) {
        for (const manager of Object.values(this.parentManager.managers)) {
            const obj = manager.getObject(id);
            if (obj)
                return obj;
        }
        return null;
    }
    async findAndLoadReferences(lastPath, value) {
        const isRef = getMetadataRecursive("isRef", this, lastPath);
        if (isRef) {
            for (const id of Array.isArray(value) ? value : [value]) {
                if (!id)
                    continue;
                let result;
                for (const manager of Object.values(this.parentManager.managers)) {
                    result = manager.getObject(id?.toString());
                    if (result)
                        break;
                }
                if (result && typeof result.loadMissingReferences === "function") {
                    await result.loadMissingReferences();
                }
            }
        }
    }
    async wipeSelf() {
        if (this.data.Wiped)
            return;
        const id = this.data?._id ?? this._id;
        const _id = id ? id.toString() : "unknown";
        for (const key of Object.keys(this.data)) {
            delete this.data[key];
        }
        this.data = { Wiped: true };
        this.loggers.info(`[${_id}] ${this.className} object wiped`);
    }
    async loadForceReferences(obj = this.data, proto = this, alreadySeen = []) {
        const props = Reflect.getMetadata("props", proto) || [];
        for (const key of props) {
            if (typeof key !== "string")
                continue;
            const isRef = Reflect.getMetadata("isRef", proto, key);
            const pointer = Reflect.getMetadata("refsTo", proto, key);
            if (pointer && obj === this.data && obj[key] && !alreadySeen.includes(obj)) {
                await this.createdWithParent(pointer.split(":"), obj[key]);
            }
            if (obj[key] && !alreadySeen.includes(obj[key]))
                alreadySeen.push(obj[key]);
            if (isRef)
                await this.handleLoad(obj, key, alreadySeen);
            const val = obj[key];
            if (val && typeof val === "object") {
                const nestedProto = Object.getPrototypeOf(val);
                if (nestedProto && !alreadySeen.includes(val)) {
                    alreadySeen.push(val);
                    await this.loadForceReferences(val, nestedProto, alreadySeen);
                }
            }
        }
    }
    async handleLoad(obj, key, alreadySeen) {
        const refIds = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
        for (const refId of refIds) {
            if (refId) {
                const idStr = refId.toString();
                let result = globalCache.objects[idStr]?.object;
                if (!result) {
                    for (const manager of Object.values(this.parentManager.managers)) {
                        result = manager.getObject(idStr);
                        if (result)
                            break;
                    }
                }
                if (result && !alreadySeen.includes(idStr)) {
                    alreadySeen.push(idStr);
                    await result.loadForceReferences(undefined, undefined, alreadySeen);
                }
            }
        }
    }
    async onUpdate(noUpdate = false) {
        return;
    }
    async createdWithParent(pointer, parent) {
        if (pointer.length !== 2)
            return;
        const parentId = parent._id?.toString() ?? parent.toString();
        const obj = this.parentManager.managers[pointer[0]]?.getObject(parentId);
        if (!obj)
            return;
        const val = obj.getValue(pointer[1]);
        const myId = this.data._id.toString();
        if (Array.isArray(val)) {
            const ids = val.map(v => v._id?.toString() ?? v.toString());
            if (!ids.includes(myId)) {
                await obj.setValue__(pointer[1], [...val, myId], true, false, false, true);
            }
        }
        else if ((val?._id?.toString() ?? val?.toString()) !== myId) {
            await obj.setValue__(pointer[1], myId, true, false, false, true);
        }
    }
    async destroy(once = false) {
        if (!once)
            return await this.parentManager.deleteObject(this.data._id);
        return new Promise((resolve) => {
            this.socket.emit(EVENT_DELETE + this.className, this.data._id, (res) => {
                resolve({ success: res.success, message: res.message ?? "" });
            });
        });
    }
    async checkForMissingRefs() {
        for (const prop of this.properties) {
            const pointer = getMetadataRecursive("refsTo", this, prop.toString());
            if (pointer) {
                const parts = pointer.split(":");
                if (parts.length === 2)
                    await this.findMissingObjectReference(prop, parts);
            }
        }
    }
    async findMissingObjectReference(prop, pointer) {
        if (this.checkedMissingRefs)
            return;
        this.checkedMissingRefs = true;
        const ac = this.parentManager.managers[pointer[0]];
        if (!ac)
            return;
        const targetId = this.data._id.toString();
        const allObjects = Object.values(ac.objects);
        for (const obj of allObjects) {
            if (!obj.isLoaded)
                await obj.waitForPreloaded();
            const val = obj.getValue(pointer[1]);
            if (!val)
                continue;
            const ids = Array.isArray(val) ? val.map(v => v._id?.toString() ?? v.toString()) : [val._id?.toString() ?? val.toString()];
            if (ids.includes(targetId)) {
                this.data[prop] = obj._id;
                return;
            }
        }
    }
    async contactChildren() {
        for (const prop of this.properties) {
            const isRef = getMetadataRecursive("isRef", this, prop.toString());
            const pointer = getMetadataRecursive("refsTo", this, prop.toString());
            if (!isRef || pointer)
                continue;
            const obj = this.getValue(prop);
            if (!obj)
                continue;
            const children = Array.isArray(obj) ? obj : [obj];
            for (const child of children) {
                if (child && typeof child.loadMissingReferences === "function") {
                    await child.loadMissingReferences();
                }
            }
        }
    }
}
export function processIsRefProperties(instance, target, prefix, allProps, newData, loggers) {
    const props = Reflect.getMetadata("props", target) || [];
    for (const prop of props) {
        const path = prefix ? `${prefix}.${prop}` : prop;
        allProps.push(path);
        newData[prop] = ObjectId.isValid(instance[prop])
            ? instance[prop]?.toString()
            : instance[prop];
        if (Reflect.getMetadata("isRef", target, prop)) {
            if (Array.isArray(instance[prop]))
                newData[prop] = instance[prop]
                    .map((item) => item?._id?.toString() ?? item?.toString())
                    .filter(Boolean);
            else
                newData[prop] =
                    instance[prop]?._id?.toString() ?? instance[prop]?.toString();
        }
        const type = Reflect.getMetadata("design:type", target, prop);
        if (type?.prototype) {
            const nestedProps = Reflect.getMetadata("props", type.prototype);
            if (nestedProps && instance[prop]) {
                newData[prop] = processIsRefProperties(instance[prop], type.prototype, path, allProps, {}, loggers).newData;
            }
        }
    }
    return { allProps, newData };
}
export function getMetadataRecursive(metaKey, proto, prop) {
    while (proto) {
        const meta = Reflect.getMetadata(metaKey, proto, prop);
        if (meta)
            return meta;
        proto = Object.getPrototypeOf(proto);
    }
    return undefined;
}
//# sourceMappingURL=AutoUpdatedClientObjectClass.js.map