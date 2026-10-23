# F13: Dynamic Access Control & Startup Middleware

## 1. Description
Provides entity-level access control and dynamic authorization filtering across socket connections.
Filters entities visible to specific clients during startup and real-time broadcasts.
Restricts delta synchronization change streams to authorized object identifier sets.

## 2. Core Components
- `startupMiddleware`: Asynchronous filter function evaluating entity visibility per connected socket.
- `knownObjectIdsBySocket`: Server mapping tracking authorized entity IDs for each client socket.
- Dynamic socket permission filters: Evaluates creation broadcasts against client access definitions.
- Change tracker permission integration: Filters mutation entries by client authorized identifier sets.

## 3. Operational Rules
- Execute `startupMiddleware` for each client socket during initial startup negotiation.
- Store authorized object identifiers in `knownObjectIdsBySocket` for subsequent event filtering.
- Filter delta sync change logs using the client socket's authorized identifier set.
- Suppress real-time creation and update broadcasts for entities unauthorized for a given socket.

## 4. Key Interfaces
- `AccessDefinitions`: Configuration container specifying per-manager middleware functions.
- `startupMiddleware(objects, managers, socket)`: Filters entity array based on socket credentials.

## 5. Edge Cases
- Dynamic permission changes mid-session must update `knownObjectIdsBySocket` immediately.
- Revoking entity access must trigger client-side entity removal without breaking relational graphs.
- Middleware throwing unhandled exceptions must abort the handshake safely with `UNAUTHORIZED` code.
