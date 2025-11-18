import "reflect-metadata";
import EventEmitter from "eventemitter3";

export type EventEmitter3 = EventEmitter;

export type ObjectId = {
  toString: () => string;
  id: Uint8Array<ArrayBufferLike>;
};

type RefType = string | ObjectId;

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
export type IsData<T> = T extends { _id: RefType } ? T : never;
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
  _id: RefType;
  key: string;
  value: any;
};

export function classProp(target: any, propertyKey: string) {
  const props = Reflect.getMetadata("props", target) || [];
  props.push(propertyKey);
  Reflect.defineMetadata("props", props, target);
}

export function classRef(where: string) {
  return function (target: any, propertyKey: string) {
    Reflect.defineMetadata("isRef", where, target, propertyKey);
  };
}

// ---------------------- Core ----------------------
export type AutoProps<T> = {
  readonly [K in keyof T]: T[K];
};

export type Constructor<T> = new (...args: any[]) => T;
export type UnboxConstructor<T> = T extends new (...args: any[]) => infer I
  ? I
  : T;

export type NonOptional<T> = Exclude<T, null | undefined>;

// ---------------------- Instance helper ----------------------
export type InstanceOf<T> = T extends Constructor<infer I> ? I : T;

// ---------------------- Paths ----------------------
export type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export type StripPrototypePrefix<P extends string> = P extends "prototype"
  ? never
  : P extends `prototype.${infer Rest}`
  ? Rest
  : P;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type Recurseable<T> =
  T extends Primitive | ObjectId | Date | Function | Array<any>
    ? never
    : T extends object
      ? T
      : never;

export type Join<K extends string, P extends string> = `${K}.${P}`;
export type OnlyClassKeys<T> = {
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
      [K in OnlyClassKeys<NonOptional<T>>]: K extends "_id"
        ? StripPrototypePrefix<`${K}`>
        : StripPrototypePrefix<
            PathsHelper<K, NonOptional<T>[K], Depth, OriginalDepth>
          >;
    }[OnlyClassKeys<NonOptional<T>>];

export type PathsHelper<
  K extends string,
  V,
  Depth extends number,
  OriginalDepth extends number
> = Recurseable<V> extends never
  ? `${K}`
  : `${K}` | Join<K, Paths<V, Prev[Depth], OriginalDepth>>;
// ---------------------- PathValueOf ----------------------

type Split<S extends string> = S extends `${infer L}.${infer R}`
  ? [L, ...Split<R>]
  : [S];

export type PathValue<
  T,
  Parts extends string[],
  Depth extends number = 5
> = Depth extends 0
  ? never
  : // Distribute over unions in T
  T extends unknown
  ? Parts extends [infer K, ...infer Rest]
    ? K extends string
      ? K extends keyof T
        ? Rest extends string[]
          ? // unwrap at every step; recursion will also distribute
            
              Rest["length"] extends 0
                ? T[K]
                : PathValue<T[K], Rest, Prev[Depth]>
            
          : never
        : never
      : never
    : T
  : never;

export type PathValueOf<
  T,
  P extends string,
  Depth extends number = 6
> = PathValue<InstanceOf<T>, Split<P>, Depth>;

// ---------------------- Pretty ----------------------
export type Pretty<T> = { [K in keyof T]: T[K] };
