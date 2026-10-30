# F07: Entity Lifecycle CRUD Operations

## 1. Description
Manages creation, retrieval, and deletion of entity instances across client and server tiers.
Handles database document persistence, client broadcasts, and cascade cache invalidation.
Suppresses deletion echo storms during distributed entity removals.

## 2. Core Components
- `createObject`: Instantiates new entity, persists database document, and emits creation broadcasts.
- `deleteObject`: Issues remote entity deletion mutation across network and purges confirmed instances.
- `evictObject`: Evicts entity instance from local cache and storage without outbound network emission.
- `destroyImmediate`: Performs synchronous teardown of entity listeners and cache references.

## 3. Operational Rules
- Persist new documents to MongoDB and assign monotonic revisions before client broadcast.
- Emit `new<ClassName>` events containing entity identifiers or manifest descriptors.
- Remove deleted entity identifiers from `globalCache` and parent manager collections.
- Execute `evictObject` when processing remote deletion socket events or delta sync to prevent deletion echo storms.

## 4. Key Interfaces
- `createObject(data: Partial<T>): Promise<T>`: Entity creation method.
- `deleteObject(_id: MongoId)`: Active network mutation deletion method.
- `evictObject(_id: MongoId)`: Local state cache eviction method.
- `destroy(once?: boolean)`: Entity instance destruction method.

## 5. Edge Cases
- Deleting an already deleted entity must return success with an idempotent confirmation.
- Creation failure in database must not broadcast unpersisted entity identifiers to clients.
- Deleting an entity referenced by active array proxies must safely nullify back-references.
