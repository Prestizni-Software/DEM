# Smart Lazy Loading Architecture

We implemented configurable Smart Lazy Loading in DEM alongside default eager hydration. Managers in lazy mode stream lightweight entity manifests with human-readable descriptors during startup and resolve reference graphs on demand up to a configurable depth (default 2). Self-contained snapshot entities require no new primitives because classes omitting `@populatedRef` already present raw data directly.

## Status

Accepted

## Context

DEM previously hydrated all entities and resolved all relationships eagerly during client manager startup. Large datasets and historical archives caused severe memory bloat, high initial network transfer sizes, and redundant relation traversal. In addition, archived entities store consolidated audit histories and embedded snapshots.

Investigation confirmed that entities omitting `@populatedRef` already return raw stored data without triggering cross-manager resolution. Consequently, no new static object type or reference suppression decorator is required.

## Considered Options

1. **Strict Eager Loading**: Continue loading all entities and cross-manager references at startup. Rejected due to memory exhaustion on archived data.
2. **Dedicated Static Object Primitives**: Create `@rawRef` decorators or separate static object classes. Rejected because omitting `@populatedRef` provides this behavior natively.
3. **Smart Lazy Loading with Manifest Descriptors**: Configurable hydration modes supporting lightweight startup manifests, two-phase explicit graph hydration up to depth 2, and native self-contained snapshot entities. Accepted.

## Consequences

- Startup manifests transmit `{ _id, description }` descriptors generated via static class methods, allowing immediate UI listing with minimal overhead.
- Entities in lazy mode require explicit asynchronous preparation (`await manager.loadObject(id, { depth })` or `await obj.ensureLoaded({ depth })`) before reading synchronous getters.
- Server graph traversal collects nested references up to the target depth in a single network round-trip, using visited ID sets to avoid circular loops.
- Self-contained archived entities simply omit `@populatedRef` and use `@classProp`, requiring zero changes to reference resolution logic.
