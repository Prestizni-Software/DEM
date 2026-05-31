import { EventEmitter } from "eventemitter3";
import { ObjectId, ObjectIdLike } from "bson";
import "reflect-metadata";

export type Pretty<T> = { [K in keyof T]: T[K] } & {};

export type BaseObjectKeys =
  | "preLoad"
  | "registerSocket"
  | "readyLoggers"
  | "loadFromDB"
  | "isLoaded"
  | "isPreLoadedAsync"
  | "loadMissingReferences"
  | "getValue"
  | "setValue"
  | "destroy"
  | "contactChildren"
  | "extractedData"
  | "onUpdate"
  | "properties"
  | "classParam"
  | "className"
  | "parentManager"
  | "callbacks"
  | "waitForPreloaded"
  | "loadFromDocument"
  | "socket"
  | "data"
  | "isServer"
  | "emitter"
  | "toChangeOnParents"
  | "checkedMissingRefs"
  | "isLoading"
  | "isLoadingReferences"
  | "EmitterID"
  | "loadShit"
  | "openSockets"
  | "handleUpdateRequest"
  | "generateSettersAndGetters"
  | "findReference"
  | "setValueInternal"
  | "makeUpdate"
  | "resolveReference"
  | "findAndLoadReferences"
  | "wipeSelf"
  | "loadForceReferences"
  | "handleLoad"
  | "createdWithParent"
  | "checkForMissingRefs"
  | "findMissingObjectReference"
  | "loadReferencesAsync";

export type MongoId = string | ObjectId | ObjectIdLike;
export type EventEmitter3 = EventEmitter;

export interface IDEMSocket {
    on(event: string, fn: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
    onAny?(fn: (event: string, ...args: any[]) => void): void;
    disconnect?(): void;
    disconnectSockets?(once: boolean): void;
    removeAllListeners?(event?: string): void;
}

// ---------------------- Core ----------------------

/**
 * Extracts data properties from a class, omitting base object methods and properties.
 */
export type Pure<T> = 0 extends (1 & T) ? Record<string, unknown> : Pretty<{ [K in keyof T as K extends BaseObjectKeys ? never : K]: T[K] }>;

export type InstanceOf<T> = T extends Constructor<infer I> ? I : T;

export type Constructor<T> = new (...args: any[]) => T;

export type LoggersType = {
  info: (s: string) => void;
  debug: (s: string) => void;
  error: (s: string) => void;
  warn: (s: string) => void;
};

type IsAUCO<T> = T extends { className: string } ? true : false;

type AllowStringForRefs<V> = 0 extends 1 & V
  ? V
  : NonNullable<V> extends Array<infer U>
    ? IsAUCO<NonNullable<U>> extends true
      ? (U | string | ObjectIdLike)[]
      : V
    : IsAUCO<NonNullable<V>> extends true
      ? V | string | ObjectIdLike
      : V;

/**
 * Checks if a type is 'any'. Returns 'unknown' if it is, otherwise returns the type itself.
 */
export type AnnihilateAny<T> = 0 extends (1 & T) ? unknown : T;

type OnlyStringForRefs<V> = 0 extends 1 & V
  ? V
  : NonNullable<V> extends Array<infer U>
    ? IsAUCO<NonNullable<U>> extends true
      ? string[]
      : V
    : IsAUCO<NonNullable<V>> extends true
      ? string
      : V;

export type Cache<T> = {
  references: Record<string, any>; // Complex circular manager references, difficult to type strictly here
};

// The upgraded IsData type
export type IsData<T> = 0 extends (1 & T) ? Record<string, unknown> : Pretty<{
  [K in keyof Pure<T>]: AllowStringForRefs<Pure<T>[K]>;
} & { _id: MongoId }>;

export type ExtractedData<T, Filter = never> = 0 extends (1 & T) ? Record<string, unknown> : Pretty<{
  [K in keyof Omit<Pure<T>, keyof Filter>]: OnlyStringForRefs<Pure<T>[K]>;
}>;

export type SocketEvent = [string, unknown, (res: ServerResponse<unknown>) => void];

export type ServerResponse<T> =
  | {
      data: T;
      message?: string;
      success: true;
    }
  | {
      message: string;
      success: false;
    };

export type ServerUpdateRequest<T> = {
  _id: MongoId;
  key: string;
  value: unknown;
};

export function classProp(target: object, propertyKey: string) {
  const props = (Reflect.getOwnMetadata("props", target) as string[] | undefined) || [];
  const newProps = [...props, propertyKey];
  Reflect.defineMetadata("props", newProps, target);
}

export function populatedRef(where: string) {
  return function (target: object, propertyKey: string) {
    classRef()(target, propertyKey);
    Reflect.defineMetadata("refsTo", where, target, propertyKey);
  };
}

export function classRef() {
  return function (target: object, propertyKey: string) {
    Reflect.defineMetadata("isRef", true, target, propertyKey);
  };
}

// ---------------------- Paths ----------------------
export type PathValueOf<T, P extends string> = P extends keyof T
  ? T[P]
  : never;

// Internal client events
export const EVENT_INTERNAL_PRE_LOADED = "pre-loaded";

// Server socket events
export const EVENT_UPDATE = "update";
export const EVENT_DELETE = "delete";
export const EVENT_NEW = "new";
export const EVENT_GET = "get";
export const EVENT_STARTUP = "startup";

export type GlobalCache = {
  objects: Record<string, { className: string; object: unknown }>;
};

export const globalCache: GlobalCache = {
  objects: {},
};
