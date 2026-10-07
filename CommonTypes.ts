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
  getValue(key: string): unknown;
  setValue(key: string, val: unknown): Promise<{ success: boolean; msg: string }>;
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
  loadFromDocument(document: unknown): void;
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
  references: Record<string, any>;
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
  | "destroyImmediate"
  | "loadError"
  | "updateEventName"
  | "getRawId"
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

export type ServerUpdateRequest<T = unknown> = {
  _id: MongoId;
  key: string;
  value: unknown;
};

export function classProp(target: object, propertyKey: string): void {
  const props = (Reflect.getOwnMetadata("props", target) as string[]) || [];
  if (props.includes(propertyKey)) return;
  const newProps = [...props, propertyKey];
  Reflect.defineMetadata("props", newProps, target);
}

export function populatedRef(
  where: string,
): (target: object, propertyKey: string) => void {
  return function (target: object, propertyKey: string) {
    classProp(target, propertyKey);
    classRef()(target, propertyKey);
    Reflect.defineMetadata("refsTo", where, target, propertyKey);
  };
}

export function classRef(): (target: object, propertyKey: string) => void {
  return function (target: object, propertyKey: string) {
    classProp(target, propertyKey);
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
export const EVENT_VERSION = "dem_version";

/**
 * Current version of the DEM library.
 */
export const DEM_VERSION = "0.6.5";

/**
 * DEM socket protocol version.
 */
export const DEM_PROTOCOL_VERSION = "1.0.0";

/**
 * Configuration options for DEM client-server version verification.
 */
export interface DEMVersionOptions {
  /**
   * If true, requires exact or strict compatibility between client and server versions.
   * In strict mode, minor or major mismatches reject the connection.
   * Default: false (allows minor/patch differences, warning on differences).
   */
  strictVersionMatch?: boolean;

  /**
   * Optional minimum server version required by the client.
   * e.g., "0.6.0"
   */
  minServerVersion?: string;

  /**
   * Optional custom validator callback.
   * Return true for compatible, false or error message string if incompatible.
   */
  validateVersion?: (
    clientVersion: string,
    serverVersion: string,
  ) => boolean | string;

  /**
   * Optional callback triggered when a version mismatch or notice is detected.
   */
  onVersionMismatch?: (
    clientVersion: string,
    serverVersion: string,
    message: string,
  ) => void;
}

/**
 * Result of a DEM version verification check.
 */
export interface DEMVersionVerificationResult {
  compatible: boolean;
  clientVersion: string;
  serverVersion: string;
  status:
    | "match"
    | "compatible_minor"
    | "compatible_patch"
    | "mismatch_major"
    | "mismatch_minor"
    | "below_min_version"
    | "custom_rejected"
    | "unknown";
  message: string;
}

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Parses a semantic version string (e.g. "0.6.5", "v1.2.3-alpha").
 */
export function parseSemVer(version: string): ParsedSemVer | null {
  if (!version || typeof version !== "string") return null;
  const cleaned = version.trim().replace(/^v/, "");
  const match = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    prerelease: match[4] || undefined,
  };
}

/**
 * Compares two semantic version strings.
 * Returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2.
 */
export function compareSemVer(v1: string, v2: string): number {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1 && !p2) return 0;
  if (!p1) return -1;
  if (!p2) return 1;

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
  return 0;
}

/**
 * Verifies compatibility between client and server DEM versions.
 */
export function verifyDEMVersion(
  clientVersion: string,
  serverVersion: string,
  options?: DEMVersionOptions,
): DEMVersionVerificationResult {
  const cParsed = parseSemVer(clientVersion);
  const sParsed = parseSemVer(serverVersion);

  if (options?.validateVersion) {
    const customRes = options.validateVersion(clientVersion, serverVersion);
    if (customRes === true) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        status: "match",
        message: `Custom version validator accepted client ${clientVersion} and server ${serverVersion}.`,
      };
    }
    const msg =
      typeof customRes === "string"
        ? customRes
        : `Custom version validator rejected client ${clientVersion} with server ${serverVersion}.`;
    return {
      compatible: false,
      clientVersion,
      serverVersion,
      status: "custom_rejected",
      message: msg,
    };
  }

  if (!cParsed || !sParsed) {
    const isExact = clientVersion === serverVersion;
    return {
      compatible: isExact || !options?.strictVersionMatch,
      clientVersion,
      serverVersion,
      status: isExact ? "match" : "unknown",
      message: isExact
        ? `DEM versions match (${clientVersion}).`
        : `Non-semver DEM versions encountered: client '${clientVersion}', server '${serverVersion}'.`,
    };
  }

  // Check minimum server version requirement if specified
  if (options?.minServerVersion) {
    if (compareSemVer(serverVersion, options.minServerVersion) < 0) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        status: "below_min_version",
        message: `Server DEM version ${serverVersion} is lower than required minimum ${options.minServerVersion}.`,
      };
    }
  }

  // Exact match
  if (
    cParsed.major === sParsed.major &&
    cParsed.minor === sParsed.minor &&
    cParsed.patch === sParsed.patch
  ) {
    return {
      compatible: true,
      clientVersion,
      serverVersion,
      status: "match",
      message: `DEM versions match (${clientVersion}).`,
    };
  }

  // Major version mismatch (incompatible by SemVer rules)
  if (cParsed.major !== sParsed.major) {
    return {
      compatible: false,
      clientVersion,
      serverVersion,
      status: "mismatch_major",
      message: `Incompatible major DEM version: Client is ${clientVersion}, Server is ${serverVersion}.`,
    };
  }

  // Minor version difference
  if (cParsed.minor !== sParsed.minor) {
    if (options?.strictVersionMatch) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        status: "mismatch_minor",
        message: `Strict version check failed: Client minor version (${clientVersion}) differs from Server (${serverVersion}).`,
      };
    }
    return {
      compatible: true,
      clientVersion,
      serverVersion,
      status: "compatible_minor",
      message: `DEM minor version notice: Client (${clientVersion}) differs from Server (${serverVersion}). Functionality is compatible.`,
    };
  }

  // Patch version difference
  return {
    compatible: true,
    clientVersion,
    serverVersion,
    status: "compatible_patch",
    message: `DEM patch version notice: Client (${clientVersion}) and Server (${serverVersion}).`,
  };
}

export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return "[Circular or non-serializable object]";
  }
}

export class DEMGlobalCache {
  public objects: Record<
    string,
    {
      className: string;
      object: IAutoUpdatedClientObjectBase;
    }
  > = {};

  public clear(): void {
    this.objects = {};
  }

  public get size(): number {
    return Object.keys(this.objects).length;
  }
}

export type GlobalCache = DEMGlobalCache;

export const globalCache = new DEMGlobalCache();

export * from "./sync/types.js";
export * from "./sync/storage/IClientStorageAdapter.js";
export * from "./sync/storage/MemoryStorageAdapter.js";
export * from "./sync/storage/LocalStorageAdapter.js";
export * from "./sync/storage/IndexedDbStorageAdapter.js";
export * from "./sync/ServerChangeTracker.js";
export * from "./sync/ClientStateReconciler.js";

