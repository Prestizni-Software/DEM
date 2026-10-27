import { EventEmitter } from "eventemitter3";
import { ObjectId, ObjectIdLike } from "bson";
import "reflect-metadata";

import { DEMErrorCode } from "./DEMErrors.js";

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
  loadObject?(_id: MongoId, options?: { depth?: number }): Promise<T>;
  deleteObject(_id: MongoId, isRemote?: boolean): Promise<{ success: boolean; message: string; code?: DEMErrorCode }>;
  readonly objectsAsArray: T[];
  readonly isLoaded: boolean;
  readonly manifest?: EntityDescriptor[];
  readonly callbacks?: any;
}

export type DEMCallbacks<T extends IAutoUpdatedClientObjectBase = any> = {
  new: (obj: T) => Promise<void> | void;
  update: (obj: T, key: string) => Promise<void> | void;
  delete: (manager: IAutoUpdateManager<T>) => Promise<void> | void;
  progress: (percent: number) => void;
};

export interface IAutoUpdatedClientObjectBase {
  readonly _id: MongoId;
  readonly properties: string[];
  readonly className: string;
  readonly isLoaded: boolean;
  isLazyStub?: boolean;
  descriptor?: string;
  ensureLoaded?(options?: { depth?: number }): Promise<this>;
  hydrateFromData?(payload: any): void;
  loadMissingReferences(): Promise<void>;
  waitForPreloaded(): Promise<void>;
  destroy(once?: boolean): Promise<{ success: boolean; message: string; code?: DEMErrorCode }>;
  isPreLoadedAsync(): Promise<boolean>;
  contactChildren(): Promise<void>;
  getRawId?(key: string): string | string[] | undefined;
  getValue(key: string): unknown;
  setValue(key: string, val: unknown): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }>;
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
  getValue(key: string): never;
  setValue<K extends Paths<T, IAutoUpdatedClientObject<any>>>(
    key: K,
    val: PathValueOf<IsData<T>, K>,
  ): Promise<{ success: boolean; msg: string; code?: DEMErrorCode }>;
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
  NonNullable<V> extends ReadonlyArray<infer U>
    ? IsAUCOBase<NonNullable<U>> extends true
      ? (U | string | ObjectIdLike)[]
      : U[]
    : IsAUCOBase<NonNullable<V>> extends true
      ? V | string | ObjectIdLike
      : V;

type OnlyStringForRefs<V> = V extends any
  ? V extends ReadonlyArray<infer U>
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
  | "isLazyStub"
  | "ensureLoaded"
  | "hydrateFromData"
  | "descriptor"
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
      code?: DEMErrorCode;
      success: true;
      related?: Record<string, any[]>;
      updatedArray?: unknown[];
      newRevision?: number;
      newHash?: string;
    }
  | {
      message: string;
      code?: DEMErrorCode;
      details?: unknown;
      success: false;
      updatedArray?: unknown[];
      newRevision?: number;
      newHash?: string;
    };

/**
 * Lightweight entity descriptor providing human-readable identification before hydration.
 */
export interface EntityDescriptor {
  /**
   * String representation of entity unique identifier.
   */
  _id: string;
  /**
   * Human-readable summary string generated from direct entity properties.
   */
  description: string;
}

/**
 * Configuration options governing smart lazy loading behavior.
 */
export interface LazyLoadingOptions {
  /**
   * Enables lazy loading mode for the target manager.
   */
  enabled?: boolean;
  /**
   * Default graph traversal depth for on-demand entity hydration (default: 2).
   */
  defaultDepth?: number;
}

export type ServerUpdateRequest<T = unknown> = {
  _id: MongoId;
  key: string;
  value: unknown;
};

/**
 * Property decorator that registers a property into the class reflection metadata.
 *
 * @param target - Prototype of the target class.
 * @param propertyKey - Property name to register.
 */
export function classProp(target: object, propertyKey: string): void {
  const props = (Reflect.getOwnMetadata("props", target) as string[]) || [];
  if (props.includes(propertyKey)) return;
  const newProps = [...props, propertyKey];
  Reflect.defineMetadata("props", newProps, target);
}

/**
 * Property decorator for populated references pointing to another managed entity class.
 *
 * @param where - The target managed class name this property references.
 * @returns Property decorator function.
 */
export function populatedRef(
  where: string,
): (target: object, propertyKey: string) => void {
  return function (target: object, propertyKey: string) {
    classProp(target, propertyKey);
    classRef()(target, propertyKey);
    Reflect.defineMetadata("refsTo", where, target, propertyKey);
  };
}

/**
 * Property decorator marking a property as an unresolved reference pointer.
 *
 * @returns Property decorator function.
 */
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
export const EVENT_DEAUTHENTICATE = "deauthenticate";

export * from "./version.js";

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
 *
 * @param version - Semantic version string to parse.
 * @returns ParsedSemVer object containing major, minor, patch, and prerelease fields, or null if invalid.
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
 *
 * @param v1 - First version string.
 * @param v2 - Second version string.
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2.
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
 * Evaluates SemVer rules, custom validators, and minimum required versions.
 *
 * @param clientVersion - DEM version of the client.
 * @param serverVersion - DEM version of the server.
 * @param options - Optional verification rules and callbacks.
 * @returns Object describing compatibility result and status code.
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
    return {
      compatible: false,
      clientVersion,
      serverVersion,
      status: "mismatch_minor",
      message: `Incompatible minor DEM version: Client is ${clientVersion}, Server is ${serverVersion}. Minor versions must match.`,
    };
  }

  // Patch version difference
  return {
    compatible: true,
    clientVersion,
    serverVersion,
    status: "compatible_patch",
    message: `DEM patch version compatible: Client (${clientVersion}) and Server (${serverVersion}).`,
  };
}

/**
 * Safely stringifies a value to JSON, catching circular reference errors.
 *
 * @param obj - The value to stringify.
 * @returns JSON string or fallback warning message.
 */
export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return "[Circular or non-serializable object]";
  }
}

/**
 * Global cache storing object references across managers.
 */
export class DEMGlobalCache {
  public objects: Record<
    string,
    {
      className: string;
      object: IAutoUpdatedClientObjectBase;
    }
  > = {};

  /**
   * Clears all objects in the cache.
   */
  public clear(): void {
    this.objects = {};
  }

  /**
   * Retrieves the number of stored objects.
   *
   * @returns Total count of cached objects.
   */
  public get size(): number {
    return Object.keys(this.objects).length;
  }
}

export type GlobalCache = DEMGlobalCache;

export const globalCache = new DEMGlobalCache();

/**
 * Permitted operation types for DEMArray asynchronous mutations.
 */
export type DEMArrayMutationOp =
  | "push"
  | "pop"
  | "shift"
  | "unshift"
  | "splice"
  | "set"
  | "reverse"
  | "sort"
  | "clear";

/**
 * Socket payload structure for an array mutation request.
 */
export type DEMArrayMutationParams = Omit<DEMArrayMutationRequest, "key">;

export interface DEMArrayMutationRequest {
  /**
   * The specific mutation operator to execute.
   */
  op: DEMArrayMutationOp;

  /**
   * Target property key holding the array.
   */
  key: string;

  /**
   * Optional items to insert or append (primitive values, entity instances, or string IDs).
   */
  items?: unknown[];

  /**
   * Optional anchor entity identifier for positional mutations (splice/set).
   */
  targetId?: string;

  /**
   * Optional list of anchor identifiers for multi-item splices.
   */
  targetIds?: string[];

  /**
   * Optional zero-based target offset.
   */
  index?: number;

  /**
   * Optional count of elements to delete.
   */
  deleteCount?: number;

  /**
   * Monotonic revision counter of the client state prior to mutation.
   */
  baseRevision?: number;

  /**
   * Content hash of the array prior to mutation for concurrency verification.
   */
  baseHash?: string;

  /**
   * Synchronized client timestamp when mutation was initiated.
   */
  clientTimestamp?: number;
}

/**
 * Server acknowledgment payload returned for an array mutation request.
 */
export interface DEMArrayMutationResponse {
  /**
   * Whether the mutation succeeded and was persisted.
   */
  success: boolean;

  /**
   * Optional error code on failure.
   */
  code?: DEMErrorCode;

  /**
   * Optional descriptive message.
   */
  message?: string;

  /**
   * The authoritative updated array state resolved and persisted by the server.
   */
  updatedArray?: unknown[];

  /**
   * Incremented monotonic revision counter after applying the mutation.
   */
  newRevision?: number;

  /**
   * Content hash of the updated array.
   */
  newHash?: string;
}

/**
 * Reactive array wrapper for DEM entity array properties.
 * Exposes synchronous ReadonlyArray queries and asynchronous mutation Promises.
 */
export interface DEMArray<T> extends ReadonlyArray<T> {
  /**
   * Appends elements asynchronously and awaits server persistence.
   *
   * @param items - Elements to append (entity instances, string IDs, or primitive values).
   * @returns Promise resolving to the new length of the array.
   * @throws {DEMError} Throws on network failure, validation rejection, or database error.
   */
  push(...items: (T | string | ObjectId)[]): Promise<number>;

  /**
   * Removes the last element asynchronously and awaits server persistence.
   *
   * @returns Promise resolving to the removed element, or undefined if empty.
   * @throws {DEMError} Throws on server rejection.
   */
  pop(): Promise<T | undefined>;

  /**
   * Removes the first element asynchronously and awaits server persistence.
   *
   * @returns Promise resolving to the removed element, or undefined if empty.
   * @throws {DEMError} Throws on server rejection.
   */
  shift(): Promise<T | undefined>;

  /**
   * Inserts elements at the start asynchronously and awaits server persistence.
   *
   * @param items - Elements to prepend.
   * @returns Promise resolving to the new length of the array.
   * @throws {DEMError} Throws on server rejection.
   */
  unshift(...items: (T | string | ObjectId)[]): Promise<number>;

  /**
   * Removes and/or inserts elements at an index asynchronously and awaits server persistence.
   * Anchors mutations to target element identifiers to eliminate positional drift under concurrency.
   *
   * @param start - Zero-based index at which to start changing the array.
   * @param deleteCount - Number of elements to remove.
   * @param items - Elements to insert.
   * @returns Promise resolving to an array containing the removed elements.
   * @throws {DEMError} Throws on server rejection.
   */
  splice(
    start: number,
    deleteCount?: number,
    ...items: (T | string | ObjectId)[]
  ): Promise<T[]>;

  /**
   * Replaces an element at a specific index asynchronously and awaits server persistence.
   *
   * @param index - Target index to replace.
   * @param item - New value or entity to assign.
   * @returns Promise resolving to the assigned item.
   * @throws {DEMError} Throws on server rejection.
   */
  set(index: number, item: T | string | ObjectId): Promise<T>;

  /**
   * Reverses array elements in place asynchronously and awaits server persistence.
   *
   * @returns Promise resolving to this DEMArray.
   * @throws {DEMError} Throws on server rejection.
   */
  reverse(): Promise<this>;

  /**
   * Sorts array elements in place asynchronously and awaits server persistence.
   *
   * @param compareFn - Optional comparison function determining order.
   * @returns Promise resolving to this DEMArray.
   * @throws {DEMError} Throws on server rejection.
   */
  sort(compareFn?: (a: T, b: T) => number): Promise<this>;

  /**
   * Synchronous fill is prohibited on reactive DEMArray.
   * Declared for Array structural type compatibility.
   *
   * @param value - Value to fill array with.
   * @param start - Start index.
   * @param end - End index.
   * @returns This DEMArray.
   * @throws {DEMError} Throws CANNOT_SET_REF_DIRECTLY when invoked synchronously.
   */
  fill(value: T, start?: number, end?: number): this;

  /**
   * Synchronous copyWithin is prohibited on reactive DEMArray.
   * Declared for Array structural type compatibility.
   *
   * @param target - Target start index.
   * @param start - Source start index.
   * @param end - Source end index.
   * @returns This DEMArray.
   * @throws {DEMError} Throws CANNOT_SET_REF_DIRECTLY when invoked synchronously.
   */
  copyWithin(target: number, start: number, end?: number): this;

  /**
   * Clears all elements from the array asynchronously and awaits server persistence.
   *
   * @returns Promise resolving once the array is cleared.
   * @throws {DEMError} Throws on server rejection.
   */
  clear(): Promise<void>;

  /**
   * Hydrates all referenced entities in the array up to designated reference depth.
   *
   * @param options - Hydration options containing graph depth.
   * @returns Promise resolving to this DEMArray once all entities are hydrated.
   */
  ensureLoaded(options?: { depth?: number }): Promise<this>;
}

export * from "./sync/types.js";
export * from "./sync/storage/IClientStorageAdapter.js";
export * from "./sync/storage/MemoryStorageAdapter.js";
export * from "./sync/storage/LocalStorageAdapter.js";
export * from "./sync/storage/IndexedDbStorageAdapter.js";
export * from "./sync/ServerChangeTracker.js";
export * from "./sync/ClientStateReconciler.js";
export * from "./DEMErrors.js";

