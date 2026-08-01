/**
 * Express HTTP server setup and route handlers.
 * Handles MCP protocol over HTTP with SSE support.
 */

import crypto from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { TOKENLESS_MODE } from "../config.js";
import { logger, fingerprintToken } from "../logger.js";
import {
  readTokenFromHeaders,
  validateSessionToken,
  tryBindToken,
  bindServerToken,
  bindSessionServer,
  unbindSession,
  registerTokenResource,
} from "../auth/tokens.js";
import { createMcpServer } from "../mcp/factory.js";
import { createHookEventHandler, type HookEventSink } from "./hook-events.js";

// ─────────────────────────────────────────────────────────────────────────────
// Transport Registry
// ─────────────────────────────────────────────────────────────────────────────

/** Maps MCP session IDs to their transport */
const transports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Get a transport by session ID.
 */
export function getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
  return transports[sessionId];
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────────────────────────────────────

const corsOptions: cors.CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-thinking-token",
    "thinking-token",
    "mcp-token",
    "mcp-session-id",
    "mcp-protocol-version",
  ],
  exposedHeaders: ["mcp-session-id"],
  maxAge: 86400,
};

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC Error Responses
// ─────────────────────────────────────────────────────────────────────────────

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /: Handle MCP initialization and JSON-RPC message flow.
 */
async function handlePost(req: Request, res: Response): Promise<void> {
  const reqId = crypto.randomUUID();
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const token = TOKENLESS_MODE ? undefined : readTokenFromHeaders(req.headers);

  logger.debug("http.request", {
    reqId,
    method: "POST",
    route: "/",
    sessionId,
    hasToken: Boolean(token),
    tokenFp: token ? fingerprintToken(token) : undefined,
    client: req.ip,
    userAgent: req.headers["user-agent"],
  });

  try {
    // ── Existing session ──
    if (sessionId && transports[sessionId]) {
      // Validate token consistency
      if (!TOKENLESS_MODE) {
        const validation = validateSessionToken(sessionId, token);
        if (!validation.valid) {
          logger.warn("auth.token_mismatch", {
            reqId,
            sessionId,
            tokenFp: fingerprintToken(validation.providedToken),
            boundTokenFp: fingerprintToken(validation.boundToken),
          });
          jsonRpcError(res, 403, -32003, "Token mismatch for session");
          return;
        }

        // Try late binding if no token was bound yet
        if (token && tryBindToken(sessionId, token)) {
          logger.info("token.bind", { reqId, sessionId, tokenFp: fingerprintToken(token) });
        }
      }

      await transports[sessionId].handleRequest(req as any, res as any, req.body);
      logger.debug("rpc.post", { reqId, sessionId });
      return;
    }

    // ── New session (initialization) ──
    if (!sessionId) {
      if (!isInitializeRequest(req.body)) {
        logger.warn("rpc.bad_request", { reqId, reason: "no valid session id provided" });
        jsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
        return;
      }

      // Create MCP server
      const server = createMcpServer();

      // Bind token if provided
      if (!TOKENLESS_MODE && token) {
        bindServerToken(server, token);
        registerTokenResource(server, token);
        logger.info("token.bind", { reqId, sessionPhase: "init", tokenFp: fingerprintToken(token) });
      }

      // Create transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid: string) => {
          transports[sid] = transport;
          bindSessionServer(sid, server);
          if (!TOKENLESS_MODE && token) {
            // Note: bindSessionToken is called via tryBindToken or here
          }
          logger.info("session.open", {
            reqId,
            sessionId: sid,
            hasToken: Boolean(token),
            tokenFp: token ? fingerprintToken(token) : undefined,
          });
        },
        onsessionclosed: (sid: string) => {
          delete transports[sid];
          unbindSession(sid);
          logger.info("session.closed", { sessionId: sid });
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
      logger.info("rpc.init", { reqId });
      return;
    }

    // ── Unknown session ID ──
    logger.warn("rpc.session_not_found", { reqId, sessionId });
    jsonRpcError(res, 404, -32001, "Session not found");
  } catch (err) {
    logger.error("rpc.internal_error", {
      error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
    });
    if (!res.headersSent) res.status(500).end();
  }
}

/**
 * GET /: Handle SSE stream per session.
 */
async function handleGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const token = TOKENLESS_MODE ? undefined : readTokenFromHeaders(req.headers);
  const transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    logger.warn("sse.invalid_session", { sessionId });
    jsonRpcError(res, 400, -32000, "Invalid or missing session ID");
    return;
  }

  // Validate token consistency
  if (!TOKENLESS_MODE) {
    const validation = validateSessionToken(sessionId!, token);
    if (!validation.valid) {
      logger.warn("auth.token_mismatch", {
        sessionId,
        tokenFp: fingerprintToken(validation.providedToken),
        boundTokenFp: fingerprintToken(validation.boundToken),
      });
      jsonRpcError(res, 403, -32003, "Token mismatch for session");
      return;
    }

    // Try late binding
    if (token && tryBindToken(sessionId!, token)) {
      logger.info("token.bind", { sessionId, tokenFp: fingerprintToken(token) });
    }
  }

  try {
    logger.info("sse.open", {
      sessionId,
      hasToken: Boolean(token),
      tokenFp: token ? fingerprintToken(token) : undefined,
    });
    await transport.handleRequest(req as any, res as any);
  } catch (err) {
    logger.error("sse.error", {
      sessionId,
      error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
    });
    if (!res.headersSent) res.status(500).end();
  }
}

/**
 * DELETE /: Terminate a session.
 */
async function handleDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const token = TOKENLESS_MODE ? undefined : readTokenFromHeaders(req.headers);
  const transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    logger.warn("session.terminate.invalid_session", { sessionId });
    jsonRpcError(res, 400, -32000, "Invalid or missing session ID");
    return;
  }

  // Validate token consistency
  if (!TOKENLESS_MODE) {
    const validation = validateSessionToken(sessionId!, token);
    if (!validation.valid) {
      logger.warn("auth.token_mismatch", {
        sessionId,
        tokenFp: fingerprintToken(validation.providedToken),
        boundTokenFp: fingerprintToken(validation.boundToken),
      });
      jsonRpcError(res, 403, -32003, "Token mismatch for session");
      return;
    }
  }

  try {
    logger.info("session.terminate", { sessionId });
    await transport.handleRequest(req as any, res as any);
  } catch (err) {
    logger.error("session.terminate.error", {
      sessionId,
      error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
    });
    if (!res.headersSent) res.status(500).end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Express App
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and configure the Express application.
 */
interface CreateAppOptions {
  hookEventSink?: HookEventSink;
}

export function createApp(options: CreateAppOptions = {}): express.Application {
  const app = express();

  // Middleware
  app.use(cors(corsOptions));
  app.options("/", cors(corsOptions));
  app.use(express.json());

  // Routes
  app.post("/hooks/events", createHookEventHandler(options.hookEventSink));
  app.post("/", handlePost);
  app.get("/", handleGet);
  app.delete("/", handleDelete);

  return app;
}
