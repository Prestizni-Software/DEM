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
}

export interface ServerDeltaSyncOptions extends ChangeLogOptions {
  /**
   * Set to false to disable change tracking on the server manager.
   */
  enabled?: boolean;
}
