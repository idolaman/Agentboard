/**
 * Server configuration loaded from environment variables.
 */

/** HTTP port for the MCP server */
export const PORT = Number(process.env.THINKING_LOGGER_HTTP_PORT || "17890");

/**
 * When true, disable token-based session scoping.
 * All sessions become visible to all clients (useful for local development).
 */
export const TOKENLESS_MODE = Boolean(process.env.THINKING_LOGGER_NO_TOKEN);

/** Server metadata */
export const SERVER_NAME = "thinking-logger";
export const SERVER_VERSION = "0.2.0";
