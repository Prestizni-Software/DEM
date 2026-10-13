# DEM Modular Delta Synchronization & Change-Tracking System

## Overview

The DEM Delta Synchronization subsystem provides high-performance, modular mutation tracking and incremental synchronization.
When enabled, managers track object lifecycle mutations (`create`, `update`, `delete`) with monotonic revision numbers. Clients can persist manager state locally using pluggable storage adapters (`MemoryStorageAdapter`, `LocalStorageAdapter`, `IndexedDbStorageAdapter`) and, upon reconnecting or starting up, request only the mutations that occurred since their last known revision, bypassing full dataset transfers and redundant object instantiations.

---

## Architectural Principles

1. **Strict Zero-Impact Modularity (Opt-In / Addon-Ready)**:
   - When disabled (the default), DEM operates with zero overhead and full backwards compatibility.
   - All delta synchronization logic is encapsulated in `src/sync/`.
2. **Monotonic Revision Sequence**:
   - Every mutating operation (`createObject`, `setValue__`, `deleteObject`) increments the manager's revision number.
3. **Pluggable Storage Adapters**:
   - Implements `IClientStorageAdapter`:
     - `MemoryStorageAdapter`: In-memory storage, ideal for node tests and ephemeral sessions.
     - `LocalStorageAdapter`: Web browser synchronous key-value storage with storage quota safeguards.
     - `IndexedDbStorageAdapter`: Web browser asynchronous persistent storage, ideal for large datasets (>10MB).
4. **Configurable History Pruning**:
   - Configurable limits via `ServerDeltaSyncOptions`:
     - `maxAgeMs`: Time-to-live for historical entries (e.g., 7 days).
     - `maxSizeBytes`: Maximum estimated memory footprint in bytes or MB.
     - `maxEntries`: Maximum number of retained mutation records.
     - `pruneMode`: `"either"` (prune if age OR size exceeded) or `"both"` (prune only if age AND size exceeded).
5. **Fallback Strategy**:
   - If a client's last revision is older than the server's lowest retained revision (`isExpired: true`), the server safely falls back to a clean full sync.
6. **Security & Permission Awareness**:
   - Delta sync honors dynamic permissions (`startupMiddleware`). If configured, mutation logs are filtered so clients only receive changes for objects to which they have active access.

---

## Component Architecture

```mermaid
flowchart TD
    subgraph Server [DEM Server]
        AUSM[AutoUpdateServerManager] --> SCT[ServerChangeTracker]
        SCT --> Prune[Prune Engine (TTL / Size / Both)]
        AUSM --> Handlers[EVENT_STARTUP Delta / Full Handler]
    end

    subgraph Client [DEM Client]
        AUCM[AutoUpdateClientManager] --> Storage[IClientStorageAdapter]
        AUCM --> CSR[ClientStateReconciler]
    end

    AUCM -- "startup<ClassName> (lastRevision)" --> AUSM
    AUSM -- "status: 'up-to-date'" --> AUCM
    AUSM -- "status: 'delta' (changes[])" --> CSR
    AUSM -- "status: 'full' (fallback)" --> AUCM
    CSR -- "persists reconciled state" --> Storage
```

---

## Configuration & Usage

### Server Setup

```typescript
import { AUSManagerFactory, ServerDeltaSyncOptions } from "@prestizni-software/dem-publisher";

const deltaSync: ServerDeltaSyncOptions = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxSizeBytes: 10 * 1024 * 1024,      // 10 MB
  pruneMode: "either",                 // Prune if older than 7 days OR > 10 MB
};

const serverManagers = await AUSManagerFactory(
  {
    Company: {
      class: CompanyServer,
      options: { deltaSync },
    },
  },
  loggers,
  ioServer,
);
```

### Client Setup

```typescript
import {
  AUCManagerFactory,
  LocalStorageAdapter,
  IndexedDbStorageAdapter,
} from "@prestizni-software/dem-publisher";

// Use LocalStorage or IndexedDB for persistence
const storage = new IndexedDbStorageAdapter("my_app_dem_store");

const clientManagers = await AUCManagerFactory(
  { Company: CompanyClient },
  loggers,
  clientSocket,
  false,
  undefined,
  {},
  undefined,
  { storage }, // ClientDeltaSyncOptions
);
```

---

## Test Verification

- `tests/sync_change_tracker.test.ts`: Monotonic revision increments, pruning by age/size/count, "either" vs "both" prune modes, and `getChangesSince`.
- `tests/sync_storage_adapters.test.ts`: `MemoryStorageAdapter`, `LocalStorageAdapter`, and `IndexedDbStorageAdapter` persistence and deletion.
- `tests/sync_reconciler.test.ts`: In-memory state restoration and mutation application (`create`, `update`, `delete`).
- `tests/sync_delta_integration.test.ts`: End-to-end integration tests with Socket.IO:
  1. Initial full sync persists state + revision.
  2. Reconnection with 0 mutations returns `up-to-date` without re-creating objects.
  3. Reconnection with mutations applies creates, updates, and deletes with callback dispatch.
  4. Expired revision automatically triggers safe full sync fallback.
- `tests/sync_real_data_stress.test.ts`: Real production stress test suite on 8,500+ objects across 11 classes:
  1. **MemoryStorageAdapter Real Data Test**: Full sync ingestion of 8500+ objects, server mutations, reconnect delta reconciliation with 0 object reloads.
  2. **LocalStorageAdapter Real Data Test**: Persistence to key-value storage backend, server mutations, reconnect delta reconciliation.
  3. **IndexedDbStorageAdapter Real Data Test**: Persistence to async IndexedDB store, server mutations, reconnect delta reconciliation.
  4. **Rapid Disconnect/Reconnect Stress Test**: 5 continuous rounds of client disconnects, concurrent server batch mutations across classes, and reconnections.
  5. **Mid-Run Dynamic Limits Adjustment**: Dynamic update of `maxSizeBytes` and `maxAgeMs` via `updateOptions()`, immediate history eviction, and safe full-sync fallback.

