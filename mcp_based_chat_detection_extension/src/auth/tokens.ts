/**
 * Token extraction, validation, and binding logic.
 */

import crypto from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Request } from "express";
import { logger, fingerprintToken } from "../logger.js";
import { TOKENLESS_MODE } from "../config.js";
import { sessionStore } from "../store/sessions.js";

// ─────────────────────────────────────────────────────────────────────────────
// Token-to-Server Bindings
// ─────────────────────────────────────────────────────────────────────────────

/** Maps MCP server instances to their bound token */
const serverToToken = new WeakMap<McpServer, string>();

/** Maps MCP session IDs to their server instance */
const sessionIdToServer: Record<string, McpServer> = {};

/** Maps MCP session IDs to their bound token */
const sessionIdToToken: Record<string, string> = {};

/** Tracks registered token-specific resource URIs per server */
const registeredTokenUris = new WeakMap<McpServer, Set<string>>();

// ─────────────────────────────────────────────────────────────────────────────
// Token Extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Supported token header names (in priority order) */
const TOKEN_HEADERS = ["x-thinking-token", "thinking-token", "mcp-token"] as const;

/**
 * Extract token from request headers.
 * Checks Authorization Bearer token first, then custom headers.
 */
export function readTokenFromHeaders(headers: Request["headers"]): string | undefined {
  // Check Bearer token first
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  // Check custom headers
  for (const name of TOKEN_HEADERS) {
    const raw = headers[name as keyof Request["headers"]] as string | string[] | undefined;
    if (Array.isArray(raw) && raw[0]) return raw[0];
    if (typeof raw === "string" && raw) return raw;
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Binding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the token bound to an MCP server instance.
 */
export function getServerToken(server: McpServer): string | undefined {
  return serverToToken.get(server);
}

/**
 * Bind a token to an MCP server instance.
 */
export function bindServerToken(server: McpServer, token: string): void {
  serverToToken.set(server, token);
}

/**
 * Get the server instance for an MCP session ID.
 */
export function getSessionServer(sessionId: string): McpServer | undefined {
  return sessionIdToServer[sessionId];
}

/**
 * Bind a session ID to a server instance.
 */
export function bindSessionServer(sessionId: string, server: McpServer): void {
  sessionIdToServer[sessionId] = server;
}

/**
 * Bind a session ID to a token.
 */
export function bindSessionToken(sessionId: string, token: string): void {
  sessionIdToToken[sessionId] = token;
}

/**
 * Clean up all bindings for a session.
 */
export function unbindSession(sessionId: string): void {
  delete sessionIdToServer[sessionId];
  delete sessionIdToToken[sessionId];
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Resource Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a token-scoped sessions resource on an MCP server.
 * This allows clients to query sessions filtered by their token.
 */
export function registerTokenResource(server: McpServer, token: string): void {
  const uri = `thinking://sessions?token=${encodeURIComponent(token)}`;

  let registered = registeredTokenUris.get(server);
  if (!registered) {
    registered = new Set();
    registeredTokenUris.set(server, registered);
  }

  // Already registered
  if (registered.has(uri)) return;

  // Create stable resource ID from token hash
  const resourceId = `sessions-index-${crypto.createHash("sha256").update(token).digest("hex").slice(0, 8)}`;

  server.resource(resourceId, uri, async () => {
    const sessions = sessionStore.list(token);
    return {
      contents: [{
        uri,
        text: JSON.stringify(sessions, null, 2),
        mimeType: "application/json",
      }],
    };
  });

  registered.add(uri);

  // Notify client of new resource
  server.server.sendResourceListChanged().catch((err) => {
    logger.debug("resource.register.notify_error", {
      tokenFp: fingerprintToken(token),
      error: err instanceof Error ? err.message : String(err),
    });
  });
  logger.debug("resource.register", { tokenFp: fingerprintToken(token) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Validation
// ─────────────────────────────────────────────────────────────────────────────

export type TokenValidationResult =
  | { valid: true }
  | { valid: false; reason: "mismatch"; boundToken: string; providedToken: string };

/**
 * Validate that a provided token matches the bound token for a session.
 * Returns validation result with details on failure.
 */
export function validateSessionToken(
  sessionId: string,
  providedToken: string | undefined
): TokenValidationResult {
  if (TOKENLESS_MODE) return { valid: true };

  const server = sessionIdToServer[sessionId];
  if (!server) return { valid: true };

  const boundToken = serverToToken.get(server);
  if (!boundToken) return { valid: true };
  if (!providedToken) return { valid: true };

  if (boundToken !== providedToken) {
    return { valid: false, reason: "mismatch", boundToken, providedToken };
  }

  return { valid: true };
}

/**
 * Try to bind a token to a session if not already bound.
 * Returns true if token was newly bound.
 */
export function tryBindToken(sessionId: string, token: string | undefined): boolean {
  if (TOKENLESS_MODE || !token) return false;

  const server = sessionIdToServer[sessionId];
  if (!server) return false;

  const boundToken = serverToToken.get(server);
  if (boundToken) return false; // Already bound

  serverToToken.set(server, token);
  registerTokenResource(server, token);
  sessionIdToToken[sessionId] = token;

  return true;
}

