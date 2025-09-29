## Thinking Logger MCP Server

An MCP-compatible HTTP/SSE server that tracks "thinking" sessions and exposes them to IDE clients. It provides a simple JSON‑RPC over HTTP endpoint plus a per‑session SSE stream, enabling real‑time UI updates in the Agentboard sidebar.

### Features

- Sessionized JSON‑RPC endpoint with HTTP headers for routing
- Per‑session SSE stream for real‑time events
- Minimal schema using `zod` and `@modelcontextprotocol/sdk`
- Express 5 server with JSON body parsing

### Requirements

- Node.js 18+ (recommended 20+)
- npm 9+

### Installation

```bash
cd /Users/idolavi/Documents/Code/productivity-master/mcp_based_chat_detection_extension
npm install
```

### Scripts

- `npm run dev`: start the server with `tsx` for live TypeScript execution
- `npm run build`: build to `dist/`
- `npm start`: run the compiled server from `dist/server.js`

### Configuration

- `THINKING_LOGGER_HTTP_PORT` (default: `17890`)

### Endpoints (high‑level)

- `POST /` — JSON‑RPC
  - If no `mcp-session-id` header is present, only `initialize` requests are accepted.
  - On successful initialize, a session is created and the response includes `mcp-session-id` header.
  - Subsequent JSON‑RPC requests must include `mcp-session-id`.

- `GET /` — SSE stream for the session identified by `mcp-session-id` header.

- `DELETE /` — Close the session identified by `mcp-session-id` header.

### Using with Cursor / Claude

See `USAGE.md` in this folder for step‑by‑step setup instructions.

