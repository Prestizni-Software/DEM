# F05: Client Manager Lifecycle & Aggregated Startup

## 1. Description
Orchestrates client-side manager creation, startup handshake negotiation, and progress tracking.
Aggregates loading progress across multiple managers from 0 to 1.
Handles automated socket reconnections and clean deauthentication shutdowns.

## 2. Core Components
- `AUCManagerFactory`: Primary factory instantiating and synchronizing client managers.
- `AutoUpdateClientManager`: Client entity collection manager maintaining local caches.
- `updateOverallProgress`: Normalizes and aggregates multi-manager loading fractions.
- `_reconnectHandler`: Socket reconnection listener triggering automatic state resynchronization.

## 3. Operational Rules
- Instantiate client managers through `AUCManagerFactory` with connected socket instances.
- Emit loading progress updates incrementally between 0.0 and 1.0.
- Execute `loadFromServer` across all registered managers in parallel.
- Reject initialization promise when any manager fails startup handshake or times out.
- Support configurable startup timeout (`startupTimeoutMs`) via client options or manager properties.
- Ensure failure duration logs compute positive elapsed milliseconds.
- Purge local memory and socket listeners upon manager deauthentication.

## 4. Key Interfaces
- `AUCManagerFactory(defs, loggers, socket, isClient, emitter, callbacks, versionOptions, deltaSyncOptions, lazyLoadingOptions, clientOptions)`: Client factory.
- `loadFromServer(timer, timeoutMs)`: Asynchronous startup handshake requesting manager data with configurable timeout.
- `startupTimeoutMs`: Configurable timeout threshold in milliseconds (default: 5000 ms).
- `deauthenticate()`: Destroys managed entities, removes socket listeners, and cleans global caches.

## 5. Edge Cases
- Network disconnection during initial startup handshake triggers timeout errors and rejects `AUCManagerFactory`.
- Loading error during startup rejects initialization with descriptive error and accurate elapsed time.
- High database latency handled by increasing `startupTimeoutMs`.
- Reconnection bursts deduplicate concurrent in-flight reload operations.
