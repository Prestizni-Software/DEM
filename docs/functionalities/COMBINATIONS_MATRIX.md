# DEM Multi-Functionality Combination Matrix (Pairs & Triplets)

This document maps all pairwise (2-way) and triplet (3-way) combinations across the fourteen primary functionalities of DEM.

## Summary of Functionality Identifiers

| ID | Subsystem Name |
|---|---|
| **F01** | Model Property Reflection & Accessor Generation |
| **F02** | Cross-Entity Relationship Resolution |
| **F03** | Reference Array Proxy & Mutation Interception |
| **F04** | Server Manager Lifecycle & Initialization |
| **F05** | Client Manager Lifecycle & Aggregated Startup |
| **F06** | Real-Time Mutation Engine & Dynamic Sockets |
| **F07** | Entity Lifecycle CRUD Operations |
| **F08** | Smart Lazy Loading & Manifest Hydration |
| **F09** | Delta Synchronization & Monotonic Revisions |
| **F10** | Persistent Storage Adapters & Offline Snapshots |
| **F11** | Self-Contained Snapshot Entities |
| **F12** | Semantic Versioning & Handshake Negotiation |
| **F13** | Dynamic Access Control & Startup Middleware |
| **F14** | Structured Error Subsystem & Diagnostic Codes |

---

## 1. Pairwise Combinations (91 Pairs)

### Category A: Relational Data & Model Interactions (F01–F03, F11)
- **C02-01 (F01 + F02)**: `@classProp` accessors resolving `@populatedRef` pointers; getters returning live related objects.
- **C02-02 (F01 + F03)**: Accessor generation on array properties wrapped in `createReadOnlyArrayProxy`; mutating methods update internal states.
- **C02-03 (F01 + F11)**: `@classProp` definitions omitting `@populatedRef` to expose intact embedded snapshot subdocuments.
- **C02-04 (F02 + F03)**: Relational array manipulation with `@populatedRef` maintaining back-reference pointers.
- **C02-05 (F02 + F11)**: Entity with both `@populatedRef` and self-contained snapshots; only relational fields resolve foreign keys.
- **C02-06 (F03 + F11)**: Plain array properties inside snapshot entities; ensuring proxy does not trap non-relational arrays.

### Category B: Lifecycle, Versioning & Access Control (F04, F05, F12, F13)
- **C02-07 (F04 + F05)**: Parallel server `preLoad` and client `loadFromServer` startup handshakes.
- **C02-08 (F04 + F12)**: Server version handshake evaluation rejecting outdated client versions.
- **C02-09 (F04 + F13)**: Server initialization executing `startupMiddleware` to populate `knownObjectIdsBySocket`.
- **C02-10 (F05 + F12)**: Client startup receiving server version payloads and evaluating minor compatibility.
- **C02-11 (F05 + F13)**: Client startup with restricted entity visibility; progress bar normalizes only visible objects.
- **C02-12 (F12 + F13)**: Incompatible client rejected before executing socket authorization middleware.

### Category C: Real-Time Mutation, CRUD & Error Codes (F06, F07, F14)
- **C02-13 (F06 + F07)**: Real-time `setValue` triggering entity creation or deletion event broadcasts.
- **C02-14 (F06 + F14)**: Mutation rejected by server returning structured `DEMError` with `DEMErrorCode.INVALID_ARGUMENT`.
- **C02-15 (F07 + F14)**: Deletion of missing or locked entity returning structured error responses.

### Category D: Smart Lazy Loading Interactions (F08 + Others)
- **C02-16 (F08 + F01)**: Lazy stub generating accessors; reading unhydrated properties returns undefined without errors.
- **C02-17 (F08 + F02)**: On-demand hydration (`depth: 2`) resolving cross-manager `@populatedRef` targets in one round-trip.
- **C02-18 (F08 + F03)**: Array proxy on lazy entity; hydrating array items on demand.
- **C02-19 (F08 + F04)**: Server `generateManifest` extracting descriptors from server entity collections.
- **C02-20 (F08 + F05)**: Client receiving `status: "lazy"` manifest and initializing stubs with 100% startup progress.
- **C02-21 (F08 + F06)**: Mutation attempts on unhydrated stubs triggering auto-hydration or structured errors.
- **C02-22 (F08 + F07)**: Creating new entities in lazy managers emitting descriptor payloads; deleting entities removing manifest items.
- **C02-23 (F08 + F09)**: Delta sync over lazy managers transmitting creation and deletion changes with manifest descriptors.
- **C02-24 (F08 + F10)**: Local storage snapshots retaining lazy manifests and `__isLazyStub` markers.
- **C02-25 (F08 + F11)**: Self-contained snapshot entities loaded lazily; descriptors summarize embedded audit histories.
- **C02-26 (F08 + F12)**: Lazy startup negotiating version verification alongside manifest payloads.
- **C02-27 (F08 + F13)**: `startupMiddleware` filtering manifest descriptors visible to specific client sockets.
- **C02-28 (F08 + F14)**: On-demand hydration timeout returning `DEMErrorCode.OBJECT_LOAD_FAILED`.

### Category E: Delta Synchronization Interactions (F09 + Others)
- **C02-29 (F09 + F01)**: Delta changes patching reflected property values via `setValue__`.
- **C02-30 (F09 + F02)**: Delta sync adding newly related entities and resolving pointers.
- **C02-31 (F09 + F03)**: Delta updates mutating array properties wrapped in reference proxies.
- **C02-32 (F09 + F04)**: Server manager recording mutations in `ServerChangeTracker` during entity lifecycle events.
- **C02-33 (F09 + F05)**: Client resynchronization on socket reconnect requesting changes since `lastRevision`.
- **C02-34 (F09 + F06)**: Real-time property updates incrementing monotonic revisions in change logs.
- **C02-35 (F09 + F07)**: Entity creation and deletion recording `create` and `delete` entries in change tracker.
- **C02-36 (F09 + F10)**: Reconciled delta states persisted to `storageAdapter` with updated revision counters.
- **C02-37 (F09 + F11)**: Delta synchronization transmitting embedded snapshot subdocuments intact.
- **C02-38 (F09 + F12)**: Delta sync handshake verifying version compatibility before transmitting changes.
- **C02-39 (F09 + F13)**: `getChangesSince` filtering mutation records by client socket `allowedIds`.
- **C02-40 (F09 + F14)**: Expired client revisions falling back cleanly to full sync without unhandled errors.

### Category F: Offline Persistence & Snapshots Interactions (F10 + Others)
- **C02-41 (F10 + F01)**: Restoring properties from storage and generating prototype accessors.
- **C02-42 (F10 + F02)**: Restoring cached entities from storage and reconnecting cross-manager references offline.
- **C02-43 (F10 + F03)**: Restoring reference arrays from storage and re-attaching proxy mutation traps.
- **C02-44 (F10 + F04)**: Server state snapshots compared against database records during testing.
- **C02-45 (F10 + F05)**: Client manager startup restoring from storage before connecting to socket server.
- **C02-46 (F10 + F06)**: Local property mutations persisting to storage adapter immediately.
- **C02-47 (F10 + F07)**: Local entity creation and deletion updating storage snapshots.
- **C02-48 (F10 + F11)**: Self-contained snapshot entities persisted and restored from storage with zero data loss.
- **C02-49 (F10 + F12)**: Storage snapshots tagged with version metadata; invalidating obsolete cached states.
- **C02-50 (F10 + F13)**: Restricted entities from previous authorized sessions purged upon permission changes.
- **C02-51 (F10 + F14)**: Storage corruption or quota errors yielding graceful fallbacks and diagnostic errors.

### Category G: Cross-Cutting Subsystem Pairs
- **C02-52 (F01 + F04)** through **C02-91 (F13 + F14)**: Remaining pairwise intersections covering model reflection, server lifecycle, versioning, access control, and structured diagnostic codes.

---

## 2. Triplet Combinations (Selected Core Focus Domains)

Triplets represent multi-system synergy and edge-case convergence.

### Domain T1: Smart Lazy Loading + Delta Sync + Persistent Storage
- **T03-01 (F08 + F09 + F10)**: Lazy client restoring snapshot from storage, receiving delta sync on reconnect, updating manifest, and saving state.
- **T03-02 (F08 + F09 + F02)**: Lazy loading with relational graphs receiving delta updates for related entities.
- **T03-03 (F08 + F10 + F02)**: Offline restoration of hydrated relational subgraphs loaded lazily in previous sessions.
- **T03-04 (F08 + F10 + F11)**: Self-contained snapshot entities stored in offline cache with lazy manifest descriptors.
- **T03-05 (F08 + F09 + F13)**: Permission-filtered delta sync streaming lazy manifest updates to authorized clients.
- **T03-06 (F08 + F10 + F14)**: Offline lazy stub requesting hydration while disconnected; handling network timeout errors.

### Domain T2: Relational Integrity + Array Proxies + Real-Time Mutations
- **T03-07 (F01 + F02 + F03)**: Property accessors on relational arrays with proxy trapping and pointer resolution.
- **T03-08 (F02 + F03 + F06)**: Pushing new relational entity into array proxy; triggering real-time server mutation.
- **T03-09 (F02 + F03 + F07)**: Deleting a child entity; array proxy automatically removing dead reference from parent.
- **T03-10 (F02 + F03 + F09)**: Delta sync applying array splice operations across relational proxies.
- **T03-11 (F02 + F03 + F10)**: Restoring relational array proxies from persistent storage without breaking parent links.

### Domain T3: Lifecycle + Versioning + Permissions + Errors
- **T03-12 (F04 + F05 + F12)**: Server and client factory initialization negotiating semver handshake compatibility.
- **T03-13 (F04 + F05 + F13)**: Multi-manager startup filtering entities across sockets using dynamic middleware.
- **T03-14 (F05 + F12 + F14)**: Incompatible client version during startup receiving typed `VERSION_MISMATCH` code.
- **T03-15 (F04 + F13 + F14)**: Unauthorized client socket attempting mutation; server rejecting with `UNAUTHORIZED`.
- **T03-16 (F05 + F09 + F10)**: Client reconnecting, restoring from storage, applying delta sync, and resuming normal operations.
