# F07: Entity Lifecycle CRUD Operations

## 1. Description
Manages creation, retrieval, and deletion of entity instances across client and server tiers.
Handles database document persistence, client broadcasts, and cascade cache invalidation.
Suppresses deletion echo storms during distributed entity removals.

## 2. Core Components
- `createObject`: Instantiates new entity, persists database document, and emits creation broadcasts.
- `deleteObject`: Destroys entity instance, cleans local caches, and invalidates relational pointers.
- `destroyImmediate`: Performs synchronous teardown of entity listeners and cache references.
- `isRemote` deletion flag: Suppresses re-emitting deletion socket events on remote broadcasts.

## 3. Operational Rules
- Persist new documents to MongoDB and assign monotonic revisions before client broadcast.
- Emit `new<ClassName>` events containing entity identifiers or manifest descriptors.
- Remove deleted entity identifiers from `globalCache` and parent manager collections.
- Set `isRemote = true` when processing remote deletion events to prevent echo storms.

## 4. Key Interfaces
- `createObject(data: Partial<T>): Promise<T>`: Entity creation method.
- `deleteObject(_id: MongoId, isRemote?: boolean)`: Entity deletion method.
- `destroy(once?: boolean, isRemote?: boolean)`: Entity instance destruction method.

## 5. Edge Cases
- Deleting an already deleted entity must return success with an idempotent confirmation.
- Creation failure in database must not broadcast unpersisted entity identifiers to clients.
- Deleting an entity referenced by active array proxies must safely nullify back-references.
