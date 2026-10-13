/**
 * Standard error codes for the DEM library.
 */
export enum DEMErrorCode {
  // Database and connection errors
  DB_NOT_CONNECTED = "DEM_ERR_DB_NOT_CONNECTED",
  DB_OPERATION_FAILED = "DEM_ERR_DB_OPERATION_FAILED",
  DB_SAVE_FAILED = "DEM_ERR_DB_SAVE_FAILED",
  DB_DELETE_FAILED = "DEM_ERR_DB_DELETE_FAILED",

  // Lifecycle and loading errors
  MANAGERS_NOT_INITIALIZED = "DEM_ERR_MANAGERS_NOT_INITIALIZED",
  PRELOAD_FAILED = "DEM_ERR_PRELOAD_FAILED",
  LOAD_REFERENCES_FAILED = "DEM_ERR_LOAD_REFERENCES_FAILED",
  OBJECT_LOAD_FAILED = "DEM_ERR_OBJECT_LOAD_FAILED",
  STARTUP_FAILED = "DEM_ERR_STARTUP_FAILED",
  VERSION_MISMATCH = "DEM_ERR_VERSION_MISMATCH",

  // Validation and argument errors
  MISSING_ARGUMENT = "DEM_ERR_MISSING_ARGUMENT",
  MISSING_ID = "DEM_ERR_MISSING_ID",
  INVALID_ARGUMENT = "DEM_ERR_INVALID_ARGUMENT",
  INVALID_CONSTRUCTOR = "DEM_ERR_INVALID_CONSTRUCTOR",
  INVALID_MODEL = "DEM_ERR_INVALID_MODEL",
  INVALID_EVENT = "DEM_ERR_INVALID_EVENT",
  UNKNOWN_EVENT = "DEM_ERR_UNKNOWN_EVENT",
  UNDEFINED_EVENT = "DEM_ERR_UNDEFINED_EVENT",
  PROPERTY_NOT_FOUND = "DEM_ERR_PROPERTY_NOT_FOUND",
  CANNOT_SET_REF_DIRECTLY = "DEM_ERR_CANNOT_SET_REF_DIRECTLY",

  // Entity and reference errors
  OBJECT_NOT_FOUND = "DEM_ERR_OBJECT_NOT_FOUND",
  DOCUMENT_NOT_FOUND = "DEM_ERR_DOCUMENT_NOT_FOUND",
  OBJECT_CREATE_FAILED = "DEM_ERR_OBJECT_CREATE_FAILED",
  OBJECT_DELETE_FAILED = "DEM_ERR_OBJECT_DELETE_FAILED",
  OBJECT_GET_FAILED = "DEM_ERR_OBJECT_GET_FAILED",
  REFERENCE_RESOLUTION_FAILED = "DEM_ERR_REFERENCE_RESOLUTION_FAILED",
  PRELOAD_TIMEOUT = "DEM_ERR_PRELOAD_TIMEOUT",

  // Access and security errors
  ACCESS_DENIED = "DEM_ERR_ACCESS_DENIED",
  UNAUTHORIZED = "DEM_ERR_UNAUTHORIZED",

  // Network and socket errors
  SOCKET_NOT_CONNECTED = "DEM_ERR_SOCKET_NOT_CONNECTED",
  SOCKET_FAILURE = "DEM_ERR_SOCKET_FAILURE",
  TIMEOUT = "DEM_ERR_TIMEOUT",

  // Storage and sync errors
  STORAGE_NOT_SUPPORTED = "DEM_ERR_STORAGE_NOT_SUPPORTED",
  STORAGE_OPERATION_FAILED = "DEM_ERR_STORAGE_OPERATION_FAILED",
  DELTA_SYNC_FAILED = "DEM_ERR_DELTA_SYNC_FAILED",

  // General internal error
  INTERNAL_ERROR = "DEM_ERR_INTERNAL_ERROR",
}

/**
 * Standard descriptions for DEM error codes.
 */
export const DEM_ERROR_DESCRIPTIONS: Record<DEMErrorCode, string> = {
  [DEMErrorCode.DB_NOT_CONNECTED]:
    "Database is not in connected state. Establish connection before loading.",
  [DEMErrorCode.DB_OPERATION_FAILED]:
    "Database operation failed during execution.",
  [DEMErrorCode.DB_SAVE_FAILED]:
    "Saving document to database failed.",
  [DEMErrorCode.DB_DELETE_FAILED]:
    "Deleting document from database failed.",
  [DEMErrorCode.MANAGERS_NOT_INITIALIZED]:
    "Manager registry is not initialized.",
  [DEMErrorCode.PRELOAD_FAILED]:
    "Pre-loading data from data source failed.",
  [DEMErrorCode.LOAD_REFERENCES_FAILED]:
    "Resolving cross-manager references failed.",
  [DEMErrorCode.OBJECT_LOAD_FAILED]:
    "Loading object data failed.",
  [DEMErrorCode.STARTUP_FAILED]:
    "Receiving initial startup data from server failed.",
  [DEMErrorCode.VERSION_MISMATCH]:
    "DEM version mismatch detected between client and server.",
  [DEMErrorCode.MISSING_ARGUMENT]:
    "A required argument is missing.",
  [DEMErrorCode.MISSING_ID]:
    "Object identifier is missing or invalid.",
  [DEMErrorCode.INVALID_ARGUMENT]:
    "Provided argument is invalid.",
  [DEMErrorCode.INVALID_CONSTRUCTOR]:
    "Model constructor provided to manager is invalid.",
  [DEMErrorCode.INVALID_MODEL]:
    "Mongoose model for class is invalid or unavailable.",
  [DEMErrorCode.INVALID_EVENT]:
    "Incoming socket event payload format is invalid.",
  [DEMErrorCode.UNKNOWN_EVENT]:
    "Socket event type is unrecognized.",
  [DEMErrorCode.UNDEFINED_EVENT]:
    "Socket event listener is not registered.",
  [DEMErrorCode.PROPERTY_NOT_FOUND]:
    "Requested property does not exist on object.",
  [DEMErrorCode.CANNOT_SET_REF_DIRECTLY]:
    "Reference pointers cannot receive direct value assignments.",
  [DEMErrorCode.OBJECT_NOT_FOUND]:
    "Requested object was not found in cache or collection.",
  [DEMErrorCode.DOCUMENT_NOT_FOUND]:
    "Requested document was not found in database.",
  [DEMErrorCode.OBJECT_CREATE_FAILED]:
    "Creating new object failed.",
  [DEMErrorCode.OBJECT_DELETE_FAILED]:
    "Deleting object failed.",
  [DEMErrorCode.OBJECT_GET_FAILED]:
    "Fetching object failed.",
  [DEMErrorCode.REFERENCE_RESOLUTION_FAILED]:
    "Resolving property reference failed.",
  [DEMErrorCode.PRELOAD_TIMEOUT]:
    "Preload operation exceeded timeout limit.",
  [DEMErrorCode.ACCESS_DENIED]:
    "Access denied by authorization middleware.",
  [DEMErrorCode.UNAUTHORIZED]:
    "Request is unauthorized.",
  [DEMErrorCode.SOCKET_NOT_CONNECTED]:
    "Socket connection is not open.",
  [DEMErrorCode.SOCKET_FAILURE]:
    "Socket transport communication failed.",
  [DEMErrorCode.TIMEOUT]:
    "Operation timed out.",
  [DEMErrorCode.STORAGE_NOT_SUPPORTED]:
    "Storage adapter is not supported in this runtime environment.",
  [DEMErrorCode.STORAGE_OPERATION_FAILED]:
    "Storage read or write operation failed.",
  [DEMErrorCode.DELTA_SYNC_FAILED]:
    "Delta synchronization reconciliation failed.",
  [DEMErrorCode.INTERNAL_ERROR]:
    "Internal DEM library error occurred.",
};

/**
 * Returns the human-readable description for a given error code.
 *
 * @param code - The DEM error code enum value.
 * @returns Standard descriptive message corresponding to the error code.
 */
export function getDEMErrorDescription(code: DEMErrorCode): string {
  return DEM_ERROR_DESCRIPTIONS[code] || "Unknown error.";
}

/**
 * Standard typed Error class for DEM.
 * Enforces structured error codes and optional diagnostic payloads.
 */
export class DEMError extends Error {
  public readonly code: DEMErrorCode;
  public readonly details?: unknown;
  public readonly timestamp: number;

  /**
   * Constructs a new DEMError instance.
   *
   * @param code - The typed error code.
   * @param message - Descriptive error message.
   * @param details - Optional arbitrary diagnostic data.
   */
  constructor(code: DEMErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = "DEMError";
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, DEMError.prototype);
  }

  /**
   * Serializes the error instance to a JSON-compatible object.
   *
   * @returns Plain object representation of the DEMError.
   */
  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Converts an unknown caught error or object into a typed DEMError instance.
 *
 * @param err - The caught error or value.
 * @param defaultCode - Fallback error code when the source is not a DEMError.
 * @returns Standard DEMError instance.
 */
export function toDEMError(
  err: unknown,
  defaultCode: DEMErrorCode = DEMErrorCode.INTERNAL_ERROR,
): DEMError {
  if (err instanceof DEMError) {
    return err;
  }
  if (err instanceof Error) {
    return new DEMError(defaultCode, err.message, { originalError: err });
  }
  return new DEMError(defaultCode, String(err));
}
