import { z } from "zod";
import { notifySession } from "../mcp/factory.js";
import { SessionStore, sessionStore } from "../store/sessions.js";

const absoluteWorkspacePathSchema = z.string()
  .min(1)
  .max(4096)
  .refine((value) =>
    value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value),
  )
  .refine((value) => !value.includes("\0"));

export const hookEventSchema = z.object({
  platform: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  event: z.enum(["start", "stop"]),
  session_id: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
  workspace_path: absoluteWorkspacePathSchema,
}).strict();

export type HookEvent = z.infer<typeof hookEventSchema>;

type HookSessionStore = Pick<SessionStore, "create" | "end">;
type SessionNotifier = (sessionId: string) => Promise<void>;

const toTitle = (platform: string): string => {
  const words = platform.split(/[-_]/).filter(Boolean);
  const label = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
  return `${label || "Agent"} task`;
};

export class HookEventIngestor {
  private readonly activeRuns = new Map<string, string>();

  constructor(
    private readonly store: HookSessionStore = sessionStore,
    private readonly notify: SessionNotifier = notifySession,
  ) {}

  async ingest(input: HookEvent): Promise<void> {
    const key = `${input.platform}:${input.session_id}`;

    if (input.event === "start") {
      const previousRunId = this.activeRuns.get(key);
      if (previousRunId) {
        const previousRun = this.store.end(previousRunId, "cancelled");
        if (previousRun) await this.notify(previousRun.id);
      }

      const run = this.store.create({
        platform: input.platform,
        title: toTitle(input.platform),
        chatId: input.session_id,
        workspacePath: input.workspace_path,
        local: true,
      });
      this.activeRuns.set(key, run.id);
      await this.notify(run.id);
      return;
    }

    const activeRunId = this.activeRuns.get(key);
    if (!activeRunId) return;

    this.activeRuns.delete(key);
    const activeRun = this.store.end(activeRunId, "ok");
    if (activeRun) await this.notify(activeRun.id);
  }
}
