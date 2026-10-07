import {
  ChangeEntry,
  ChangeLogOptions,
  ChangeType,
  PruneMode,
} from "./types.js";

/**
 * Calculates a fast approximation of the memory/JSON byte footprint of a JavaScript object/value.
 */
export function estimateObjectSizeBytes(obj: unknown): number {
  if (obj === null || obj === undefined) return 8;
  const type = typeof obj;
  if (type === "boolean") return 4;
  if (type === "number") return 8;
  if (type === "string") return (obj as string).length * 2;
  if (type === "object") {
    let size = 16;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        size += estimateObjectSizeBytes(obj[i]);
      }
    } else {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          size += key.length * 2 + estimateObjectSizeBytes((obj as Record<string, unknown>)[key]);
        }
      }
    }
    return size;
  }
  return 16;
}

export class ServerChangeTracker<T = unknown> {
  private currentRevision = 0;
  private lowestRetainedRevision = 1;
  private entries: ChangeEntry<T>[] = [];
  private totalEstimatedBytes = 0;

  public maxAgeMs?: number;
  public maxSizeBytes?: number;
  public maxEntries?: number;
  public pruneMode: PruneMode;

  constructor(
    public readonly className: string,
    options?: ChangeLogOptions,
  ) {
    this.maxAgeMs = options?.maxAgeMs;
    this.maxSizeBytes = options?.maxSizeBytes;
    this.maxEntries = options?.maxEntries;
    this.pruneMode = options?.pruneMode ?? "either";
  }

  /**
   * Dynamically updates limits (MB size, TTL age, entries, pruneMode) mid-run and triggers pruning.
   */
  public updateOptions(options: Partial<ChangeLogOptions>): void {
    if (options.maxAgeMs !== undefined) this.maxAgeMs = options.maxAgeMs;
    if (options.maxSizeBytes !== undefined) this.maxSizeBytes = options.maxSizeBytes;
    if (options.maxEntries !== undefined) this.maxEntries = options.maxEntries;
    if (options.pruneMode !== undefined) this.pruneMode = options.pruneMode;
    this.prune();
  }

  public getCurrentRevision(): number {
    return this.currentRevision;
  }

  public getLowestRetainedRevision(): number {
    return this.lowestRetainedRevision;
  }

  public getEstimatedSizeBytes(): number {
    return this.totalEstimatedBytes;
  }

  public getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Records a mutation and assigns a new monotonic revision number.
   */
  public recordChange(
    type: ChangeType,
    id: string,
    data?: Partial<T>,
  ): number {
    return this.recordChangeWithTimestamp(type, id, data, Date.now());
  }

  /**
   * Records a mutation with an explicit timestamp (useful for testing or replay).
   */
  public recordChangeWithTimestamp(
    type: ChangeType,
    id: string,
    data: Partial<T> | undefined,
    timestamp: number,
  ): number {
    this.currentRevision += 1;
    const rev = this.currentRevision;

    const estimatedBytes =
      40 + // metadata overhead (revision, type, id, timestamp)
      id.length * 2 +
      (data ? estimateObjectSizeBytes(data) : 0);

    const entry: ChangeEntry<T> = {
      revision: rev,
      type,
      id,
      data,
      timestamp,
      estimatedBytes,
    };

    this.entries.push(entry);
    this.totalEstimatedBytes += estimatedBytes;

    this.prune();
    return rev;
  }

  /**
   * Retrieves all mutations occurring strictly after `clientRevision`.
   * If `clientRevision` is older than the lowest retained revision in history,
   * returns `isExpired: true` indicating a full sync is necessary.
   */
  public getChangesSince(
    clientRevision: number,
    allowedIds?: Set<string>,
  ): { isExpired: boolean; changes: ChangeEntry<T>[] } {
    if (clientRevision >= this.currentRevision) {
      return { isExpired: false, changes: [] };
    }

    if (this.entries.length === 0 || clientRevision < this.lowestRetainedRevision - 1) {
      return { isExpired: true, changes: [] };
    }

    let filtered = this.entries.filter((e) => e.revision > clientRevision);

    if (allowedIds) {
      filtered = filtered.filter((e) => allowedIds.has(e.id));
    }

    return {
      isExpired: false,
      changes: filtered,
    };
  }

  /**
   * Prunes entries based on configured maxAgeMs, maxSizeBytes, maxEntries, and pruneMode.
   */
  public prune(): void {
    if (this.entries.length === 0) return;

    const now = Date.now();
    let deleteCount = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const isAgeViolated = this.maxAgeMs != null && now - entry.timestamp > this.maxAgeMs;
      const isSizeViolated =
        this.maxSizeBytes != null && this.totalEstimatedBytes > this.maxSizeBytes;
      const isCountViolated =
        this.maxEntries != null && this.entries.length - deleteCount > this.maxEntries;

      let shouldPrune = false;

      if (this.pruneMode === "both") {
        const hasAgeConstraint = this.maxAgeMs != null;
        const hasSizeConstraint = this.maxSizeBytes != null;

        if (hasAgeConstraint && hasSizeConstraint) {
          shouldPrune = (isAgeViolated && isSizeViolated) || isCountViolated;
        } else {
          shouldPrune = isAgeViolated || isSizeViolated || isCountViolated;
        }
      } else {
        // "either" mode
        shouldPrune = isAgeViolated || isSizeViolated || isCountViolated;
      }

      if (shouldPrune) {
        this.totalEstimatedBytes -= entry.estimatedBytes;
        deleteCount++;
      } else {
        break;
      }
    }

    if (deleteCount > 0) {
      this.entries.splice(0, deleteCount);
      if (this.entries.length > 0) {
        this.lowestRetainedRevision = this.entries[0].revision;
      } else {
        this.lowestRetainedRevision = this.currentRevision + 1;
        this.totalEstimatedBytes = 0;
      }
    }
  }

  /**
   * Clears all recorded entries and resets tracking state.
   */
  public clear(): void {
    this.entries = [];
    this.totalEstimatedBytes = 0;
    this.currentRevision = 0;
    this.lowestRetainedRevision = 1;
  }
}
