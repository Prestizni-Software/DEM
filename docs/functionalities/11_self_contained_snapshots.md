# F11: Self-Contained Snapshot Entities

## 1. Description
Provides support for historical archive entities, audit logs, and embedded subdocuments.
Declares models using `@classProp` while omitting `@populatedRef` annotations.
Disables relational resolution, returning raw scalar values or nested snapshot documents directly.

## 2. Core Components
- `@classProp` annotation: Exposes embedded subdocuments or raw scalar snapshot records.
- `handleDataCleanup`: Retains intact object subdocuments when reference metadata is absent.
- Static snapshot entity classes: Models designed for immutable historical records.

## 3. Operational Rules
- Omit `@populatedRef` annotations to prevent cross-manager foreign key resolution.
- Read nested snapshot properties synchronously from local memory without network latency.
- Preserve subdocument structure during data normalization and extraction operations.
- Persist embedded snapshot trees directly into local storage adapter backends.

## 4. Key Interfaces
- `ExtractedData<T>`: Serialized data representation preserving nested plain object subdocuments.
- `AutoUpdatedClientObject<T>`: Client entity base class providing synchronous property accessors.

## 5. Edge Cases
- Embedded subdocuments containing nested `_id` fields must not be confused with foreign entity references.
- Circular references inside embedded JSON objects must be handled without memory leaks.
- Mutating nested snapshot subdocuments must trigger reactivity or explicit update events.
