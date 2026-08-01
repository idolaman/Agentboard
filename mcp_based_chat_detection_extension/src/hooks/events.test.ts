import assert from "node:assert/strict";
import test from "node:test";
import { HookEventIngestor } from "./events.js";
import { SessionStore } from "../store/sessions.js";

const createSubject = () => {
  const store = new SessionStore();
  const notifications: string[] = [];
  const ingestor = new HookEventIngestor(store, async (sessionId) => {
    notifications.push(sessionId);
  });
  return { ingestor, notifications, store };
};

test("start and stop create and finish one generic agent run", async () => {
  const { ingestor, notifications, store } = createSubject();

  await ingestor.ingest({
    platform: "claude",
    event: "start",
    session_id: "chat-1",
    workspace_path: "/repo/worktree",
  });
  const [started] = store.all();
  assert.ok(started);
  assert.equal(started.platform, "claude");
  assert.equal(started.title, "Claude task");
  assert.equal(started.chat_id, "chat-1");
  assert.equal(started.workspace_path, "/repo/worktree");
  assert.equal(started.ended_at, undefined);

  await ingestor.ingest({
    platform: "claude",
    event: "stop",
    session_id: "chat-1",
    workspace_path: "/different/path",
  });
  assert.equal(started.status, "ok");
  assert.ok(started.ended_at);
  assert.equal(started.workspace_path, "/repo/worktree");
  assert.deepEqual(notifications, [started.id, started.id]);
});

test("the same session ID remains independent across platforms", async () => {
  const { ingestor, store } = createSubject();

  await ingestor.ingest({
    platform: "claude",
    event: "start",
    session_id: "shared",
    workspace_path: "/repo/claude",
  });
  await ingestor.ingest({
    platform: "codex",
    event: "start",
    session_id: "shared",
    workspace_path: "C:\\repo\\codex",
  });
  await ingestor.ingest({
    platform: "claude",
    event: "stop",
    session_id: "shared",
    workspace_path: "/repo/claude",
  });

  const claudeRun = store.all().find((session) => session.platform === "claude");
  const codexRun = store.all().find((session) => session.platform === "codex");
  assert.equal(claudeRun?.status, "ok");
  assert.equal(codexRun?.ended_at, undefined);
});

test("a replacement start cancels the previous active run", async () => {
  const { ingestor, notifications, store } = createSubject();

  await ingestor.ingest({
    platform: "cursor",
    event: "start",
    session_id: "chat-2",
    workspace_path: "/repo/first",
  });
  const firstRun = store.all()[0];
  await ingestor.ingest({
    platform: "cursor",
    event: "start",
    session_id: "chat-2",
    workspace_path: "/repo/second",
  });

  assert.equal(firstRun?.status, "cancelled");
  assert.equal(store.all().length, 2);
  assert.equal(store.all()[1]?.workspace_path, "/repo/second");
  assert.equal(notifications.length, 3);
});

test("an unmatched stop is an idempotent no-op", async () => {
  const { ingestor, notifications, store } = createSubject();

  await ingestor.ingest({
    platform: "claude",
    event: "stop",
    session_id: "missing",
    workspace_path: "/repo",
  });

  assert.deepEqual(store.all(), []);
  assert.deepEqual(notifications, []);
});

test("local hook runs are visible without leaking another token's sessions", async () => {
  const { ingestor, store } = createSubject();
  store.create({ platform: "cursor", token: "other-token" });
  store.create({ platform: "vscode" });

  await ingestor.ingest({
    platform: "claude",
    event: "start",
    session_id: "local-hook",
    workspace_path: "/repo/local",
  });

  const visible = store.list("viewer-token");
  assert.deepEqual(visible.map((session) => session.chat_id), ["local-hook"]);
});
