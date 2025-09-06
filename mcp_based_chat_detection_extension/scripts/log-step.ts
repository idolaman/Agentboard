import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import crypto from "node:crypto";

async function main(): Promise<void> {
  const serverUrl = process.env.THINKING_LOGGER_URL || "http://127.0.0.1:17890";
  const clientToken = process.env.THINKING_LOGGER_TOKEN || "local-dev-token";
  const title = process.argv.slice(2).join(" ") || "Manual step";

  const client = new McpClient({ name: "thinking-logger-cli", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport({
    url: serverUrl,
    headers: { "x-client-token": clientToken }
  });

  await client.connect(transport);

  const providedSessionId = `manual-${crypto.randomUUID()}`;
  const start = await client.callTool({
    name: "start_message_log",
    arguments: { title, session_id: providedSessionId },
  });

  const startText = Array.isArray((start as any).content)
    ? (start as any).content.find((c: any) => c?.type === "text")?.text
    : undefined;
  const sessionId: string = startText || providedSessionId;
  console.log(`Started session: ${sessionId}`);

  const end = await client.callTool({
    name: "end_message_log",
    arguments: { session_id: sessionId, status: "ok" },
  });
  void end; // unused output

  console.log("Ended session with status: ok");
  await client.close();
}

main().catch((err) => {
  console.error("log-step failed:", err);
  process.exit(1);
});


