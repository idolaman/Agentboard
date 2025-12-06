/**
 * MCP tool definitions for the thinking logger.
 *
 * Tools:
 * - start_message_log: Begin a new thinking session
 * - end_message_log: Complete a thinking session
 * - before_command_log: Mark start of approval-gated command
 * - after_command_log: Mark end of approval-gated command
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger, fingerprintToken } from "../logger.js";
import { sessionStore } from "../store/sessions.js";
import { getServerToken } from "../auth/tokens.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tool Schemas
// ─────────────────────────────────────────────────────────────────────────────

const startMessageLogSchema = {
  title: z.string(),
  platform: z.enum(["cursor", "chatgpt", "claude", "github", "vscode"]).describe("AI platform/runtime"),
  project: z.string().optional().describe("Project folder name (if applicable)"),
  git_branch: z.string().optional().describe("Project git branch (if applicable)"),
  workspace_path: z.string().describe("Absolute path to the workspace/project root directory (pwd)"),
  estimated_duration: z.number().describe("Estimated time to complete this prompt in seconds"),
  session_id: z.string(),
};

const endMessageLogSchema = {
  session_id: z.string(),
  status: z.enum(["ok", "cancelled", "error"]),
  error: z.string().optional(),
};

const sessionIdOnlySchema = {
  session_id: z.string(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool Descriptions
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DESCRIPTIONS = {
  start: `CRITICAL — MUST RUN FIRST ON EVERY USER MESSAGE.
- Call immediately before any reasoning or tools.
- Purpose: log the high-level step you are about to do.
- Output: returns a session_id string.
- Requirement: you MUST call end_message_log with this session_id right before your final answer for this message.`,

  end: `CRITICAL — MUST RUN LAST BEFORE SENDING YOUR ANSWER FOR THIS MESSAGE.
- Always call exactly once, even on cancel/error.
- If you ran approval-gated commands, you MUST still run this after the final after_command_log.
- Input: session_id from start_message_log.
- Purpose: close the step and persist outcome.`,

  beforeCommand: `CRITICAL — MUST RUN BEFORE APPROVAL-GATED COMMANDS ONLY.
- Scope: shell/CLI runs or MCP calls that may trigger a user-approval dialog in Cursor (e.g., terminal commands, external scripts, package managers).
- Do NOT call for read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).
- Input: session_id from start_message_log.
- Purpose: mark the beginning of an approval-gated action.`,

  afterCommand: `CRITICAL — MUST RUN IMMEDIATELY AFTER APPROVAL-GATED COMMANDS ONLY.
- Always call exactly once per approval-gated action, even on failure.
- Do NOT call after read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).
- Input: session_id from start_message_log.
- Purpose: mark completion of an approval-gated action.`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function getTokenFingerprint(server: McpServer, sessionToken?: string): string | undefined {
  if (sessionToken) return fingerprintToken(sessionToken);
  const serverToken = getServerToken(server);
  return serverToken ? fingerprintToken(serverToken) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all thinking logger tools on an MCP server.
 */
export function registerTools(
  server: McpServer,
  notifySession: (sessionId: string) => Promise<void>
): void {
  // START tool
  server.registerTool(
    "start_message_log",
    {
      title: "Start a thinking chat log",
      description: TOOL_DESCRIPTIONS.start,
      inputSchema: startMessageLogSchema,
    },
    async (args) => {
      const token = getServerToken(server);
      const typedArgs = args as {
        session_id?: string;
        platform: string;
        title: string;
        project?: string;
        git_branch?: string;
        workspace_path: string;
        estimated_duration: number;
      };

      const session = sessionStore.create({
        sessionId: typedArgs.session_id || undefined,
        platform: typedArgs.platform,
        title: typedArgs.title,
        project: typedArgs.project,
        gitBranch: typedArgs.git_branch,
        workspacePath: typedArgs.workspace_path,
        estimatedDuration: typedArgs.estimated_duration,
        token,
      });

      await notifySession(session.id);

      logger.info("tool.start_message_log", {
        thinkingSessionId: session.id,
        platform: session.platform,
        project: session.project,
        git_branch: session.git_branch,
        workspace_path: session.workspace_path,
        estimated_duration: session.estimated_duration,
        hasToken: Boolean(session.token),
        tokenFp: getTokenFingerprint(server, session.token),
      });

      return { content: [{ type: "text", text: session.id }] };
    }
  );

  // END tool
  server.registerTool(
    "end_message_log",
    {
      title: "End a thinking chat log",
      description: TOOL_DESCRIPTIONS.end,
      inputSchema: endMessageLogSchema,
    },
    async (args) => {
      const session = sessionStore.end(args.session_id, args.status, args.error);

      if (!session) {
        logger.warn("tool.end_message_log.unknown_session", {
          thinkingSessionId: args.session_id,
          status: args.status,
          tokenFp: getTokenFingerprint(server),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }

      await notifySession(session.id);

      logger.info("tool.end_message_log", {
        thinkingSessionId: session.id,
        status: session.status,
        hasError: Boolean(args.error),
        tokenFp: getTokenFingerprint(server, session.token),
      });

      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  // BEFORE-COMMAND tool
  server.registerTool(
    "before_command_log",
    {
      title: "Before a CLI/Tool call",
      description: TOOL_DESCRIPTIONS.beforeCommand,
      inputSchema: sessionIdOnlySchema,
    },
    async (args) => {
      const session = sessionStore.markApprovalPending(args.session_id);

      if (!session) {
        logger.warn("tool.before_command_log.unknown_session", {
          thinkingSessionId: args.session_id,
          tokenFp: getTokenFingerprint(server),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }

      await notifySession(session.id);

      logger.info("tool.before_command_log", {
        thinkingSessionId: session.id,
        tokenFp: getTokenFingerprint(server, session.token),
      });

      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  // AFTER-COMMAND tool
  server.registerTool(
    "after_command_log",
    {
      title: "After a CLI/Tool call",
      description: TOOL_DESCRIPTIONS.afterCommand,
      inputSchema: sessionIdOnlySchema,
    },
    async (args) => {
      const session = sessionStore.clearApprovalPending(args.session_id);

      if (!session) {
        logger.warn("tool.after_command_log.unknown_session", {
          thinkingSessionId: args.session_id,
          tokenFp: getTokenFingerprint(server),
        });
        return { content: [{ type: "text", text: "unknown session_id (ignored)" }] };
      }

      await notifySession(session.id);

      logger.info("tool.after_command_log", {
        thinkingSessionId: session.id,
        tokenFp: getTokenFingerprint(server, session.token),
      });

      return { content: [{ type: "text", text: "ok" }] };
    }
  );
}

