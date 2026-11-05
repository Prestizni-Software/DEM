import { EntityDescriptor } from "../CommonTypes.js";

/**
 * Core types and interfaces for DEM Delta Synchronization & Change Tracking.
 */

export type ChangeType = "create" | "update" | "delete";

export interface ChangeEntry<T = unknown> {
  revision: number;
  type: ChangeType;
  id: string;
  data?: Partial<T>;
  timestamp: number;
  estimatedBytes: number;
}

export type PruneMode = "either" | "both";

export interface ChangeLogOptions {
  /**
   * Maximum age of entries in milliseconds (TTL).
   * E.g. 7 * 24 * 60 * 60 * 1000 for 7 days.
   */
  maxAgeMs?: number;

  /**
   * Maximum estimated size of all entries combined in bytes.
   * E.g. 10 * 1024 * 1024 for 10 MB.
   */
  maxSizeBytes?: number;

  /**
   * Maximum number of entries to retain.
   */
  maxEntries?: number;

  /**
   * Pruning policy when both conditions are specified:
   * - 'either': prune if entry exceeds maxAge OR total size exceeds maxSizeBytes (default)
   * - 'both': prune only if BOTH conditions are violated
   */
  pruneMode?: PruneMode;
}

export interface DeltaSyncPayload<T = unknown> {
  status: "up-to-date" | "delta" | "full";
  revision: number;
  changes?: ChangeEntry<T>[];
  ids?: string[];
  objects?: T[];
  properties?: string[];
}

export interface StoredManagerState<T = unknown> {
  className: string;
  revision: number;
  ids: string[];
  objects: T[];
  properties: string[];
  savedAt: number;
  manifest?: EntityDescriptor[];
}

export interface ClientDeltaSyncOptions {
  /**
   * The storage adapter instance to use for client caching and offline persistence.
   */
  storage?: import("./storage/IClientStorageAdapter.js").IClientStorageAdapter;
  /**
   * Optional custom identifier for cache namespace.
   */
  cacheKeyPrefix?: string;
  /**
   * When true, suppresses per-property callbacks during delta application and invokes a single batch summary callback.
   */
  batchCallbacks?: boolean;
}

/**
 * Summary of mutations applied during a batched delta synchronization pass.
 */
export interface DeltaBatchSummary<T = unknown> {
  /**
   * Entities created during the delta pass.
   */
  created: T[];
  /**
   * Entities updated during the delta pass along with their changed property keys.
   */
  updated: Array<{ object: T; keys: string[] }>;
  /**
   * Identifiers of entities deleted during the delta pass.
   */
  deletedIds: string[];
}

/**
 * Options controlling how `ClientStateReconciler.applyDelta` processes changes and dispatches callbacks.
 */
export interface ApplyDeltaOptions {
  /**
   * Coalesces multiple mutations per entity into a single net mutation before applying (default: true).
   */
  coalesce?: boolean;
  /**
   * Suppresses per-property/per-entity callbacks during the loop and fires a single summary notification at the end (default: false).
   */
  batchCallbacks?: boolean;
}

export interface ServerDeltaSyncOptions extends ChangeLogOptions {
  /**
   * Set to false to disable change tracking on the server manager.
   */
  enabled?: boolean;
}
