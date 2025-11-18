import { Ref } from "@typegoose/typegoose";
import {
  InstanceOf,
  Join,
  OnlyClassKeys,
  Prev,
  Recurseable,
  Split,
  StripPrototypePrefix,
} from "./CommonTypes";

// ---------------------- DeRef ----------------------
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
export type ResolveRef<T> = T extends Ref<infer U> ? U : T;

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
            ResolveRef<
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
