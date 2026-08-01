/**
 * MCP server factory.
 * Creates configured MCP server instances with tools and resources.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION, TOKENLESS_MODE } from "../config.js";
import { logger, fingerprintToken } from "../logger.js";
import { sessionStore } from "../store/sessions.js";
import { getServerToken } from "../auth/tokens.js";
import { registerTools, MCP_INSTRUCTIONS } from "./tools.js";
import { registerResources } from "./resources.js";

/** Track all active MCP server instances for broadcasting */
const activeServers = new Set<McpServer>();

/**
 * Get all active MCP server instances.
 */
export function getActiveServers(): ReadonlySet<McpServer> {
  return activeServers;
}

/** Broadcast a session update to every MCP resource subscriber that can see it. */
export async function notifySession(sessionId: string): Promise<void> {
  const session = sessionStore.get(sessionId);
  const uris: string[] = [];

  if (!TOKENLESS_MODE && session?.token) {
    uris.push(`thinking://sessions?token=${encodeURIComponent(session.token)}`);
  }

  for (const server of activeServers) {
    if (!TOKENLESS_MODE) {
      const serverToken = getServerToken(server);
      if (session?.token && serverToken !== session.token) continue;
    }

    try {
      for (const uri of uris) {
        await server.server.sendResourceUpdated({ uri });
      }
      await server.server.sendResourceListChanged();
    } catch (err) {
      logger.debug("session.notify.error", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!TOKENLESS_MODE && session?.token) {
    logger.debug("session.notify", { sessionId, tokenFp: fingerprintToken(session.token) });
  } else {
    logger.debug("session.notify", { sessionId });
  }
}

/**
 * Create a new MCP server instance with all tools and resources registered.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    instructions: MCP_INSTRUCTIONS,
  });

  // Track this server
  activeServers.add(server);
  logger.debug("server.mcp.add", { activeServers: activeServers.size });

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
