import { StoredManagerState } from "../types.js";
import { IClientStorageAdapter } from "./IClientStorageAdapter.js";

/**
 * In-memory client storage adapter.
 * Useful for keeping state between socket reconnections in Node.js or short-lived sessions.
 */
export class MemoryStorageAdapter implements IClientStorageAdapter {
  private store = new Map<string, StoredManagerState<any>>();

  public async saveManagerState<T = unknown>(
    className: string,
    state: StoredManagerState<T>,
  ): Promise<void> {
    // Clone state to prevent external mutations from modifying stored snapshot
    const cloned = JSON.parse(JSON.stringify(state));
    this.store.set(className, cloned);
  }

  public async loadManagerState<T = unknown>(
    className: string,
  ): Promise<StoredManagerState<T> | null> {
    const state = this.store.get(className);
    if (!state) return null;
    return JSON.parse(JSON.stringify(state)) as StoredManagerState<T>;
  }

  public async clearManagerState(className: string): Promise<void> {
    this.store.delete(className);
  }

  public async clearAll(): Promise<void> {
    this.store.clear();
  }
}
