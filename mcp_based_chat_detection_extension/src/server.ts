import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function appendJSONL(obj: any) {
  fs.appendFileSync(JSONL, JSON.stringify(obj) + "\n", "utf8");
}

// ---- MCP server
const mcp = new McpServer({ name: "thinking-logger", version: "0.1.0" });

async function notifySession(sessionId: string) {
  await mcp.server.sendResourceUpdated({ uri: `thinking://sessions/${sessionId}` });
  await mcp.server.sendResourceListChanged();
}

// START tool
mcp.registerTool(
  "start_message_log",
  {
    title: "Start a thinking chat log",
    description:
      "CRITICAL — MUST RUN FIRST ON EVERY USER MESSAGE.\n- Call immediately before any reasoning or tools.\n- Purpose: log the high-level step you are about to do.\n- Output: returns a session_id string.\n- Requirement: you MUST call end_message_log with this session_id right before your final answer for this message.",
    inputSchema: {
      title: z.string().optional(),
      session_id: z.string()
    }
  },
  async (args, _extra) => {
    const s: Session = {
      id: uuid(),
      started_at: now()
    };
    if (args.title !== undefined) s.title = args.title;

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
      "CRITICAL — MUST RUN LAST BEFORE SENDING YOUR ANSWER FOR THIS MESSAGE.\n- Always call exactly once, even on cancel/error.\n- Input: session_id from start_message_log.\n- Purpose: close the step and persist outcome.",
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

// connect over stdio
await mcp.connect(new StdioServerTransport());
