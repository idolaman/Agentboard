import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
async function main() {
    const transport = new StreamableHTTPClientTransport({
        url: "http://localhost:17890",
        headers: { "x-client-token": "local-dev-token" }
    });
    const client = new McpClient({ name: "checker", version: "0.0.0" });
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = (tools.tools ?? []).map(t => t.name);
    console.log("tools:", toolNames);
    const resources = await client.listResources();
    console.log("resources count:", (resources.resources ?? []).length);
    await client.close();
}
main().catch(err => {
    console.error("check failed:", err);
    process.exit(1);
});
//# sourceMappingURL=check.js.map