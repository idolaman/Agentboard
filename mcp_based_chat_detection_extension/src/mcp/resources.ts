/**
 * MCP resource definitions for the thinking logger.
 *
 * Resources:
 * - thinking://sessions: List of all sessions (filtered by token)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOKENLESS_MODE } from "../config.js";
import { sessionStore } from "../store/sessions.js";
import { getServerToken } from "../auth/tokens.js";

/**
 * Register all thinking logger resources on an MCP server.
 */
export function registerResources(server: McpServer): void {
  server.resource(
    "sessions-index",
    "thinking://sessions",
    async () => {
      const boundToken = getServerToken(server);

      // Token-scoped sessions stay private; trusted local hook sessions are unscoped.
      const sessions = TOKENLESS_MODE
        ? sessionStore.list()
        : sessionStore.list(boundToken);

      // Build appropriate URI
      const uri = TOKENLESS_MODE
        ? "thinking://sessions"
        : boundToken
          ? `thinking://sessions?token=${encodeURIComponent(boundToken)}`
          : "thinking://sessions";

      return {
        contents: [{
          uri,
          text: JSON.stringify(sessions, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // Enable resource list change notifications
  server.server.registerCapabilities({ resources: { listChanged: true } });
}
