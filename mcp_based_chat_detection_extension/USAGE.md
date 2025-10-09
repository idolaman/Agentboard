## Using the Thinking Logger MCP Server (Client Setup)

This guide explains how to connect MCP clients (Cursor and Claude Desktop) to a Thinking Logger server that is already running. For server installation and run instructions, see this folder's `README.md`.

### Cursor (MCP client)

Cursor supports HTTP MCP servers via its `mcp.json`.

Edit Cursor MCPs file and add thinking-logger MCP:

```json
{
  "mcpServers": {
    ...
    "thinking-logger": {
      "type": "http",
      "url": "http://localhost:17890"
    }
  }
}
```

Tips:

- Use `http://127.0.0.1:17890` if `localhost` resolution is restricted in your env.
- Restart Cursor after editing this file.

### Claude Desktop (MCP client)

Claude Desktop supports MCP servers via its configuration file.

Edit Claude MCPs file and add thinking-logger MCP:

```json
{
  "mcpServers": {
    ...
    "thinking-logger": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:17890"]
    }
  }
}
```