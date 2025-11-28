import { Ref } from "@typegoose/typegoose";
import {
  Constructor,
  InstanceOf,
  Join,
  OnlyClassKeys,
  Prev,
  Recurseable,
  Split,
  StripPrototypePrefix,
} from "./CommonTypes";
import { Types } from "mongoose";
import { AutoUpdated } from "./AutoUpdatedServerObjectClass";

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
export type ResolveRef<T> = T extends Ref<infer U> ? AutoUpdated<U> | Types.ObjectId | string : T;

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

export type UnwrapRef<T, D extends number = 10> = D extends 0
  ? T
  : // arrays
  T extends (infer A)[]
  ? UnwrapRef<A, Prev[D]>[]
  : // special case: Ref<ObjectId> → never
  T extends Ref<infer U>
  ? U extends Types.ObjectId
    ? never
    : AutoUpdated<Constructor<U>, D>
  : // leaf Types.ObjectId: return it, do NOT unwrap as never
  T extends Types.ObjectId
  ? Types.ObjectId
  : // objects
  T extends object
  ? { [K in keyof T]: UnwrapRef<T[K], Prev[D]> }
  : T;
