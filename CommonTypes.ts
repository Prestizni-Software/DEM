import { EventEmitter } from "eventemitter3";
import { ObjectId, ObjectIdLike } from "bson";
import "reflect-metadata";
import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass";
import { AutoUpdateManager } from "./AutoUpdateManagerClass";

type RefType = string | ObjectId;
export type EventEmitter3 = EventEmitter;
// ---------------------- Core ----------------------
export type AutoProps<T> = {
  readonly [K in keyof T]: T[K];
};
export type InstanceOf<T> = T extends Constructor<infer I> ? I : T;

export type Constructor<T> = new (...args: any[]) => T;
export type UnboxConstructor<T> = T extends new (...args: any[]) => infer I
  ? I
  : T;

export type LoggersType = {
  info: (s: string) => void;
  debug: (s: string) => void;
  error: (s: string) => void;
  warn: (s: string) => void;
};
type IsAUCO<T> = T extends { className: string } ? true : false;
type AllowStringForRefs<V> =
  NonNullable<V> extends Array<infer U>
    ? IsAUCO<NonNullable<U>> extends true
      ? (U | string | ObjectIdLike)[]
      : V
    : IsAUCO<NonNullable<V>> extends true
      ? V | string | ObjectIdLike
      : V;

type OnlyStringForRefs<V> =
  NonNullable<V> extends Array<infer U>
    ? IsAUCO<NonNullable<U>> extends true
      ? (string)[]
      : V
    : IsAUCO<NonNullable<V>> extends true
      ? string
      : V;

export type Cache<T> = {
  references:{
    [K in keyof T]?: AutoUpdateManager<AutoUpdatedClientObject<any>>
  }
}

// The upgraded IsData type
export type IsData<T> = {
  [K in keyof T]: AllowStringForRefs<T[K]>;
} & { _id: any };

export type ExtractedData<T, Base = AutoUpdatedClientObject<T>> = {
    [K in keyof FixPure<T, Base>]: OnlyStringForRefs<T[K]>;
};
type FixPure<T, Base> = Omit<T, keyof Omit<Base, "_id">>;
export type SocketEvent = [string, any, (res: ServerResponse<any>) => void];

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
  _id: RefType;
  key: string;
  value: any;
};

export function classProp(target: any, propertyKey: string) {
  const props = Reflect.getMetadata("props", target) || [];
  props.push(propertyKey);
  Reflect.defineMetadata("props", props, target);
}

export function populatedRef(where: string) {
  return function (target: any, propertyKey: string) {
    classRef()(target, propertyKey);
    Reflect.defineMetadata("refsTo", where, target, propertyKey);
  };
}

export function classRef() {
  return function (target: any, propertyKey: string) {
    Reflect.defineMetadata("isRef", true, target, propertyKey);
  };
}

export type Pretty<T> = { [K in keyof T]: T[K] }; // ---------------------- Paths ----------------------

export type StripPrototypePrefix<P extends string> = P extends "prototype"
  ? never
  : P extends `prototype.${infer Rest}`
    ? Rest
    : P;
export type Recurseable<T> = T extends object
  ? T extends Array<any> | Function
    ? never
    : T
  : never;

export type OnlyClassKeys<T> = {
  [K in keyof T]: K;
}[keyof T] &
  string;
export type Split<S extends string> = S extends `${infer L}.${infer R}`
  ? [L, ...Split<R>]
  : [S];
export type NonOptional<T> = Exclude<T, null | undefined>;

export type DeAutoUpdate<T> =
  T extends AutoUpdatedClientObject<infer U> ? U : T;

export type RecursiveDeAutoUpdate<T extends AutoUpdatedClientObject<any>> =
  T extends AutoUpdatedClientObject<infer U>
    ? U extends object
      ? DeAutoUpdate<U>
      : U
    : T;

export type OnlyAddedKeys<Sub, Parent> = Pick<
  Sub,
  Exclude<keyof Sub, keyof Omit<Parent, "_id">>
>;
export type Prev = [never, 0, 1, 2, 3];

// 3. String Joiner
export type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

// 4. The Paths Type leveraging OnlyAddedKeys
export type Paths<T, Base, D extends number = 3> = [D] extends [never]
  ? never
  : NonNullable<T> extends object
    ? {
        // We only iterate over the keys that survive your OnlyAddedKeys filter
        [K in keyof OnlyAddedKeys<NonNullable<T>, Base> &
          string]-?: NonNullable<NonNullable<T>[K]> extends Function
          ? never
          : NonNullable<NonNullable<T>[K]> extends Array<any> | Date | ObjectId
            ? K // Stop dotting into Arrays, Dates, or ObjectIds
            : NonNullable<NonNullable<T>[K]> extends object
              ?
                  | K
                  | Join<
                      K,
                      Paths<NonNullable<NonNullable<T>[K]>, Base, Prev[D]>
                    > // Recurse, passing Base down
              : K; // Resolves primitives
      }[keyof OnlyAddedKeys<NonNullable<T>, Base> & string] // Output the union of keys
    : never;
// 5. Value Resolver (Stays the same, as it just reads the final path)
export type PathValueOf<
  T,
  P extends string,
> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof NonNullable<T>
    ? PathValueOf<NonNullable<NonNullable<T>[K]>, Rest>
    : never
  : P extends keyof NonNullable<T>
    ? NonNullable<T>[P]
    : never;
    
export type Pure<T, Base = AutoUpdatedClientObject<T>> = FixPure<T, Base>;

export const EVENT_PRE_LOADED = "pre-loaded";
export const EVENT_UPDATE = "update";
export const EVENT_DELETE = "delete";
export const EVENT_NEW = "new";
export const EVENT_GET = "get";

