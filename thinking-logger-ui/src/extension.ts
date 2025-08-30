import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
import path from 'node:path';

export function activate(context: vscode.ExtensionContext) {
  const panel = vscode.window.registerWebviewViewProvider(
    'thinkingLogger.sessions',
    new SessionsViewProvider(context)
  );

  context.subscriptions.push(panel);
  context.subscriptions.push(
    vscode.commands.registerCommand('thinkingLogger.refresh', () => {
      vscode.commands.executeCommand('thinkingLogger.sessions.refresh');
    })
  );
}

export function deactivate() {}

class SessionsViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = getWebviewHtml();

    const cfg = vscode.workspace.getConfiguration('thinkingLogger');
    const serverUrl = cfg.get<string>('serverUrl') || 'http://127.0.0.1:17890';
    const clientToken = cfg.get<string>('clientToken') || 'local-dev-token';
    const client = new Client({ name: 'thinking-logger-ui', version: '0.1.0' }, {
      capabilities: { resources: { subscribe: true } }
    });
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: { headers: { 'X-Client-Token': clientToken } }
    });
    await client.connect(transport);

    // Subscribe to client-scoped sessions
    await client.subscribeResource({ uri: `thinking://clients/${clientToken}/sessions` });

    client.setNotificationHandler({ method: 'notifications/resources/updated' } as any, async (n: any) => {
      if (n.params?.uri === `thinking://clients/${clientToken}/sessions`) {
        const res = await client.readResource({ uri: `thinking://clients/${clientToken}/sessions` });
        const raw = (res as any).contents?.[0]?.text ?? '[]';
        const list = JSON.parse(typeof raw === 'string' ? raw : '[]');
        webviewView.webview.postMessage({ type: 'sessions', sessions: list.map((s: any) => ({
          id: s.id,
          title: s.title || 'Untitled task',
          started_at: s.started_at,
          ended_at: s.ended_at,
          status: s.ended_at ? 'done' : 'in_progress'
        })) });
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'openSessionLog') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
        vscode.window.showTextDocument(doc, { preview: false });
      }
      if (msg?.type === 'refresh') {
        const res = await client.readResource({ uri: `thinking://clients/${clientToken}/sessions` });
        const raw = (res as any).contents?.[0]?.text ?? '[]';
        const list = JSON.parse(typeof raw === 'string' ? raw : '[]');
        webviewView.webview.postMessage({ type: 'sessions', sessions: list.map((s: any) => ({
          id: s.id,
          title: s.title || 'Untitled task',
          started_at: s.started_at,
          ended_at: s.ended_at,
          status: s.ended_at ? 'done' : 'in_progress'
        })) });
      }
    });

    // Initial load
    const res = await client.readResource({ uri: `thinking://clients/${clientToken}/sessions` });
    const raw = (res as any).contents?.[0]?.text ?? '[]';
    const list = JSON.parse(typeof raw === 'string' ? raw : '[]');
    webviewView.webview.postMessage({ type: 'sessions', sessions: list.map((s: any) => ({
      id: s.id,
      title: s.title || 'Untitled task',
      started_at: s.started_at,
      ended_at: s.ended_at,
      status: s.ended_at ? 'done' : 'in_progress'
    })) });
  }
}

function getWebviewHtml(): string {
  // Minimal, clean UI using system fonts; animated status; accessible contrast
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --accent: var(--vscode-focusBorder);
        --success: #2ea043;
        --ring: rgba(0, 122, 204, 0.25);
        --radius: 10px;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); background: var(--bg); }
      header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--muted); }
      h1 { font-size: 14px; margin: 0; letter-spacing: 0.3px; }
      button.refresh { background: transparent; color: var(--fg); border: 1px solid var(--muted); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
      button.refresh:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
      .list { padding: 12px; display: grid; gap: 10px; }
      .card { border: 1px solid var(--muted); border-radius: var(--radius); padding: 12px; background: rgba(127,127,127,0.03); display: grid; gap: 6px; }
      .title { font-size: 13px; font-weight: 600; }
      .meta { font-size: 11px; color: var(--muted); }
      .row { display: flex; align-items: center; gap: 8px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s infinite ease-in-out; }
      .status { font-size: 11px; color: var(--muted); letter-spacing: 0.2px; }
      .finish { margin-left: auto; background: var(--success); color: white; border: none; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
      .finish:hover { filter: brightness(1.05); }
      @keyframes pulse { 0%, 100% { opacity: .4 } 50% { opacity: 1 } }
    </style>
  </head>
  <body>
    <header>
      <h1>Thinking Sessions</h1>
      <button class="refresh" onclick="vscode.postMessage({ type: 'refresh' })">Refresh</button>
    </header>
    <section class="list" id="list"></section>
    <script>
      const vscode = acquireVsCodeApi();
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'sessions') render(msg.sessions || []);
      });
      function render(items) {
        const el = document.getElementById('list');
        el.innerHTML = '';
        for (const s of items) {
          const running = s.status === 'in_progress' || !s.ended_at;
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = \`
            <div class="title">\${escapeHtml(s.title || 'Untitled task')}</div>
            <div class="row">
              \${running ? '<span class="dot"></span><span class="status">Running…</span>' : '<span class="status">Completed</span>'}
              \${running ? '' : '<button class="finish">Open Log</button>'}
            </div>
            <div class="meta">Started \${escapeHtml(s.started_at || '')}\${s.ended_at ? ' • Ended ' + escapeHtml(s.ended_at) : ''}</div>
          \`;
          if (!running) {
            card.querySelector('.finish')?.addEventListener('click', () => {
              vscode.postMessage({ type: 'openSessionLog', path: '' });
            });
          }
          el.appendChild(card);
        }
      }
      function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
      vscode.postMessage({ type: 'refresh' });
    </script>
  </body>
  </html>`;
}


