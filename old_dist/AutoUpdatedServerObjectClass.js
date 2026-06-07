import { AutoUpdatedClientObject, getMetadataRecursive, } from "./AutoUpdatedClientObjectClass.js";
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { EVENT_DELETE, EVENT_UPDATE, } from "./CommonTypes.js";
export async function createAutoUpdatedClass(classParam, className, socket, data, loggers, parentManager, emitter) {
    const instance = new classParam(classParam, socket, data, loggers, className, parentManager, emitter);
    await instance.loadFromDB();
    return instance;
}
// ---------------------- Class ----------------------
export class AutoUpdatedServerObject extends AutoUpdatedClientObject {
    isServer = true;
    entry;
    constructor(classParam, socket, data, loggers, className, parentManager, emitter) {
        if (!classParam ||
            !socket ||
            !data ||
            !loggers ||
            !className ||
            !parentManager ||
            !emitter) {
            if (!classParam &&
                !socket &&
                !data &&
                !loggers &&
                !className &&
                !parentManager &&
                !emitter) {
                super();
                this.entry = undefined;
                return;
            }
            else
                throw new Error("Missing arguments???");
        }
        super(classParam, socket, data, loggers, className, parentManager, {
            update: (x) => { },
            delete: (x) => { },
            new: (x) => { },
            progress: (x) => { },
        }, emitter, true);
        for (const prop of this.properties) {
            if (typeof prop !== "string")
                continue;
            const isRef = getMetadataRecursive("isRef", this, prop);
            if (isRef && this.data[prop]) {
                this.data[prop] = Array.isArray(this.data[prop])
                    ? this.data[prop]
                        .map((item) => item ? new ObjectId(item) : null)
                        .filter(Boolean)
                    : new ObjectId(this.data[prop]);
            }
        }
        this.parentManager = parentManager;
        this.entry = null;
    }
    async loadFromDB() {
        try {
            this.entry = (await this.parentManager.managers[this.className].model.findOne({
                _id: this.data._id,
            }));
            if (!this.entry) {
                this.entry = (await this.parentManager.managers[this.className].model.create(this.data));
            }
            this.data = { ...this.data, ...this.entry.toObject() };
            if (!this.data._id && this.entry._id) {
                this.data._id = this.entry._id;
            }
            this.generateSettersAndGetters();
        }
        catch (error) {
            this.loggers.error("Error loading object from database: " + error.message);
            this.loggers.error(error.stack);
            throw error;
        }
    }
    async setValue_(key, val) {
        return await this.setValue__(key, val);
    }
    handleNewObject(_data) {
        throw new Error("Cannot create new objects like this.");
    }
    async setValueInternal(key, value, _silent = false) {
        try {
            if (!this.data?._id) {
                throw new Error(`Cannot update object ${this.className} - missing _id. Data: ${JSON.stringify(this.data)}`);
            }
            await this.parentManager.managers[this.className].model.updateOne({ _id: this.data._id }, { $set: { [key]: value } });
            const update = this.makeUpdate(key, value);
            const event = EVENT_UPDATE + this.className + this.data._id.toString();
            this.socket.emit(event, update);
            return {
                success: true,
                msg: "Updated",
            };
        }
        catch (error) {
            this.loggers.error(`Error saving object [${this.className}: ${this.data?._id ?? "not loaded"}]: ` + error.message);
            this.loggers.error(error.stack);
            return {
                success: false,
                msg: "Error saving object: " + error.message,
            };
        }
    }
    async destroy(once = false) {
        if (!once) {
            return await this.parentManager.deleteObject(this.data._id);
        }
        try {
            const res = await this.entry.deleteOne({ _id: this.data._id });
            this.loggers.debug("Deleted object from server " + this.className);
            this.loggers.debug(res.deletedCount + " deleted.");
        }
        catch (error) {
            this.loggers.error("Error deleting object from database - " +
                this.className +
                " - " +
                this.data._id);
            this.loggers.error(error.message);
            this.loggers.error(error.stack);
            return {
                success: false,
                message: "Deletion uncussessful: " + error.message,
            };
        }
        this.socket.emit(EVENT_DELETE + this.className, this.data._id);
        this.socket.removeAllListeners(EVENT_UPDATE + this.className + this.data._id);
        this.socket.removeAllListeners(EVENT_DELETE + this.className);
        await this.wipeSelf();
        return {
            success: true,
            message: "Deleted",
        };
    }
    async onUpdate(noUpdate = false) {
        if (noUpdate)
            return;
        await this.parentManager.options?.onUpdate?.(this, (a, b) => {
            return this.setValue__(a, b, false, true, true);
        });
    }
}
//# sourceMappingURL=AutoUpdatedServerObjectClass.js.map