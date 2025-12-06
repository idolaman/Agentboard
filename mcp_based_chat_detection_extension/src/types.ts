/**
 * Core type definitions for the thinking logger.
 */

/** Possible session completion statuses */
export type SessionStatus = "ok" | "cancelled" | "error";

/** Supported AI platforms */
export type Platform = "cursor" | "chatgpt" | "claude" | "github" | "vscode";

/**
 * Represents a single thinking/reasoning session.
 * Sessions track AI interactions from start to finish.
 */
export interface Session {
  /** Unique session identifier */
  id: string;

  /** AI platform where the session originated */
  platform: Platform | string;

  /** Session title/description */
  title?: string;

  /** Project folder name */
  project?: string;

  /** Git branch at time of session */
  git_branch?: string;

  /** Absolute path to the workspace/project directory */
  workspace_path?: string;

  /** Estimated duration for this prompt in seconds */
  estimated_duration?: number;

  /** ISO timestamp when session started */
  started_at: string;

  /** ISO timestamp when session ended */
  ended_at?: string;

  /** Final session status */
  status?: SessionStatus;

  /** Error message if status is "error" */
  error?: string;

  /** ISO timestamp when waiting for user approval (for gated commands) */
  approval_pending_since?: string;

  /** Token for scoping session visibility (multi-tenant support) */
  token?: string;

  // Reserved for future use
  model?: string;
  workspace?: string;
  tokens_in?: number;
  tokens_out?: number;
}

