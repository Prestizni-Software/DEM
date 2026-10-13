import { StoredManagerState } from "../types.js";
import { IClientStorageAdapter } from "./IClientStorageAdapter.js";
import { DEMError, DEMErrorCode } from "../../DEMErrors.js";

export interface IndexedDbStorageAdapterOptions {
  dbName?: string;
  storeName?: string;
  idbFactory?: IDBFactory;
}

/**
 * IndexedDB storage adapter for client-side DEM caching in browsers.
 */
export class IndexedDbStorageAdapter implements IClientStorageAdapter {
  private dbName: string;
  private storeName: string;
  private idbFactory: IDBFactory | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initializes an IndexedDbStorageAdapter instance.
   *
   * @param options - Configuration options for database name, store name, and IDBFactory.
   */
  constructor(options?: IndexedDbStorageAdapterOptions) {
    this.dbName = options?.dbName ?? "dem_offline_store";
    this.storeName = options?.storeName ?? "manager_states";

    if (options?.idbFactory) {
      this.idbFactory = options.idbFactory;
    } else if (typeof indexedDB !== "undefined") {
      this.idbFactory = indexedDB;
    } else if (typeof window !== "undefined" && window.indexedDB) {
      this.idbFactory = window.indexedDB;
    } else if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
      this.idbFactory = (globalThis as any).indexedDB;
    }
  }

  /**
   * Retrieves or initializes the underlying IDBDatabase connection.
   *
   * @returns A promise resolving to the IDBDatabase instance.
   * @throws {DEMError} Throws DEMErrorCode.STORAGE_NOT_SUPPORTED when IndexedDB is unavailable.
   */
  private async getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (!this.idbFactory) {
      throw new DEMError(
        DEMErrorCode.STORAGE_NOT_SUPPORTED,
        "IndexedDB is not supported in the current environment.",
      );
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.idbFactory!.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "className" });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error("Failed to open IndexedDB"));
      };
    });

    return this.dbPromise;
  }

  /**
   * Persists manager state record to IndexedDB object store.
   *
   * @param className - The name identifier of the manager class.
   * @param state - Complete snapshot of the manager state.
   */
  public async saveManagerState<T = unknown>(
    className: string,
    state: StoredManagerState<T>,
  ): Promise<void> {
    if (!this.idbFactory) return;
    try {
      const db = await this.getDb();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const record = { ...state, className };
        const req = store.put(record);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Graceful error fallback
    }
  }

  /**
   * Retrieves stored manager state from IndexedDB store.
   *
   * @param className - The name identifier of the manager class.
   * @returns Parsed state object or null if absent.
   */
  public async loadManagerState<T = unknown>(
    className: string,
  ): Promise<StoredManagerState<T> | null> {
    if (!this.idbFactory) return null;
    try {
      const db = await this.getDb();
      return new Promise<StoredManagerState<T> | null>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        const req = store.get(className);

        req.onsuccess = () => {
          if (req.result && typeof req.result.revision === "number") {
            resolve(req.result as StoredManagerState<T>);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  /**
   * Removes saved manager state for given class name from IndexedDB.
   *
   * @param className - The name identifier of the manager class.
   */
  public async clearManagerState(className: string): Promise<void> {
    if (!this.idbFactory) return;
    try {
      const db = await this.getDb();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const req = store.delete(className);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Purges all stored records in the IndexedDB object store.
   */
  public async clearAll(): Promise<void> {
    if (!this.idbFactory) return;
    try {
      const db = await this.getDb();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Ignore
    }
  }
}
