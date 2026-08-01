import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "./app.js";
import { isLoopbackAddress, type HookEventSink } from "./hook-events.js";
import type { HookEvent } from "../hooks/events.js";

const withServer = async (run: (baseUrl: string, events: HookEvent[]) => Promise<void>): Promise<void> => {
  const events: HookEvent[] = [];
  const sink: HookEventSink = {
    ingest: async (event) => {
      events.push(event);
    },
  };
  const server = createApp({ hookEventSink: sink }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`, events);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

test("POST /hooks/events accepts a strict generic lifecycle event", async () => {
  await withServer(async (baseUrl, events) => {
    const response = await fetch(`${baseUrl}/hooks/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "claude",
        event: "start",
        session_id: "chat-1",
        workspace_path: "/Users/Test/Repo \"quoted\" caf\u00e9",
      }),
    });

    assert.equal(response.status, 204);
    assert.deepEqual(events, [{
      platform: "claude",
      event: "start",
      session_id: "chat-1",
      workspace_path: "/Users/Test/Repo \"quoted\" caf\u00e9",
    }]);
  });
});

test("POST /hooks/events rejects extra fields and browser origins", async () => {
  await withServer(async (baseUrl, events) => {
    const extraFieldResponse = await fetch(`${baseUrl}/hooks/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "claude",
        event: "start",
        session_id: "chat-1",
        workspace_path: "/repo",
        prompt: "must not be accepted",
      }),
    });
    assert.equal(extraFieldResponse.status, 400);

    const browserResponse = await fetch(`${baseUrl}/hooks/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({
        platform: "claude",
        event: "stop",
        session_id: "chat-1",
        workspace_path: "/repo",
      }),
    });
    assert.equal(browserResponse.status, 403);
    assert.deepEqual(events, []);
  });
});

test("POST /hooks/events rejects provider-specific or invalid event names", async () => {
  await withServer(async (baseUrl, events) => {
    const response = await fetch(`${baseUrl}/hooks/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "Claude",
        event: "UserPromptSubmit",
        session_id: "chat-1",
        workspace_path: "/repo",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(events, []);
  });
});

test("POST /hooks/events requires a bounded absolute workspace path", async () => {
  await withServer(async (baseUrl, events) => {
    const invalidPaths = [undefined, "relative/repo", `/${"a".repeat(4096)}`];

    for (const workspacePath of invalidPaths) {
      const response = await fetch(`${baseUrl}/hooks/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "claude",
          event: "start",
          session_id: "chat-1",
          workspace_path: workspacePath,
        }),
      });
      assert.equal(response.status, 400);
    }

    assert.deepEqual(events, []);
  });
});

test("loopback validation accepts local IPv4 and IPv6 addresses only", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.5"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});
