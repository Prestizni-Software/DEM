# F10: Persistent Storage Adapters & Offline Snapshots

## 1. Description
Provides client-side state persistence across browser restarts, page reloads, and network outages.
Saves complete manager state snapshots including revision numbers, entities, and lazy manifests.
Restores cached entities into local memory to enable immediate offline user interface rendering.

## 2. Core Components
- `IClientStorageAdapter`: Pluggable storage backend interface with save, load, and purge contracts.
- `MemoryStorageAdapter`: In-memory isolated storage backend for Node.js environments and testing.
- `LocalStorageAdapter`: Browser `window.localStorage` implementation with namespaced storage keys.
- `IndexedDbStorageAdapter`: Browser `indexedDB` implementation for high-capacity binary and object caching.
- `ClientStateReconciler.persistToStorage` & `restoreFromStorage`: Core snapshot serialization engine.

## 3. Operational Rules
- Serialize complete manager state snapshots upon startup, on-demand hydration, and entity mutations.
- Retain lazy stubs with `__isLazyStub` flags and entity descriptors in stored snapshots.
- Restore cached entity instances into memory before initiating server network handshake requests.
- Preserve locally hydrated entity instances when reconnecting to servers streaming lazy manifests.

## 4. Key Interfaces
- `StoredManagerState<T>`: Persistent state schema containing revision, IDs, objects, and manifests.
- `saveManagerState(className, state)`: Asynchronously writes manager snapshot to storage provider.
- `loadManagerState(className)`: Asynchronously retrieves manager snapshot from storage provider.

## 5. Edge Cases
- Quota exceeded errors during storage writes must be handled gracefully without throwing unhandled rejections.
- Corrupted JSON or unparseable state in storage must return null to initiate fresh sync.
- Restoring from storage when offline must permit synchronous reading of cached entity properties.
