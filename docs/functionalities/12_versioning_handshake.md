# F12: Semantic Versioning & Handshake Negotiation

## 1. Description
Verifies client and server protocol and package version compatibility during connection handshakes.
Enforces semantic versioning rules to prevent runtime desynchronization caused by schema mismatches.
Rejects incompatible clients before processing data synchronization payloads.

## 2. Core Components
- `DEM_CLIENT_VERSION` & `DEM_SERVER_VERSION`: Hardcoded semver version constants in `version.ts`.
- `verifyDEMVersion`: Version comparison utility evaluating semver major and minor compatibility.
- `DEMVersionOptions`: Client configuration controlling strict version matching and mismatch callbacks.
- `EVENT_VERSION`: Socket handshake channel transmitting server version details upon connection.

## 3. Operational Rules
- Transmit `clientVersion` in the startup handshake payload for each manager.
- Permit connections when major and minor semver numbers match between client and server.
- Reject connections when major or minor versions differ, returning `DEMErrorCode.VERSION_MISMATCH`.
- Permit patch version divergences with optional non-blocking warning notifications.

## 4. Key Interfaces
- `verifyDEMVersion(clientVer, serverVer, options)`: Returns compatibility verdict and status.
- `DEMVersionOptions`: Interface defining `strictVersionMatch` and `onVersionMismatch` hooks.

## 5. Edge Cases
- Missing version strings in legacy client or server handshakes must trigger configurable fallback behavior.
- Pre-release semver tags (e.g. `0.2.0-beta.1`) must parse cleanly without crashing the comparator.
- Incompatible client connection must be terminated cleanly without leaving dangling server listeners.
