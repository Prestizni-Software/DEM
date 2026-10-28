import { StoredManagerState } from "../types.js";
import { IClientStorageAdapter } from "./IClientStorageAdapter.js";

/**
 * In-memory client storage adapter.
 * Useful for keeping state between socket reconnections in Node.js or short-lived sessions.
 */
export class MemoryStorageAdapter implements IClientStorageAdapter {
  private store = new Map<string, StoredManagerState<any>>();

  /**
   * Saves complete manager state into in-memory store.
   * Clones the input state to prevent mutations from modifying the stored snapshot.
   *
   * @param className - The name identifier of the manager class.
   * @param state - Complete snapshot of the manager state.
   */
  public async saveManagerState<T = unknown>(
    className: string,
    state: StoredManagerState<T>,
  ): Promise<void> {
    const cloned = JSON.parse(JSON.stringify(state));
    this.store.set(className, cloned);
  }

  /**
   * Retrieves cloned manager state snapshot from in-memory store.
   *
   * @param className - The name identifier of the manager class.
   * @returns The stored snapshot or null if not found.
   */
  public async loadManagerState<T = unknown>(
    className: string,
  ): Promise<StoredManagerState<T> | null> {
    const state = this.store.get(className);
    if (!state) return null;
    return state as StoredManagerState<T>;
  }

  /**
   * Removes saved in-memory state for a specific manager class.
   *
   * @param className - The name identifier of the manager class.
   */
  public async clearManagerState(className: string): Promise<void> {
    this.store.delete(className);
  }

  /**
   * Purges all saved manager states across all classes from the in-memory store.
   */
  public async clearAll(): Promise<void> {
    this.store.clear();
  }
}
