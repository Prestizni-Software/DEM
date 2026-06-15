import { EventEmitter } from "eventemitter3";
import { ObjectId, ObjectIdLike } from "bson";
import "reflect-metadata";

export type MongoId = string | ObjectId;
export type EventEmitter3 = EventEmitter;

export interface IAutoUpdateManager<T extends IAutoUpdatedClientObjectBase> {
  readonly className: string;
  readonly cache: DEMCache;
  readonly managers: Record<
    string,
    IAutoUpdateManager<IAutoUpdatedClientObjectBase>
  >;
  getObject(_id?: MongoId): T | null | undefined;
  deleteObject(_id: MongoId): Promise<{ success: boolean; message: string }>;
  readonly objectsAsArray: T[];
  readonly isLoaded: boolean;
}

export interface IAutoUpdatedClientObjectBase {
  readonly _id: MongoId;
  readonly properties: string[];
  readonly className: string;
  readonly isLoaded: boolean;
  loadMissingReferences(): Promise<void>;
  waitForPreloaded(): Promise<void>;
  destroy(once?: boolean): Promise<{ success: boolean; message: string }>;
  isPreLoadedAsync(): Promise<boolean>;
  contactChildren(): Promise<void>;
  getValue(key: string): any;
  setValue(key: string, val: any): Promise<{ success: boolean; msg: string }>;
  readonly parentManager: IAutoUpdateManager<IAutoUpdatedClientObjectBase>;
  readonly callbacks: any;
  readonly classParam: any;
}

export interface IAutoUpdatedClientObject<
  T extends object = any,
> extends IAutoUpdatedClientObjectBase {
  readonly extractedData: ExtractedData<T, IAutoUpdatedClientObject<any>>;
  getValue<K extends Paths<T, IAutoUpdatedClientObject<any>>>(
    key: K,
  ): PathValueOf<T, K>;
  setValue<K extends Paths<T, IAutoUpdatedClientObject<any>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string }>;
}

export interface IAutoUpdatedServerObject<
  T extends object = any,
> extends IAutoUpdatedClientObject<T> {
  loadFromDB(): Promise<void>;
  loadFromDocument(document: unknown): Promise<void>;
}

export type AutoProps<T> = {
  readonly [K in keyof T]: T[K];
};

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

type IsAUCOBase<T> = T extends {
  className: string;
  _id: any;
}
  ? true
  : false;

type AllowStringForRefs<V> =
  NonNullable<V> extends Array<infer U>
    ? IsAUCOBase<NonNullable<U>> extends true
      ? (U | string | ObjectIdLike)[]
      : V
    : IsAUCOBase<NonNullable<V>> extends true
      ? V | string | ObjectIdLike
      : V;

type OnlyStringForRefs<V> = V extends any
  ? V extends Array<infer U>
    ? OnlyStringForRefs<U>[]
    : V extends IAutoUpdatedClientObjectBase
      ? string
      : V extends Date
        ? V
        : V extends ObjectId | ObjectIdLike
          ? string
          : V extends object
            ? {
                [K in keyof V as V[K] extends Function
                  ? never
                  : K]: K extends "_id" ? string : OnlyStringForRefs<V[K]>;
              }
            : V
  : never;

export type DEMCache = {
  references: Record<string, any>; // Using any here to break circular dependency with AutoUpdateManager
};

export type Pure<T extends object, Base = IAutoUpdatedClientObject<any>> = Omit<
  T,
  | keyof Base
  | "parentManager"
  | "callbacks"
  | "classParam"
  | "className"
  | "properties"
  | "isLoaded"
  | "extractedData"
  | "getValue"
  | "setValue"
  | "loadFromDB"
  | "setValue_"
>;

export type IsData<T extends object> = {
  [K in keyof Pure<T> as T[K] extends Function ? never : K]: AllowStringForRefs<
    T[K]
  >;
} & {
  _id: MongoId;
};

export type ExtractedData<
  T extends object,
  Base = IAutoUpdatedClientObject<any>,
> = {
  [K in keyof IsData<T> as K extends "_id" ? never : K]: OnlyStringForRefs<
    IsData<T>[K]
  >;
} & { _id: string };

export type SocketEvent = [
  string,
  unknown,
  (res: ServerResponse<unknown>) => void,
];

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

export function classProp(target: object, propertyKey: string): void {
  const props = (Reflect.getOwnMetadata("props", target) as string[]) || [];
  const newProps = [...props, propertyKey];
  Reflect.defineMetadata("props", newProps, target);
}

export function populatedRef(
  where: string,
): (target: object, propertyKey: string) => void {
  return function (target: object, propertyKey: string) {
    classRef()(target, propertyKey);
    Reflect.defineMetadata("refsTo", where, target, propertyKey);
  };
}

export function classRef(): (target: object, propertyKey: string) => void {
  return function (target: object, propertyKey: string) {
    Reflect.defineMetadata("isRef", true, target, propertyKey);
  };
}

export type Pretty<T> = {
  [K in keyof T]: T[K];
};

export type StripPrototypePrefix<P extends string> = P extends "prototype"
  ? never
  : P extends `prototype.${infer Rest}`
    ? Rest
    : P;

export type Recurseable<T> = T extends object
  ? T extends Array<unknown> | Function
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
  T extends IAutoUpdatedClientObject<any> ? unknown : T;

export type RecursiveDeAutoUpdate<T extends IAutoUpdatedClientObject<any>> =
  T extends IAutoUpdatedClientObject<any> ? unknown : T;

export type OnlyAddedKeys<Sub, Parent> = Pick<
  Sub,
  Exclude<keyof Sub, keyof Omit<Parent, "_id">>
>;

export type Prev = [never, 0, 1, 2, 3];

export type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

export type Paths<T, Base, D extends number = 3> = 0 extends 1 & T
  ? string
  : [D] extends [never]
    ? never
    : NonNullable<T> extends object
      ? {
          [K in keyof OnlyAddedKeys<NonNullable<T>, Base> &
            string]-?: NonNullable<NonNullable<T>[K]> extends Function
            ? never
            : NonNullable<NonNullable<T>[K]> extends
                  | Array<unknown>
                  | Date
                  | ObjectId
              ? K
              : NonNullable<NonNullable<T>[K]> extends object
                ?
                    | K
                    | Join<
                        K,
                        Paths<NonNullable<NonNullable<T>[K]>, Base, Prev[D]>
                      >
                : K;
        }[keyof OnlyAddedKeys<NonNullable<T>, Base> & string]
      : never;

export type PathValueOf<T, P extends string> = 0 extends 1 & T
  ? any
  : P extends `${infer K}.${infer Rest}`
    ? K extends keyof NonNullable<T>
      ? PathValueOf<NonNullable<NonNullable<T>[K]>, Rest>
      : never
    : P extends keyof NonNullable<T>
      ? NonNullable<T>[P]
      : never;

export const EVENT_INTERNAL_PRE_LOADED = "pre-loaded";
export const EVENT_UPDATE = "update";
export const EVENT_DELETE = "delete";
export const EVENT_NEW = "new";
export const EVENT_GET = "get";
export const EVENT_STARTUP = "startup";

export function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return "[Circular or non-serializable object]";
  }
}

export type GlobalCache = {
  objects: Record<
    string,
    {
      className: string;
      object: IAutoUpdatedClientObjectBase;
    }
  >;
};

export const globalCache: GlobalCache = {
  objects: {},
};
