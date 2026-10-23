# F14: Structured Error Subsystem & Diagnostic Codes

## 1. Description
Provides a standardized error hierarchy with explicit numeric diagnostic error codes.
Facilitates reliable error classification, logging, and cross-tier error serialization over sockets.
Enables precise client-side recovery workflows based on machine-readable error codes.

## 2. Core Components
- `DEMErrorCode` enum: Enumerated numeric diagnostic constants covering network, database, and validation errors.
- `DEMError`: Custom error class encapsulating error code, diagnostic message, and stack trace.
- `toDEMError`: Utility converting arbitrary unknown thrown values into typed `DEMError` instances.
- Socket error wrappers: Serializes `DEMError` into wire-compatible `ServerResponse` acknowledgment packets.

## 3. Operational Rules
- Attach an explicit `DEMErrorCode` to every failure, timeout, or validation rejection.
- Transmit numeric error codes in socket acknowledgment responses (`res.code`).
- Convert foreign or third-party runtime exceptions using `toDEMError` before propagation.
- Preserve error codes across local storage adapter persistence and retrieval cycles.

## 4. Key Interfaces
- `DEMErrorCode`: Numeric enumeration of 30+ standardized diagnostic error codes.
- `ServerResponse<T>`: Wire response contract containing `success`, `data`, `message`, and `code`.
- `DEMError`: Error object containing `code: DEMErrorCode` and `message: string`.

## 5. Edge Cases
- Network timeout during socket emission must wrap into `DEMErrorCode.TIMEOUT`.
- Unknown third-party database exceptions must map to `DEMErrorCode.DATABASE_ERROR`.
- Deserializing corrupted error objects from sockets must safely fallback to generic failure codes.
