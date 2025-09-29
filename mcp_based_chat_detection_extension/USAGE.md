## Using the Thinking Logger MCP Server (Client Setup)

This guide explains how to connect MCP clients (Cursor and Claude Desktop) to a Thinking Logger server that is already running. For server installation and run instructions, see this folder's `README.md`.

### Cursor (MCP client)

Cursor supports HTTP MCP servers via its `mcp.json`.

Edit `~/.cursor/mcp.json` and add an entry like:

```json
{
  "mcpServers": {
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

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent path on your OS, and add an entry like:

```json
{
  "mcpServers": {
    "thinking-logger": {
      "type": "http",
      "url": "http://localhost:17890"
    }
  }
}
```

Tips:

- Use `http://127.0.0.1:17890` if `localhost` resolution is restricted in your env.