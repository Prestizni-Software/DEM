import {
  Join,
  OnlyAddedKeys,
  Prev,
} from "./CommonTypes.js";
import { ObjectId, Types } from "mongoose";

export type NonOptional<T> = Exclude<T, null | undefined>;

export type Paths<T, Base, D extends number = 3> = [D] extends [never]
  ? never
  : NonNullable<T> extends object
  ? {
      // We only iterate over the keys that survive your OnlyAddedKeys filter
      [K in keyof OnlyAddedKeys<NonNullable<T>, Base> & string]-?: 
        NonNullable<NonNullable<T>[K]> extends Function
        ? never
        : NonNullable<NonNullable<T>[K]> extends Array<any> | Date | ObjectId | Types.ObjectId
        ? K // Stop dotting into Arrays, Dates, or ObjectIds
        : NonNullable<NonNullable<T>[K]> extends object
        ? K | Join<K, Paths<NonNullable<NonNullable<T>[K]>, Base, Prev[D]>> // Recurse, passing Base down
        : K; // Resolves primitives
    }[keyof OnlyAddedKeys<NonNullable<T>, Base> & string] // Output the union of keys
  : never;

type SafeGet<T, K extends string> = T extends any 
  ? K extends keyof NonNullable<T> 
    ? NonNullable<T>[K] 
    : never 
  : never;

// Upgraded PathValueOf
export type PathValueOf<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? PathValueOf<SafeGet<T, K>, Rest> 
  : SafeGet<T, P>; 