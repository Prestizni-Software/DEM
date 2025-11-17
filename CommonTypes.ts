import { ObjectId } from "bson";
import "reflect-metadata";
import EventEmitter from "eventemitter3";
export type EventEmitter3 = EventEmitter;
export type Ref<T extends { _id: any }> = T | string | ObjectId;
export type LoggersTypeInternal = LoggersType & {
  warn: (...args: any[]) => void;
};
export type LoggersType = {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
};
export type InnerLoggersType = {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
};
export type IsData<T> = T extends {
  _id: any;
}
  ? T
  : never;
export type ServerResponse<T> =
  | {
      data: T;
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
  _id: string | ObjectId;
  key: string;
  value: any;
};
export declare function classProp(target: any, propertyKey: string): void;
export declare function classRef(
  where: string
): (target: any, propertyKey: string) => void;
export type AutoProps<T> = {
  readonly [K in keyof T]: T[K];
};
export type Constructor<T> = new (...args: any[]) => T;
export type UnboxConstructor<T> = T extends new (...args: any[]) => infer I
  ? I
  : T;
export type NonOptional<T> = Exclude<T, null | undefined>;
export type DeRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer U>
    ? U
    : T[K] extends Ref<infer U> | null | undefined
    ? U
    : T[K];
};
export type RefToId<T> = {
  [K in keyof T]: T[K] extends Ref<infer U> ? U | string : T[K];
};
export type InstanceOf<T> = T extends Constructor<infer I> ? I : T;
export type NeededTypeAtPath<C extends Constructor<any>, T> = {
  [P in Paths<C>]: PathValueOf<C, P> extends T ? P : never;
}[Paths<C>];
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
type StripPrototypePrefix<P extends string> = P extends "prototype"
  ? never
  : P extends `prototype.${infer Rest}`
  ? Rest
  : P;
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
export type ResolveRef<T> = T extends Ref<infer U> ? U : T;
type Split<S extends string> = S extends `${infer L}.${infer R}`
  ? [L, ...Split<R>]
  : [S];
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
          ? ResolveRef<
              Rest["length"] extends 0
                ? T[K]
                : PathValue<ResolveRef<T[K]>, Rest, Prev[Depth]>
            >
          : never
        : never
      : never
    : ResolveRef<T>
  : never;
export type PathValueOf<
  T,
  P extends string,
  Depth extends number = 6
> = PathValue<InstanceOf<T>, Split<P>, Depth>;
export type Pretty<T> = {
  [K in keyof T]: T[K];
};
export {};
