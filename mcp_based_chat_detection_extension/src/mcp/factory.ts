/**
 * MCP server factory.
 * Creates configured MCP server instances with tools and resources.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION, TOKENLESS_MODE } from "../config.js";
import { logger, fingerprintToken } from "../logger.js";
import { sessionStore } from "../store/sessions.js";
import { getServerToken } from "../auth/tokens.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

/** Track all active MCP server instances for broadcasting */
const activeServers = new Set<McpServer>();

/**
 * Get all active MCP server instances.
 */
export function getActiveServers(): ReadonlySet<McpServer> {
  return activeServers;
}

/**
 * Create a notification function for a specific MCP server.
 * Broadcasts session updates to all relevant servers.
 */
function createNotifier(server: McpServer) {
  return async function notifySession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId);
    const uris: string[] = [];

    // Build URIs to notify
    if (!TOKENLESS_MODE && session?.token) {
      uris.push(`thinking://sessions?token=${encodeURIComponent(session.token)}`);
    }

    // Broadcast to all connected servers
    for (const srv of activeServers) {
      // In tokenless mode, notify all servers
      // Otherwise, only notify servers bound to the same token
      if (!TOKENLESS_MODE) {
        const srvToken = getServerToken(srv);
        if (session?.token && srvToken !== session.token) continue;
      }

      try {
        for (const uri of uris) {
          await srv.server.sendResourceUpdated({ uri });
        }
        await srv.server.sendResourceListChanged();
      } catch (err) {
        // Client may be disconnected - log at debug level
        logger.debug("session.notify.error", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Log notification
    if (!TOKENLESS_MODE && session?.token) {
      logger.debug("session.notify", { sessionId, tokenFp: fingerprintToken(session.token) });
    } else {
      logger.debug("session.notify", { sessionId });
    }
  };
}

/**
 * Create a new MCP server instance with all tools and resources registered.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Track this server
  activeServers.add(server);
  logger.debug("server.mcp.add", { activeServers: activeServers.size });

  // Create notifier bound to this server
  const notifySession = createNotifier(server);

  // Register tools and resources
  registerTools(server, notifySession);
  registerResources(server);

  return server;
}

/**
 * Remove a server from the active set.
 * Call this when a server connection is closed.
 */
export function removeServer(server: McpServer): void {
  activeServers.delete(server);
  logger.debug("server.mcp.remove", { activeServers: activeServers.size });
}

