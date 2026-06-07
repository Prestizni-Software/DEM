import "reflect-metadata";
export function classProp(target, propertyKey) {
    const props = Reflect.getOwnMetadata("props", target) || [];
    const newProps = [...props, propertyKey];
    Reflect.defineMetadata("props", newProps, target);
}
export function populatedRef(where) {
    return function (target, propertyKey) {
        classRef()(target, propertyKey);
        Reflect.defineMetadata("refsTo", where, target, propertyKey);
    };
}
export function classRef() {
    return function (target, propertyKey) {
        Reflect.defineMetadata("isRef", true, target, propertyKey);
    };
}
// Internal client events
export const EVENT_INTERNAL_PRE_LOADED = "pre-loaded";
// Server socket events
export const EVENT_UPDATE = "update";
export const EVENT_DELETE = "delete";
export const EVENT_NEW = "new";
export const EVENT_GET = "get";
export const EVENT_STARTUP = "startup";
export const globalCache = {
    objects: {},
};
//# sourceMappingURL=CommonTypes.js.map