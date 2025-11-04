import { DefaultEventsMap, Server } from "socket.io";
import { Socket as SocketClient } from "socket.io-client";
import { ObjectId } from "bson";
import { Ref } from "@typegoose/typegoose";
import { Test } from "./server.js";
export type LoggersTypeInternal = LoggersType & {
  warn: (...args: any[]) => void;
};

export type LoggersType = {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
};
export type SocketType =
  | SocketClient<DefaultEventsMap, DefaultEventsMap>
  | Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;
export type IsData<T> = T extends { _id: string | ObjectId } ? T : never;
export type ServerResponse<T> =
  | {
      data: T; // in this case, the applied patch
      message: string;
      success: true;
    }
  | {
      data?: null;
      message: string;
      success: false;
    };

export type ServerUpdateResponse<T> = {
  data: Partial<IsData<T>>;
  message: string;
  success: true;
  updateId: string;
};

export type ServerUpdateRequest<T> = {
  _id: string;
  key: string;
  value: any;
};
export function classProp(target: any, propertyKey: string) {
  const props = Reflect.getMetadata("props", target) || [];
  props.push(propertyKey);
  Reflect.defineMetadata("props", props, target);
}

export function classRef(target: any, propertyKey: string) {
  Reflect.defineMetadata("isRef", true, target, propertyKey);
}

// ---------------------- Core ----------------------
export type AutoProps<T> = {
  readonly [K in keyof T]: T[K];
};

export type Constructor<T> = new (...args: any[]) => T;
export type UnboxConstructor<T> = T extends new (...args: any[]) => infer I
  ? I
  : T;

// ---------------------- DeRef ----------------------
export type NonOptional<T> = Exclude<T, null | undefined>;

export type DeRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer U>
    ? NonOptional<U>
    : T[K] extends Ref<infer U> | null | undefined
    ? NonOptional<U>
    : NonOptional<T[K]>;
};

// ---------------------- Instance helper ----------------------
export type InstanceOf<T> = T extends Constructor<infer I> ? I : T;

// Generic filter for any desired type
export type NeededTypeAtPath<C extends Constructor<any>, T> = {
  [P in Paths<C>]: PathValueOf<C, P> extends T ? P : never;
}[Paths<C>];

// ---------------------- Paths ----------------------

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
type StripPrototypePrefix<P extends string> = P extends "prototype"
  ? never
  : P extends `prototype.${infer Rest}`
  ? Rest
  : P;

type ResolveRef<T> = T extends Ref<infer U> ? U : T;
type Recurseable<T> = T extends object
  ? T extends Array<any> | Function
    ? never
    : T
  : never;
type Join<K extends string, P extends string> = `${K}.${P}`;
type OnlyClassKeys<T> = {
  [K in keyof T]: K;
}[keyof T] &
  string;
// ---------------------- Paths ----------------------
export type Paths<
  T,
  Depth extends number = 5,
  OriginalDepth extends number = Depth
> = Depth extends never
  ? never
  : {
      [K in OnlyClassKeys<DeRef<NonOptional<T>>>]: K extends "_id"
        ? StripPrototypePrefix<`${K}`>
        : StripPrototypePrefix<
            PathsHelper<K, DeRef<NonOptional<T>>[K], Depth, OriginalDepth>
          >;
    }[OnlyClassKeys<DeRef<NonOptional<T>>>];

type PathsHelper<
  K extends string,
  V,
  Depth extends number,
  OriginalDepth extends number
> = Recurseable<V> extends never
  ? `${K}`
  : `${K}` | Join<K, Paths<DeRef<NonOptional<V>>, Prev[Depth], OriginalDepth>>;

// ---------------------- PathValueOf ----------------------
type Split<S extends string> = S extends `${infer L}.${infer R}`
  ? [L, ...Split<R>]
  : [S];

type PathValue<
  T,
  Parts extends readonly string[],
  Depth extends number = 5
> = Depth extends 0
  ? any
  : Parts extends [infer K, ...infer Rest]
  ? K extends keyof T
    ? Rest extends readonly string[]
      ? Rest["length"] extends 0
        ? ResolveRef<T[K]>
        : PathValue<ResolveRef<T[K]>, Rest, Prev[Depth]>
      : never
    : never
  : T;

export type PathValueOf<
  T,
  P extends string,
  Depth extends number = 5
> = PathValue<DeRef<InstanceOf<T>>, Split<P>, Depth>;

// ---------------------- Pretty ----------------------
export type Pretty<T> = { [K in keyof T]: T[K] };

let test1: Paths<Test> = "test2";
let test2: PathValueOf<Test, "test2.loggers2">;
