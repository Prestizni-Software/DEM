import { StoredManagerState } from "../types.js";

/**
 * Interface for pluggable client-side persistent storage adapters in DEM.
 */
export interface IClientStorageAdapter {
  /**
   * Save complete manager state to persistent storage.
   */
  saveManagerState<T = unknown>(
    className: string,
    state: StoredManagerState<T>,
  ): Promise<void>;

  /**
   * Retrieve saved manager state from storage.
   * Returns null if no state exists or if stored data is corrupted.
   */
  loadManagerState<T = unknown>(
    className: string,
  ): Promise<StoredManagerState<T> | null>;

  /**
   * Clear saved state for a specific manager class.
   */
  clearManagerState(className: string): Promise<void>;

  /**
   * Clear all stored DEM manager states across all classes.
   */
  clearAll(): Promise<void>;
}
