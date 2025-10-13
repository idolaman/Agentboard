import { z } from 'zod';

export type UiToHostMessage =
	| { type: 'ui/ready' }
	| { type: 'ui/saveToken'; token: string }
	| { type: 'ui/clearToken' }
	| { type: 'ui/retry' };

export const UiToHostMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ui/ready') }),
	z.object({ type: z.literal('ui/saveToken'), token: z.string().min(1) }),
	z.object({ type: z.literal('ui/clearToken') }),
	z.object({ type: z.literal('ui/retry') }),
]);

export type SessionSummary = {
	id: string;
	title: string;
	started_at?: string | undefined;
	ended_at?: string | undefined;
	platform?: 'cursor' | 'vscode' | 'chatgpt' | 'claude' | 'github' | string | undefined;
	project?: string | undefined;
	git_branch?: string | undefined;
	approval_pending_since?: string | undefined;
	status: 'in_progress' | 'done';
};

export const SessionSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	started_at: z.string().optional(),
	ended_at: z.string().optional(),
	platform: z.string().optional(),
	project: z.string().optional(),
	git_branch: z.string().optional(),
	approval_pending_since: z.string().optional(),
	status: z.union([z.literal('in_progress'), z.literal('done')]),
}) satisfies z.ZodType<SessionSummary>;

export type HostToUiMessage =
	| { type: 'auth/status'; authenticated: boolean }
	| { type: 'sessions'; sessions: ReadonlyArray<SessionSummary> }
	| { type: 'error'; message: string };

export const HostToUiMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('auth/status'), authenticated: z.boolean() }),
	z.object({ type: z.literal('sessions'), sessions: z.array(SessionSummarySchema).readonly() }),
	z.object({ type: z.literal('error'), message: z.string() }),
]);


