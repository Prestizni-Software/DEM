import {EventEmitter} from "eventemitter3";
import { ObjectId } from "bson";
import "reflect-metadata";
import { AutoUpdated } from "./AutoUpdateClientManagerClass";

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
  info: (s:string) => void;
  debug: (s:string) => void;
  error: (s:string) => void;
  warn: (s:string) => void;
};

export type IsData<T> = T extends { _id: any } ? T : never;

export type SocketEvent = [string, any, (res:ServerResponse<any>) => void]

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
export type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
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
export type Join<K extends string, P extends string> = `${K}.${P}`;
export type OnlyClassKeys<T> = {
  [K in keyof T]: K;
}[keyof T] &
  string;
export type Split<S extends string> = S extends `${infer L}.${infer R}`
  ? [L, ...Split<R>]
  : [S];
export type NonOptional<T> = Exclude<T, null | undefined>;

export type DeAutoUpdate<T> = T extends AutoUpdated<infer I> ? I | string | T : T;

export type PathValueOf<
  T,
  P extends string,
  Depth extends number = 6
> = PathValue<DeAutoUpdate<InstanceOf<T>>, Split<P>, Depth>; // ---------------------- PathValueOf ----------------------

export type PathValue<
  T,
  Parts extends string[],
  Depth extends number = 5
> = Depth extends 0
  ? never
  : T extends unknown
  ? Parts extends [infer K, ...infer Rest]
    ? K extends string
      ? K extends keyof T
        ? Rest extends string[]
          ? Rest["length"] extends 0
            ? DeAutoUpdate<T[K]>
            : PathValue<T[K], Rest, Prev[Depth]>
          : never
        : never
      : never
    : DeAutoUpdate<T>
  : never; // ---------------------- Paths ----------------------
export type Paths<
  T,
  Depth extends number = 5,
  OriginalDepth extends number = Depth
> = Depth extends never
  ? never
  : {
      [K in OnlyClassKeys<NonOptional<T>>]: K extends "_id"
        ? StripPrototypePrefix<`${K}`>
        : StripPrototypePrefix<
            PathsHelper<K, NonOptional<T>[K], Depth, OriginalDepth>
          >;
    }[OnlyClassKeys<NonOptional<T>>];
type PathsHelper<
  K extends string,
  V,
  Depth extends number,
  OriginalDepth extends number
> = Recurseable<V> extends never
  ? `${K}`
  : `${K}` | Join<K, Paths<NonOptional<V>, Prev[Depth], OriginalDepth>>;

