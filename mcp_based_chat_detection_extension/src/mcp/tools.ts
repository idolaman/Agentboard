/**
 * MCP tool definitions for the thinking logger.
 *
 * These tools implement session lifecycle tracking for AI assistant interactions.
 * The LLM MUST call start_message_log at the beginning and end_message_log at
 * the end of every user message response.
 *
 * Tools:
 * - start_message_log: Begin a new thinking session (ALWAYS FIRST)
 * - end_message_log: Complete a thinking session (ALWAYS LAST)
 * - before_command_log: Mark start of approval-gated command
 * - after_command_log: Mark end of approval-gated command
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger, fingerprintToken } from "../logger.js";
import { sessionStore } from "../store/sessions.js";
import { getServerToken } from "../auth/tokens.js";

// ─────────────────────────────────────────────────────────────────────────────
// MCP Instructions (for system prompt injection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This instruction block should be injected into the MCP server's instructions
 * field to provide high-level guidance to the LLM.
 */
export const MCP_INSTRUCTIONS = `Server: galactic
The Galactic MCP Server tracks your thinking sessions and provides observability for AI interactions.

MANDATORY SESSION LIFECYCLE:
Every response you generate MUST follow this lifecycle:

1. START: Call 'start_message_log' IMMEDIATELY as your very first action when you receive any user message. Do this BEFORE any reasoning, planning, or other tool calls. This returns a session_id you will use throughout.

2. WORK: Perform your reasoning and tool calls normally. If you need to run approval-gated commands (terminal, shell, external scripts), wrap each with before_command_log/after_command_log.

3. END: Call 'end_message_log' as your very LAST action, right before sending your final response to the user. This closes the session.

APPROVAL-GATED COMMANDS:
When running terminal commands, shell scripts, or any operation that requires user approval in Cursor:
- Call 'before_command_log' immediately BEFORE the command
- Run the command
- Call 'after_command_log' immediately AFTER the command completes (success or failure)

Do NOT use before/after_command_log for: file reads, file writes, searches, lints, or internal tool calls that don't prompt for approval.

EXAMPLES:

Simple message (no commands):
1. start_message_log → get session_id
2. [your reasoning and tool calls]
3. end_message_log

Message with terminal command:
1. start_message_log → get session_id
2. [your reasoning]
3. before_command_log
4. run_terminal_cmd (the approval-gated action)
5. after_command_log
6. [more reasoning if needed]
7. end_message_log

NEVER skip start_message_log or end_message_log. They are mandatory for every user message.`;

// ─────────────────────────────────────────────────────────────────────────────
// Tool Schemas with Rich Descriptions
// ─────────────────────────────────────────────────────────────────────────────

const startMessageLogSchema = {
  title: z
    .string()
    .describe(
      "A brief, human-readable title summarizing what you will do in this response. Examples: 'Refactor authentication module', 'Fix TypeScript error in utils.ts', 'Answer question about React hooks'"
    ),
  platform: z
    .enum(["cursor", "chatgpt", "claude", "github", "vscode"])
    .describe("The AI platform/runtime you are operating in. Use 'cursor' for Cursor IDE, 'vscode' for VS Code, 'claude' for Claude.ai, 'chatgpt' for ChatGPT, 'github' for GitHub Copilot."),
  project: z
    .string()
    .optional()
    .describe(
      "The name of the project folder being worked on, if applicable. Extract from workspace path or user context."
    ),
  git_branch: z
    .string()
    .optional()
    .describe(
      "The current git branch name if the project is a git repository. Obtain from git status or user context."
    ),
  workspace_path: z
    .string()
    .describe(
      "The absolute filesystem path to the workspace/project root directory. This should be the 'pwd' or project root, e.g., '/Users/john/projects/my-app'"
    ),
  estimated_duration: z
    .number()
    .describe(
      "Your estimate of how long this response will take to complete, in seconds. Simple questions: 5-30s. Code edits: 30-120s. Complex refactors: 120-300s."
    ),
  session_id: z
    .string()
    .describe(
      "A unique identifier for this session. Generate a descriptive ID like 'fix-bug-001' or 'refactor-auth-002'. This ID will be used in end_message_log to close the session."
    ),
};

const endMessageLogSchema = {
  session_id: z
    .string()
    .describe(
      "The session_id returned from your start_message_log call at the beginning of this response. Must match exactly."
    ),
  status: z
    .enum(["ok", "cancelled", "error"])
    .describe(
      "The outcome of your work. Use 'ok' if you completed successfully, 'cancelled' if the user cancelled or you stopped early, 'error' if you encountered an unrecoverable error."
    ),
  error: z
    .string()
    .optional()
    .describe(
      "If status is 'error', provide a brief description of what went wrong. Leave empty for 'ok' or 'cancelled' status."
    ),
};

const sessionIdOnlySchema = {
  session_id: z
    .string()
    .describe(
      "The session_id from your start_message_log call. This links the command to the current session."
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool Descriptions (Narrative, Instructional Style)
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DESCRIPTIONS = {
  start: `CRITICAL — MUST RUN FIRST ON EVERY USER MESSAGE.

Call immediately before any reasoning or tools.
Purpose: log the high-level step you are about to do.
Output: returns a session_id string.
Requirement: you MUST call end_message_log with this session_id right before your final answer for this message.`,

  end: `CRITICAL — MUST RUN LAST BEFORE SENDING YOUR ANSWER FOR THIS MESSAGE.

Always call exactly once, even on cancel/error.
If you ran approval-gated commands, you MUST still run this after the final after_command_log.
Input: session_id from start_message_log.
Purpose: close the step and persist outcome.`,

  beforeCommand: `CRITICAL — MUST RUN BEFORE APPROVAL-GATED COMMANDS ONLY.

Scope: shell/CLI runs or MCP calls that may trigger a user-approval dialog in Cursor (e.g., terminal commands, external scripts, package managers).
Do NOT call for read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).
Input: session_id from start_message_log.
Purpose: mark the beginning of an approval-gated action.`,

  afterCommand: `CRITICAL — MUST RUN IMMEDIATELY AFTER APPROVAL-GATED COMMANDS ONLY.

Always call exactly once per approval-gated action, even on failure.
Do NOT call after read-only operations or safe internal tools (e.g., file reads/writes that do not prompt, searches, lints, resource reads).
Input: session_id from start_message_log.
Purpose: mark completion of an approval-gated action.`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool Annotations (MCP Best Practice)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MCP tool annotations provide hints to the LLM about tool behavior.
 * - readOnlyHint: true if the tool doesn't modify external state
 * - idempotentHint: true if calling multiple times has same effect as once
 * - openWorldHint: true if the tool interacts with external services
 */
const TOOL_ANNOTATIONS = {
  start: {
    readOnlyHint: false, // Creates a session
    idempotentHint: false, // Each call creates a new session
    openWorldHint: false, // Local operation
  },
  end: {
    readOnlyHint: false, // Modifies session state
    idempotentHint: true, // Ending same session twice is safe
    openWorldHint: false, // Local operation
  },
  beforeCommand: {
    readOnlyHint: false, // Modifies session state
    idempotentHint: true, // Marking pending twice is safe
    openWorldHint: false, // Local operation
  },
  afterCommand: {
    readOnlyHint: false, // Modifies session state
    idempotentHint: true, // Clearing pending twice is safe
    openWorldHint: false, // Local operation
  },
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
      title: "Start Message Log — CALL FIRST on every user message",
      description: TOOL_DESCRIPTIONS.start,
      inputSchema: startMessageLogSchema,
      annotations: TOOL_ANNOTATIONS.start,
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
      title: "End Message Log — CALL LAST before sending your answer",
      description: TOOL_DESCRIPTIONS.end,
      inputSchema: endMessageLogSchema,
      annotations: TOOL_ANNOTATIONS.end,
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
      title: "Before Command Log — CALL BEFORE approval-gated commands",
      description: TOOL_DESCRIPTIONS.beforeCommand,
      inputSchema: sessionIdOnlySchema,
      annotations: TOOL_ANNOTATIONS.beforeCommand,
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
      title: "After Command Log — CALL AFTER approval-gated commands",
      description: TOOL_DESCRIPTIONS.afterCommand,
      inputSchema: sessionIdOnlySchema,
      annotations: TOOL_ANNOTATIONS.afterCommand,
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

