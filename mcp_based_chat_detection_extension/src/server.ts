/**
 * Thinking Logger MCP Server
 *
 * Entry point for the MCP server that tracks AI thinking/reasoning sessions.
 *
 * Environment variables:
 *   THINKING_LOGGER_HTTP_PORT - HTTP port (default: 17890)
 *   THINKING_LOGGER_NO_TOKEN  - Disable token-based scoping (for local dev)
 *   THINKING_LOGGER_LOG_LEVEL - Log level: debug, info, warn, error
 */

import { PORT, TOKENLESS_MODE } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./http/app.js";

// Create and start the server
const app = createApp();

app.listen(PORT, () => {
  logger.info("server.start", {
    port: PORT,
    logLevel: logger.level,
    tokenless: TOKENLESS_MODE,
  });
});
