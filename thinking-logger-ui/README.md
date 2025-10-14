## Agentboard – Thinking Sessions Sidebar

Keep tabs on your AI agents without leaving your editor. Agentboard shows live progress, items waiting on your approval, and recent completions — all in a lightweight sidebar for VS Code/Cursor.

### Why you’ll love it

- Always‑on status: see what’s running right now at a glance
- Unblock quickly: clear “Needs your approval” when action is required
- Zero mental overhead: tiny, fast, theme‑aware UI

### Quick start (60 seconds)

1) Install the extension

2) Generate your token
   - Open [Agentboard](https://betterdev.app/agentboard) and press “View Setup Guide”
   - Copy the generated token

3) Paste the token in the sidebar
   - Open the `Thinking` view (Activity Bar)
   - Paste the token when prompted and click “Save token”
   - You’ll immediately see your sessions

4) Add MCP Configuration (optional for Cursor/Claude)
   - Cursor `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "thinking-logger": {
      "type": "http",
      "url": "https://agentboard.onrender.com",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

   - Claude Desktop config:

```json
{
  "mcpServers": {
    "thinking-logger": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://agentboard.onrender.com", "--header", "Authorization: Bearer YOUR_TOKEN"]
    }
  }
}
```

### Tips

- Log out any time with the “Log Out” button (or command palette: “Thinking Logger: Clear Token”).
- Your token is stored locally using VS Code Secret Storage.