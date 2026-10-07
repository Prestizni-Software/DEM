import { StoredManagerState } from "../types.js";
import { IClientStorageAdapter } from "./IClientStorageAdapter.js";

export interface LocalStorageAdapterOptions {
  prefix?: string;
  storage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear?(): void;
    key?(index: number): string | null;
    length?: number;
  };
}

/**
 * LocalStorage client storage adapter.
 * Works with browser window.localStorage or mock storage in tests/Node.js.
 */
export class LocalStorageAdapter implements IClientStorageAdapter {
  private prefix: string;
  private storageBackend: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear?(): void;
    key?(index: number): string | null;
    length?: number;
  } | null = null;

  constructor(options?: LocalStorageAdapterOptions) {
    this.prefix = options?.prefix ?? "dem_state_";
    if (options?.storage) {
      this.storageBackend = options.storage;
    } else if (typeof window !== "undefined" && window.localStorage) {
      this.storageBackend = window.localStorage;
    } else if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
      this.storageBackend = (globalThis as any).localStorage;
    }
  }

  private getKey(className: string): string {
    return `${this.prefix}${className}`;
  }

  public async saveManagerState<T = unknown>(
    className: string,
    state: StoredManagerState<T>,
  ): Promise<void> {
    if (!this.storageBackend) {
      return;
    }
    try {
      const serialized = JSON.stringify(state);
      this.storageBackend.setItem(this.getKey(className), serialized);
    } catch {
      // Ignore quota exceeded or storage failure gracefully
    }
  }

  public async loadManagerState<T = unknown>(
    className: string,
  ): Promise<StoredManagerState<T> | null> {
    if (!this.storageBackend) {
      return null;
    }
    try {
      const raw = this.storageBackend.getItem(this.getKey(className));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.revision === "number" && Array.isArray(parsed.ids)) {
        return parsed as StoredManagerState<T>;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async clearManagerState(className: string): Promise<void> {
    if (!this.storageBackend) return;
    try {
      this.storageBackend.removeItem(this.getKey(className));
    } catch {
      // Ignore
    }
  }

  public async clearAll(): Promise<void> {
    if (!this.storageBackend) return;
    try {
      if (typeof this.storageBackend.length === "number" && typeof this.storageBackend.key === "function") {
        const keysToRemove: string[] = [];
        for (let i = 0; i < this.storageBackend.length; i++) {
          const key = this.storageBackend.key(i);
          if (key && key.startsWith(this.prefix)) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          this.storageBackend.removeItem(key);
        }
      }
    } catch {
      // Ignore
    }
  }
}
