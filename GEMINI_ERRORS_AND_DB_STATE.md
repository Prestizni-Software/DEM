# DEM Server Database State Verification and Error Code Architecture

## Overview

DEM verifies server database states before loading operations start.
DEM provides standard error codes and descriptions for all errors.

## Database State Verification

DEM previously loaded data before inspecting server database connection states.
Query operations executed before database connections were established.

### Verification Mechanism

1. `AUSManagerFactory` creates manager instances.
2. `AUSManagerFactory` calls `checkServerDbStates()`.
3. The function inspects the `readyState` of each model database connection.
4. If connection state is not connected (`readyState !== 1`), DEM throws `DEMError`.
5. The thrown error code is `DEMErrorCode.DB_NOT_CONNECTED`.
6. DEM cancels data loading when database connections are not ready.
7. `AutoUpdateServerManager.preLoad()` also calls `this.assertDbConnected()`.

### Connection States

- `0`: Disconnected
- `1`: Connected (Permitted)
- `2`: Connecting
- `3`: Disconnecting
- `99`: Uninitialized

## Error Communication Channels

DEM communicates errors to host systems through six channels.

### 1. Typed Error Exceptions

All thrown errors inherit from `DEMError`.
Each error includes an error code, a descriptive message, and a timestamp.

```ts
throw new DEMError(DEMErrorCode.MISSING_ARGUMENT, "Missing required argument: classParam");
```

### 2. Result Objects

Methods returning result objects supply the error code:

- `ServerResponse<T>` provides `code?: DEMErrorCode`.
- `setValue()` provides `{ success: false, code: DEMErrorCode, msg: string }`.
- `deleteObject()` provides `{ success: false, code: DEMErrorCode, message: string }`.

### 3. Event Emitter Channel

DEM emits unhandled errors through the `emitter` instance.
Host systems register listeners for system-level errors:

```ts
emitter.on("error", (error: DEMError) => {
  // Process library error
});
```

### 4. Structured Logger Integration

DEM logs errors via configured `LoggersType`.
Log records prefix the error code to the message string.

### 5. Database State Inspection API

Host applications inspect database readiness programmatically:

```ts
const status = manager.checkDbState();
// status: { connected: boolean, readyState: number, stateName: string }

checkServerDbStates(managers, loggers, emitter);
```

### 6. Error Description Registry

DEM exports `DEM_ERROR_DESCRIPTIONS` and `getDEMErrorDescription()`.
Host systems query error descriptions without catching live instances.

## Error Codes Catalog

- `DEM_ERR_DB_NOT_CONNECTED`: Database is not connected.
- `DEM_ERR_DB_OPERATION_FAILED`: Database query operation failed.
- `DEM_ERR_DB_SAVE_FAILED`: Saving document failed.
- `DEM_ERR_DB_DELETE_FAILED`: Deleting document failed.
- `DEM_ERR_MANAGERS_NOT_INITIALIZED`: Manager collection is not initialized.
- `DEM_ERR_PRELOAD_FAILED`: Preloading documents failed.
- `DEM_ERR_LOAD_REFERENCES_FAILED`: Resolving references failed.
- `DEM_ERR_OBJECT_LOAD_FAILED`: Loading object failed.
- `DEM_ERR_STARTUP_FAILED`: Startup synchronization failed.
- `DEM_ERR_VERSION_MISMATCH`: Client and server versions do not match.
- `DEM_ERR_MISSING_ARGUMENT`: Required argument is missing.
- `DEM_ERR_MISSING_ID`: Document identifier is missing.
- `DEM_ERR_INVALID_ARGUMENT`: Supplied argument is invalid.
- `DEM_ERR_INVALID_CONSTRUCTOR`: Provided class constructor is invalid.
- `DEM_ERR_INVALID_MODEL`: Provided Mongoose model is invalid.
- `DEM_ERR_UNKNOWN_EVENT`: Event name is unrecognized.
- `DEM_ERR_UNDEFINED_EVENT`: Event listener is not registered.
- `DEM_ERR_CANNOT_SET_REF_DIRECTLY`: Reference pointers forbid direct writes.
- `DEM_ERR_OBJECT_NOT_FOUND`: Memory object was not found.
- `DEM_ERR_DOCUMENT_NOT_FOUND`: Database document was not found.
- `DEM_ERR_OBJECT_CREATE_FAILED`: Creating document failed.
- `DEM_ERR_OBJECT_DELETE_FAILED`: Destroying document failed.
- `DEM_ERR_ACCESS_DENIED`: Authorization middleware rejected request.
- `DEM_ERR_TIMEOUT`: Requested operation timed out.
- `DEM_ERR_INTERNAL_ERROR`: Internal library failure occurred.
