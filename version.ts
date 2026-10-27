/**
 * Current version of @prestizni-software/client-dem.
 */
export const DEM_CLIENT_VERSION = "0.10.0";

/**
 * Current version of @prestizni-software/server-dem.
 */
export const DEM_SERVER_VERSION = "0.10.0";

/**
 * Lowest client version that the server is compatible with.
 * Server patches do not increment this value unless breaking compatibility.
 */
export const DEM_MIN_COMPATIBLE_CLIENT_VERSION = "0.10.0";

/**
 * Global DEM version constant indicating minimum compatible client version.
 */
export const DEM_VERSION = DEM_MIN_COMPATIBLE_CLIENT_VERSION;

/**
 * Socket protocol version for DEM communications.
 */
export const DEM_PROTOCOL_VERSION = "1.1.0";
