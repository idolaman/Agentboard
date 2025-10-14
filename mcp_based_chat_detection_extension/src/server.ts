import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import cors from "cors";
import { logger, fingerprintToken } from "./logger.js";

type Status = "ok" | "cancelled" | "error";
type Session = {
  id: string;
  model?: string;
  workspace?: string;
  title?: string;
  platform: string;
  project?: string;
  git_branch?: string;
  started_at: string; // ISO
  ended_at?: string;  // ISO
  status?: Status;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
  approval_pending_since?: string; // ISO when waiting for user approval
  token?: string; // Optional per-user token to scope visibility
};

const sessions = new Map<string, Session>();

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }

// Track token associations and registered resources per MCP server instance
const serverToToken = new WeakMap<McpServer, string>();
const registeredTokenUris = new WeakMap<McpServer, Set<string>>();
const sessionIdToServer: Record<string, McpServer> = {};
const sessionIdToToken: Record<string, string> = {};

function readTokenFromHeaders(headers: Request["headers"]): string | undefined {
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const v = auth.slice(7).trim();
    if (v) return v;
  }
  const headerNames = ["x-thinking-token", "thinking-token", "mcp-token"] as const;
  for (const name of headerNames) {
    const raw = headers[name as keyof Request["headers"]] as any;
    if (Array.isArray(raw)) {
      if (raw[0] && typeof raw[0] === "string") return raw[0];
    } else if (typeof raw === "string" && raw) {
      return raw;
    }
  }
  return undefined;
}

function registerTokenResource(mcp: McpServer, token: string): void {
  const uri = `thinking://sessions?token=${encodeURIComponent(token)}`;
  let set = registeredTokenUris.get(mcp);
  if (!set) {
    set = new Set<string>();
    registeredTokenUris.set(mcp, set);
  }
  if (set.has(uri)) return;

  // Use a short stable id derived from token
  const id = `sessions-index-${crypto.createHash("sha256").update(token).digest("hex").slice(0, 8)}`;
  mcp.resource(
    id,
    uri,
    async (_uri) => {
      const list = Array.from(sessions.values())
        .filter((s) => s.token === token)
        .sort((a, b) => (b.started_at.localeCompare(a.started_at)));
      return { contents: [{ uri, text: JSON.stringify(list, null, 2), mimeType: "application/json" }] };
    }
  );
  set.add(uri);
  // Notify this client that new resources are available (ignore if not connected yet)
  mcp.server.sendResourceListChanged().catch(() => {});
  logger.debug("resource.register", { tokenFp: fingerprintToken(token) });
}

const activeServers = new Set<McpServer>();
function createMcpServer() {
  const mcp = new McpServer({ name: "thinking-logger", version: "0.1.0" });
  activeServers.add(mcp);
  logger.debug("server.mcp.add", { activeServers: activeServers.size });

  async function notifySession(sessionId: string) {
    const uris: string[] = [];
    const s = sessions.get(sessionId);
    if (s?.token) {
      uris.push(`thinking://sessions?token=${encodeURIComponent(s.token)}`);
    }
    // Broadcast updates to all connected MCP servers so every UI session refreshes
    for (const srv of activeServers) {
      // Only notify servers bound to the same token to avoid cross-tenant leakage
      const srvToken = serverToToken.get(srv);
      if (s?.token && srvToken !== s.token) continue;
      try {
        for (const uri of uris) {
          await srv.server.sendResourceUpdated({ uri });
        }
        await srv.server.sendResourceListChanged();
      } catch {}
    }
    if (s?.token) {
      logger.debug("session.notify", { sessionId, tokenFp: fingerprintToken(s.token) });
    } else {
      logger.debug("session.notify", { sessionId });
    }
  }

  // START tool
  mcp.registerTool(
    "start_message_log",
    {
      title: "Start a thinking chat log",
      description:
        "CRITICAL — MUST RUN FIRST ON EVERY USER MESSAGE.\n- Call immediately before any reasoning or tools.\n- Purpose: log the high-level step you are about to do.\n- Output: returns a session_id string.\n- Requirement: you MUST call end_message_log with this session_id right before your final answer for this message.",
      inputSchema: {
        title: z.string(),
        platform: z.enum(["cursor", "chatgpt", "claude", "github", "vscode"]).describe("AI platform/runtime"),
        project: z.string().optional().describe("Project folder name (if applicable)"),
        git_branch: z.string().optional().describe("Project git branch (if applicable)"),
        session_id: z.string()
      }
    },
    async (args, extra) => {
      const s: Session = {
        id: (args as any).session_id ? String((args as any).session_id) : uuid(),
        platform: String((args as any).platform),
        started_at: now()
      };
      if (args.title !== undefined) s.title = args.title;
      if ((args as any).project !== undefined) s.project = String((args as any).project);
      if ((args as any).git_branch !== undefined) s.git_branch = String((args as any).git_branch);

      // Attach token if this MCP server instance has one associated
      const tok = serverToToken.get(mcp);
      if (tok) s.token = tok;

      sessions.set(s.id, s);

      await notifySession(s.id);

      logger.info("tool.start_message_log", {
        thinkingSessionId: s.id,
        platform: s.platform,
        project: s.project,
        git_branch: s.git_branch,
        hasToken: Boolean(s.token),
        tokenFp: (s.token ? fingerprintToken(s.token) : (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined)),
      });
      return { content: [{ type: "text", text: s.id }] };
    }
  );

  // END tool
  mcp.registerTool(
    "end_message_log",
    {
      title: "End a thinking chat log",
      description:
        "CRITICAL — MUST RUN LAST BEFORE SENDING YOUR ANSWER FOR THIS MESSAGE.\n- Always call exactly once, even on cancel/error.\n- If you ran approval-gated commands, you MUST still run this after the final after_command_log.\n- Input: session_id from start_message_log.\n- Purpose: close the step and persist outcome.",
      inputSchema: {
        session_id: z.string(),
        status: z.enum(["ok", "cancelled", "error"]),
        error: z.string().optional()
      }
    },
    async (args, _extra) => {
      const s = sessions.get(args.session_id);
      if (!s) {
        logger.warn("tool.end_message_log.unknown_session", {
          thinkingSessionId: args.session_id,
          status: args.status,
          tokenFp: (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      s.ended_at = now();
      s.status = args.status;
      if (args.error) s.error = args.error;


      await notifySession(s.id);

      logger.info("tool.end_message_log", {
        thinkingSessionId: s.id,
        status: s.status,
        hasError: Boolean(args.error),
        tokenFp: (s.token ? fingerprintToken(s.token) : (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined)),
      });
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  // BEFORE-COMMAND tool
  mcp.registerTool(
    "before_command_log",
    {
      title: "Before a CLI/Tool call",
      description:
        "CRITICAL — MUST RUN BEFORE APPROVAL-GATED COMMANDS ONLY.\n- Scope: shell/CLI runs or MCP calls that may trigger a user-approval dialog in Cursor (e.g., terminal commands, external scripts, package managers).\n- Do NOT call for read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).\n- Input: session_id from start_message_log.\n- Purpose: mark the beginning of an approval-gated action.",
      inputSchema: {
        session_id: z.string()
      }
    },
    async (args, _extra) => {
      const s = sessions.get(args.session_id);
      if (!s) {
        logger.warn("tool.before_command_log.unknown_session", {
          thinkingSessionId: args.session_id,
          tokenFp: (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      const ts = now();
      s.approval_pending_since = ts;
      await notifySession(s.id);
      logger.info("tool.before_command_log", {
        thinkingSessionId: s.id,
        tokenFp: (s.token ? fingerprintToken(s.token) : (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined)),
      });
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  // AFTER-COMMAND tool
  mcp.registerTool(
    "after_command_log",
    {
      title: "After a CLI/Tool call",
      description:
        "CRITICAL — MUST RUN IMMEDIATELY AFTER APPROVAL-GATED COMMANDS ONLY.\n- Always call exactly once per approval-gated action, even on failure.\n- Do NOT call after read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).\n- Input: session_id from start_message_log.\n- Purpose: mark completion of an approval-gated action.",
      inputSchema: {
        session_id: z.string()
      }
    },
    async (args, _extra) => {
      const s = sessions.get(args.session_id);
      if (!s) {
        logger.warn("tool.after_command_log.unknown_session", {
          thinkingSessionId: args.session_id,
          tokenFp: (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      const ts = now();
      delete s.approval_pending_since;
      await notifySession(s.id);
      logger.info("tool.after_command_log", {
        thinkingSessionId: s.id,
        tokenFp: (s.token ? fingerprintToken(s.token) : (serverToToken.get(mcp) ? fingerprintToken(serverToToken.get(mcp)!) : undefined)),
      });
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  mcp.resource(
    "sessions-index",
    "thinking://sessions",
    async (_uri: URL) => {
      // Without a token, return an empty list to avoid leaking data
      const boundToken = serverToToken.get(mcp);
      const list = boundToken
        ? Array.from(sessions.values())
            .filter((s) => s.token === boundToken)
            .sort((a, b) => (b.started_at.localeCompare(a.started_at)))
        : [];
      return { contents: [{ uri: boundToken ? `thinking://sessions?token=${encodeURIComponent(boundToken)}` : "thinking://sessions", text: JSON.stringify(list, null, 2), mimeType: "application/json" }] };
    }
  );

  mcp.server.registerCapabilities({ resources: { listChanged: true } });

  return mcp;
}

// HTTP/SSE server with proper session management (supports multiple concurrent Cursor clients)
const PORT = Number(process.env.THINKING_LOGGER_HTTP_PORT || "17890");
const app = express();
// Allow CORS so Authorization and custom MCP headers work behind proxies/CDNs (e.g., Vercel)
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
app.use(cors(corsOptions));
app.options("/", cors(corsOptions));
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST: handle initialization and JSON-RPC message flow
app.post("/", async (req: Request, res: Response) => {
  try {
    const reqId = crypto.randomUUID();
    const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
    const tokenHeader = readTokenFromHeaders(req.headers);
    logger.debug("http.request", {
      reqId,
      method: req.method,
      route: "/",
      kind: "POST",
      sessionId: sessionIdHeader,
      hasToken: Boolean(tokenHeader),
      tokenFp: tokenHeader ? fingerprintToken(tokenHeader) : undefined,
      client: req.ip,
      userAgent: req.headers["user-agent"],
    });
    if (sessionIdHeader && transports[sessionIdHeader]) {
      // Enforce token consistency when a session already exists
      const server = sessionIdToServer[sessionIdHeader];
      const boundToken = server ? serverToToken.get(server) : undefined;
      if (boundToken && tokenHeader && boundToken !== tokenHeader) {
        logger.warn("auth.token_mismatch", { reqId, sessionId: sessionIdHeader, tokenFp: fingerprintToken(tokenHeader), boundTokenFp: fingerprintToken(boundToken) });
        res
          .status(403)
          .json({ jsonrpc: "2.0", error: { code: -32003, message: "Token mismatch for session" }, id: null });
        return;
      }
      if (!boundToken && tokenHeader && server) {
        serverToToken.set(server, tokenHeader);
        registerTokenResource(server, tokenHeader);
        sessionIdToToken[sessionIdHeader] = tokenHeader;
        logger.info("token.bind", { reqId, sessionId: sessionIdHeader, tokenFp: fingerprintToken(tokenHeader) });
      }
      await transports[sessionIdHeader].handleRequest(req as any, res as any, req.body);
      logger.debug("rpc.post", { reqId, sessionId: sessionIdHeader });
      return;
    }

    // If no session ID provided, we only accept initialization requests
    if (!sessionIdHeader) {
      if (!isInitializeRequest(req.body)) {
        logger.warn("rpc.bad_request", { reqId, reason: "no valid session id provided" });
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null
          });
        return;
      }
      // Create server first so we can bind mappings in the transport callbacks
      const server = createMcpServer();
      if (tokenHeader) {
        serverToToken.set(server, tokenHeader);
        registerTokenResource(server, tokenHeader);
        logger.info("token.bind", { reqId, sessionPhase: "init", tokenFp: fingerprintToken(tokenHeader) });
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid: string) => {
          transports[sid] = transport;
          // Bind session to server and token
          sessionIdToServer[sid] = server;
          if (tokenHeader) sessionIdToToken[sid] = tokenHeader;
          logger.info("session.open", { reqId, sessionId: sid, hasToken: Boolean(tokenHeader), tokenFp: tokenHeader ? fingerprintToken(tokenHeader) : undefined });
        },
        onsessionclosed: (sid: string) => {
          delete transports[sid];
          delete sessionIdToServer[sid];
          delete sessionIdToToken[sid];
          logger.info("session.closed", { sessionId: sid });
        }
      });
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
      logger.info("rpc.init", { reqId });
      return;
    }

    // Unknown session ID
    logger.warn("rpc.session_not_found", { reqId, sessionId: sessionIdHeader });
    res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
  } catch (err) {
    logger.error("rpc.internal_error", { error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) } });
    if (!res.headersSent) res.status(500).end();
  }
});

// GET: SSE stream per session
app.get("/", async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
  const tokenHeader = readTokenFromHeaders(req.headers);
  const transport = sessionIdHeader ? transports[sessionIdHeader] : undefined;
  if (!transport) {
    logger.warn("sse.invalid_session", { sessionId: sessionIdHeader });
    res
      .status(400)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null });
    return;
  }
  // Enforce token consistency for SSE channel
  const server = sessionIdToServer[sessionIdHeader!];
  const boundToken = server ? serverToToken.get(server) : undefined;
  if (boundToken && tokenHeader && boundToken !== tokenHeader) {
    logger.warn("auth.token_mismatch", { sessionId: sessionIdHeader, tokenFp: fingerprintToken(tokenHeader), boundTokenFp: fingerprintToken(boundToken) });
    res
      .status(403)
      .json({ jsonrpc: "2.0", error: { code: -32003, message: "Token mismatch for session" }, id: null });
    return;
  }
  if (!boundToken && tokenHeader && server) {
    serverToToken.set(server, tokenHeader);
    registerTokenResource(server, tokenHeader);
    if (sessionIdHeader) sessionIdToToken[sessionIdHeader] = tokenHeader;
    logger.info("token.bind", { sessionId: sessionIdHeader, tokenFp: fingerprintToken(tokenHeader) });
  }
  try {
    logger.info("sse.open", { sessionId: sessionIdHeader, hasToken: Boolean(tokenHeader), tokenFp: tokenHeader ? fingerprintToken(tokenHeader) : undefined });
    await transport.handleRequest(req as any, res as any);
  } catch (err) {
    logger.error("sse.error", { sessionId: sessionIdHeader, error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) } });
    if (!res.headersSent) res.status(500).end();
  }
});

// DELETE: terminate a session
app.delete("/", async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
  const tokenHeader = readTokenFromHeaders(req.headers);
  const transport = sessionIdHeader ? transports[sessionIdHeader] : undefined;
  if (!transport) {
    logger.warn("session.terminate.invalid_session", { sessionId: sessionIdHeader });
    res
      .status(400)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null });
    return;
  }
  const server = sessionIdToServer[sessionIdHeader!];
  const boundToken = server ? serverToToken.get(server) : undefined;
  if (boundToken && tokenHeader && boundToken !== tokenHeader) {
    logger.warn("auth.token_mismatch", { sessionId: sessionIdHeader, tokenFp: fingerprintToken(tokenHeader), boundTokenFp: fingerprintToken(boundToken) });
    res
      .status(403)
      .json({ jsonrpc: "2.0", error: { code: -32003, message: "Token mismatch for session" }, id: null });
    return;
  }
  try {
    logger.info("session.terminate", { sessionId: sessionIdHeader });
    await transport.handleRequest(req as any, res as any);
  } catch (err) {
    logger.error("session.terminate.error", { sessionId: sessionIdHeader, error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) } });
    if (!res.headersSent) res.status(500).end();
  }
});

app.listen(PORT, () => {
  logger.info("server.start", { port: PORT, logLevel: logger.level });
});
