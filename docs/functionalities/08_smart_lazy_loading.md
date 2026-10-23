# F08: Smart Lazy Loading & Manifest Hydration

## 1. Description
Streams lightweight entity manifests with human-readable descriptors during startup.
Defers entity payload transfer and cross-manager relation resolution until explicitly requested.
Hydrates directed entity subgraphs on demand up to a specified depth in a single round-trip.

## 2. Core Components
- `status: "lazy"` handshake payload: Contains lightweight manifest descriptors and identifier lists.
- `static getDescriptor(data)`: Class hook generating concise human-readable entity descriptions.
- `isLazyStub`: Boolean flag identifying unhydrated entity placeholder instances.
- `loadObject` / `ensureLoaded`: Requests server-side graph hydration up to a designated reference depth.

## 3. Operational Rules
- Transmit `manifest` containing `{ _id, description }` items during lazy manager startup.
- Instantiate unhydrated stubs with `isLazyStub = true` and `isLoaded = false`.
- Traverse entity reference graphs on the server up to depth `N` without circular infinite loops.
- Hydrate root entities and sibling manager related entities into local caches upon response.

## 4. Key Interfaces
- `EntityDescriptor`: Tuple containing entity identifier string and description string.
- `loadObject(_id: MongoId, options?: { depth?: number }): Promise<T>`: On-demand hydration call.
- `ensureLoaded(options?: { depth?: number }): Promise<this>`: Instance-level hydration call.

## 5. Edge Cases
- Requesting hydration for an already hydrated entity must return immediately without socket calls.
- Circular references in lazy subgraphs must terminate cleanly at visited entity identifiers.
- Server returning empty related sets must hydrate root entities without breaking dependencies.
