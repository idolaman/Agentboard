## Thinking Logger UI (VS Code / Cursor Extension)

A lightweight sidebar that displays running and completed "thinking" sessions from the Thinking Logger MCP server. Built with the VS Code Webview API and designed to blend with your editor theme.

### Requirements

- VS Code 1.89+ or Cursor
- Node.js 18+ (recommended 20+)
- A running Thinking Logger MCP server (default `http://127.0.0.1:17890`) — see `../mcp_based_chat_detection_extension`.

### Install dependencies

```bash
cd /Users/idolavi/Documents/Code/productivity-master/thinking-logger-ui
npm install
```

### Build

```bash
npm run build
```

Outputs compiled files to `dist/`.

### Develop / Run in VS Code

This repo includes a ready-to-use launch configuration.

1) Build once:

```bash
npm run build
```

2) In VS Code, open the workspace root and run the launch config:

- Run: `Run and Debug` → `Run Thinking Logger UI`
- Prelaunch task builds the extension and launches a new Extension Host window

3) In the Extension Host window, open the Activity Bar and select `Thinking` to view sessions.

### Configuration

Extension setting: `thinkingLogger.serverUrl`

- Default: `http://127.0.0.1:17890`
- Points to the MCP server base URL

### How it connects

On activation, the extension:

1) Sends an `initialize` JSON‑RPC request to the MCP server (`POST /`)
2) Receives a `mcp-session-id` header for the session
3) Periodically requests `resources/read` for `thinking://sessions`

### Troubleshooting

- Error "Failed to connect to MCP server":
  - Ensure the server is running and reachable at `thinkingLogger.serverUrl`
  - Confirm `mcp-session-id` is present in initialize response headers

- Empty list:
  - Verify the MCP server is receiving and storing sessions

