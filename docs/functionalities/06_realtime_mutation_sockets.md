# F06: Real-Time Mutation Engine & Dynamic Sockets

## 1. Description
Provides bidirectional real-time property mutation synchronization over Socket.IO connections.
Applies property updates locally, transmits mutation requests, and broadcasts confirmed updates.
Protects against event injection using dynamic socket event whitelisting.

## 2. Core Components
- `setValue` / `setValue__`: Core mutation method updating entity properties and triggering persistence.
- `EVENT_UPDATE`: Namespaced socket update event channel format (`update<ClassName><id>`).
- `socket.eventNames()`: Dynamic event whitelist inspecting active listeners on connected sockets.
- `silent` mutation flag: Executes in-memory state modifications without socket or database broadcasts.

## 3. Operational Rules
- Validate property names against class schema before transmitting update payloads.
- Transmit updates over dedicated per-entity socket event channels.
- Whitelist dynamic update event names on the server socket before accepting payloads.
- Broadcast confirmed property updates to all subscribed client sockets.

## 4. Key Interfaces
- `setValue(key: string, val: unknown): Promise<{ success: boolean; msg: string }>`: Mutation call.
- `ServerUpdateRequest<T>`: Payload contract containing entity identifier, property key, and new value.

## 5. Edge Cases
- Submitting updates for missing identifiers must return `DEMErrorCode.MISSING_ID`.
- Concurrent mutations on identical properties must serialize deterministically without deadlocks.
- Socket disconnection during in-flight updates must reject the promise with network timeout.
