# DEM Library Functionality Catalog

This directory contains detailed technical specifications for all fourteen primary functionalities and subsystems of the DEM library.

## Subsystems Index

1. [F01: Model Property Reflection & Accessor Generation](01_model_property_reflection.md)
   Reflection metadata, dynamic properties, getter and setter interceptors, and data extraction.

2. [F02: Cross-Entity Relationship Resolution](02_cross_entity_references.md)
   Single and array reference links across managers, pointer resolution, and circular loop protection.

3. [F03: Reference Array Proxy & Mutation Interception](03_reference_array_proxy.md)
   Array proxies, mutating array method traps, raw array symbols, and back-reference synchronization.

4. [F04: Server Manager Lifecycle & Initialization](04_server_manager_lifecycle.md)
   Factory orchestration, parallel pre-load, two-phase reference resolution, database checks, and socket rooms.

5. [F05: Client Manager Lifecycle & Aggregated Startup](05_client_manager_lifecycle.md)
   Client factories, multi-manager progress aggregation, socket reconnection handling, and deauthentication cleanup.

6. [F06: Real-Time Mutation Engine & Dynamic Sockets](06_realtime_mutation_sockets.md)
   Granular property updates, dynamic socket listeners, listener whitelists, and internal silent updates.

7. [F07: Entity Lifecycle CRUD Operations](07_entity_lifecycle_crud.md)
   Local and remote entity creation, cascade deletion, echo suppression, and immediate destruction.

8. [F08: Smart Lazy Loading & Manifest Hydration](08_smart_lazy_loading.md)
   Lightweight startup manifests, descriptors, unhydrated lazy stubs, on-demand graph hydration, and cycle detection.

9. [F09: Delta Synchronization & Monotonic Revisions](09_delta_sync_revisions.md)
   Change log tracking, monotonic sequence counters, circular history pruning, and delta reconciliation.

10. [F10: Persistent Storage Adapters & Offline Snapshots](10_offline_storage_snapshots.md)
    Storage adapters, local snapshots, state persistence, offline restoration, and manifest retention.

11. [F11: Self-Contained Snapshot Entities](11_self_contained_snapshots.md)
    Audited history entities, embedded subdocuments without reference metadata, and synchronous property access.

12. [F12: Semantic Versioning & Handshake Negotiation](12_versioning_handshake.md)
    Protocol and package version verification, semantic compatibility checks, and connection rejection.

13. [F13: Dynamic Access Control & Startup Middleware](13_dynamic_permissions.md)
    Per-socket entity filtering, allowed identifier tracking, and unauthorized change suppression.

14. [F14: Structured Error Subsystem & Diagnostic Codes](14_error_handling_codes.md)
    Custom DEMError hierarchy, typed numeric codes, error serialization, and network timeout handling.

## Combinations and Subagent Tasking

- [All 2-Way and 3-Way Combinations Matrix](COMBINATIONS_MATRIX.md)
- [Subagent Tasking and Dispatch Plan](SUBAGENT_DISPATCH_PLAN.md)
