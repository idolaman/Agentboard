import type { RequestHandler } from "express";
import { HookEventIngestor, hookEventSchema, type HookEvent } from "../hooks/events.js";
import { logger } from "../logger.js";

export interface HookEventSink {
  ingest(input: HookEvent): Promise<void>;
}

export const isLoopbackAddress = (address: string | undefined): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

export const createHookEventHandler = (
  sink: HookEventSink = new HookEventIngestor(),
): RequestHandler => async (req, res) => {
  if (req.headers.origin || !isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: "Hook events are accepted only from local processes." });
    return;
  }

  const parsed = hookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid hook event." });
    return;
  }

  try {
    await sink.ingest(parsed.data);
    logger.info("hook.event", {
      platform: parsed.data.platform,
      hookEvent: parsed.data.event,
    });
    res.status(204).end();
  } catch (error) {
    logger.error("hook.event.error", {
      platform: parsed.data.platform,
      hookEvent: parsed.data.event,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Unable to process hook event." });
  }
};
