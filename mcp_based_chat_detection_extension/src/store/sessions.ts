/**
 * In-memory session storage with query capabilities.
 */

import crypto from "node:crypto";
import type { Session, SessionStatus } from "../types.js";
import { TOKENLESS_MODE } from "../config.js";

/** Generate ISO timestamp */
function now(): string {
  return new Date().toISOString();
}

/** Generate unique ID */
function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Session store - singleton that manages all session state.
 */
class SessionStore {
  private readonly sessions = new Map<string, Session>();

  /**
   * Create a new session.
   */
  create(params: {
    sessionId?: string | undefined;
    platform: string;
    title?: string | undefined;
    project?: string | undefined;
    gitBranch?: string | undefined;
    token?: string | undefined;
  }): Session {
    const session: Session = {
      id: params.sessionId || uuid(),
      platform: params.platform,
      started_at: now(),
    };

    if (params.title) session.title = params.title;
    if (params.project) session.project = params.project;
    if (params.gitBranch) session.git_branch = params.gitBranch;
    if (!TOKENLESS_MODE && params.token) session.token = params.token;

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * End a session with final status.
   */
  end(sessionId: string, status: SessionStatus, error?: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.ended_at = now();
    session.status = status;
    if (error) session.error = error;

    return session;
  }

  /**
   * Mark a session as waiting for user approval.
   */
  markApprovalPending(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.approval_pending_since = now();
    return session;
  }

  /**
   * Clear the approval pending state.
   */
  clearApprovalPending(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    delete session.approval_pending_since;
    return session;
  }

  /**
   * List all sessions, optionally filtered by token.
   * In tokenless mode, returns all sessions regardless of token parameter.
   */
  list(token?: string): Session[] {
    const all = Array.from(this.sessions.values());

    if (TOKENLESS_MODE) {
      return all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    }

    if (!token) return [];

    return all
      .filter((s) => s.token === token)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  /**
   * Get all sessions (for internal use only, e.g., notifications).
   */
  all(): Session[] {
    return Array.from(this.sessions.values());
  }
}

/** Singleton session store instance */
export const sessionStore = new SessionStore();

