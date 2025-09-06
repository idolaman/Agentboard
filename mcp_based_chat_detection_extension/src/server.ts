import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---- tiny storage (in-memory + JSONL append for durability)
type Status = "ok" | "cancelled" | "error";
type Session = {
  id: string;
  client?: string;
  model?: string;
  workspace?: string;
  title?: string;
  started_at: string; // ISO
  ended_at?: string;  // ISO
  status?: Status;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
};

const sessions = new Map<string, Session>();
const events = new Map<string, Array<{ ts: string; type: "start" | "end"; payload?: any }>>();

const DATA_DIR = path.resolve(process.cwd(), "data");
const JSONL = path.join(DATA_DIR, "thinking-sessions.jsonl");
fs.mkdirSync(DATA_DIR, { recursive: true });

// Local hardcoded token for client scoping (can be replaced later by real tokens)
const DEFAULT_CLIENT_TOKEN = "local-dev-token";

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function appendJSONL(obj: any) {
  fs.appendFileSync(JSONL, JSON.stringify(obj) + "\n", "utf8");
}

// ---- Per-session MCP server factory (supports multiple Cursor clients)
function createMcpServer() {
  const mcp = new McpServer({ name: "thinking-logger", version: "0.1.0" });

  async function notifySession(sessionId: string) {
    await mcp.server.sendResourceUpdated({ uri: `thinking://sessions/${sessionId}` });
    await mcp.server.sendResourceListChanged();
    const s = sessions.get(sessionId);
    if (s?.client) {
      try { await mcp.server.sendResourceUpdated({ uri: `thinking://clients/${s.client}/sessions` }); } catch {}
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
        session_id: z.string()
      }
    },
    async (args, extra) => {
      const clientId = String((extra as any)?.requestInfo?.headers?.["x-client-token"] ?? DEFAULT_CLIENT_TOKEN);
      const s: Session = {
        id: uuid(),
        started_at: now()
      };
      if (args.title !== undefined) s.title = args.title;
      s.client = clientId;

      sessions.set(s.id, s);
      events.set(s.id, [{ ts: s.started_at, type: "start", payload: { title: s.title } }]);

      appendJSONL({ type: "start", session: s });
      await notifySession(s.id);

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
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      s.ended_at = now();
      s.status = args.status;
      if (args.error) s.error = args.error;

      const ev = events.get(s.id) ?? [];
      ev.push({ ts: s.ended_at, type: "end", payload: { status: s.status, tokens_in: s.tokens_in, tokens_out: s.tokens_out, error: s.error } });
      events.set(s.id, ev);

      appendJSONL({ type: "end", session_id: s.id, status: s.status, ended_at: s.ended_at, tokens_in: s.tokens_in, tokens_out: s.tokens_out, error: s.error });
      await notifySession(s.id);

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
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      const ts = now();
      const ev = events.get(s.id) ?? [];
      ev.push({ ts, type: "start", payload: { phase: "before_command" } });
      events.set(s.id, ev);
      appendJSONL({ type: "command_before", session_id: s.id, ts });
      await notifySession(s.id);
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
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }
      const ts = now();
      const ev = events.get(s.id) ?? [];
      ev.push({ ts, type: "end", payload: { phase: "after_command" } });
      events.set(s.id, ev);
      appendJSONL({ type: "command_after", session_id: s.id, ts });
      await notifySession(s.id);
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

// RESOURCES: index + per-session timeline (for future UI / quick inspection)
  mcp.resource(
    "sessions-index",
    "thinking://sessions",
    async (_uri) => {
      const list = Array.from(sessions.values()).sort((a, b) => (b.started_at.localeCompare(a.started_at)));
      return { contents: [{ uri: "thinking://sessions", text: JSON.stringify(list, null, 2), mimeType: "application/json" }] };
    }
  );

  mcp.resource(
    "client-sessions",
    new ResourceTemplate("thinking://clients/{client}/sessions", { list: undefined }),
    async (_uri, vars) => {
      const client = (vars as Record<string, string>).client;
      const list = Array.from(sessions.values()).filter(s => s.client === client).sort((a, b) => (b.started_at.localeCompare(a.started_at)));
      return { contents: [{ uri: `thinking://clients/${client}/sessions`, text: JSON.stringify(list, null, 2), mimeType: "application/json" }] };
    }
  );

  mcp.resource(
    "sessions-item",
    new ResourceTemplate("thinking://sessions/{id}", { list: undefined }),
    async (_uri, vars) => {
      const id = (vars as Record<string, string>).id;
      const s = id ? sessions.get(id) : undefined;
      const tl = id ? (events.get(id) ?? []) : [];
      return {
        contents: [{
          uri: `thinking://sessions/${id}`,
          text: JSON.stringify({ session: s ?? null, timeline: tl }, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );

  return mcp;
}

// HTTP/SSE server with proper session management (supports multiple concurrent Cursor clients)
const PORT = Number(process.env.THINKING_LOGGER_HTTP_PORT || "17890");
const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST: handle initialization and JSON-RPC message flow
app.post("/", async (req, res) => {
  try {
    const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
    if (sessionIdHeader && transports[sessionIdHeader]) {
      await transports[sessionIdHeader].handleRequest(req as any, res as any, req.body);
      return;
    }

    // If no session ID provided, we only accept initialization requests
    if (!sessionIdHeader) {
      if (!isInitializeRequest(req.body)) {
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null
          });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports[sid] = transport;
        },
        onsessionclosed: (sid: string) => {
          delete transports[sid];
        }
      });

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
      return;
    }

    // Unknown session ID
    res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
  } catch {
    if (!res.headersSent) res.status(500).end();
  }
});

// GET: SSE stream per session
app.get("/", async (req, res) => {
  const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionIdHeader ? transports[sessionIdHeader] : undefined;
  if (!transport) {
    res
      .status(400)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null });
    return;
  }
  try {
    await transport.handleRequest(req as any, res as any);
  } catch {
    if (!res.headersSent) res.status(500).end();
  }
});

// DELETE: terminate a session
app.delete("/", async (req, res) => {
  const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionIdHeader ? transports[sessionIdHeader] : undefined;
  if (!transport) {
    res
      .status(400)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null });
    return;
  }
  try {
    await transport.handleRequest(req as any, res as any);
  } catch {
    if (!res.headersSent) res.status(500).end();
  }
});

app.listen(PORT);
