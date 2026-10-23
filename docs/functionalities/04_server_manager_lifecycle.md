# F04: Server Manager Lifecycle & Initialization

## 1. Description
Orchestrates multi-manager server initialization, database synchronization, and socket server bindings.
Loads documents from MongoDB models in parallel.
Resolves entity relationships across managers in two deterministic phases.

## 2. Core Components
- `AUSManagerFactory`: Root factory instantiating and coordinating server managers.
- `AutoUpdateServerManager`: Primary controller managing entity collections and database persistence.
- `checkServerDbStates`: Diagnostic inspection verifying active database connections and collection states.
- `registerSocket`: Binds client sockets to startup, mutation, and deletion event listeners.

## 3. Operational Rules
- Connect to MongoDB database prior to invoking `AUSManagerFactory`.
- Execute `preLoad` across all managers in parallel to populate `globalCache`.
- Execute `loadReferences` across all managers only after all `preLoad` routines finish.
- Register connected sockets to manager channels using whitelisted event listeners.

## 4. Key Interfaces
- `AUSManagerFactory(defs, socket, loggers, emitter, options)`: Server manager initialization function.
- `preLoad(options)`: Asynchronous document retrieval loading entities into memory.
- `loadReferences()`: Two-phase cross-manager reference resolution routine.

## 5. Edge Cases
- Database connection failure during startup must emit diagnostic error events.
- Empty collections must complete loading immediately without hanging reference promises.
- Rapid client connection bursts before initialization completes must be safely queued.
