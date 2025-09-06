import * as vscode from 'vscode';
// We avoid the SDK in the UI to prevent SSE/stream polyfills in the extension host.
// Use simple HTTP JSON-RPC with polling instead.

export function activate(context: vscode.ExtensionContext) {
	const panel = vscode.window.registerWebviewViewProvider(
		'thinkingLogger.sessions',
		new SessionsViewProvider(context)
	);

	context.subscriptions.push(panel);
}

export function deactivate() {}

class SessionsViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		webviewView.webview.options = {
			enableScripts: true,
		};
		webviewView.webview.html = getWebviewHtml();

		// No commands; view updates automatically.

		const cfg = vscode.workspace.getConfiguration('thinkingLogger');
		const serverUrl = cfg.get<string>('serverUrl') || 'http://127.0.0.1:17890';
		const clientToken = cfg.get<string>('clientToken') || 'local-dev-token';
		// Lightweight HTTP JSON-RPC client with session handling and polling
		async function initializeSession(): Promise<{ sessionId: string; protocol: string; }> {
			const resp = await fetch(serverUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
					'X-Client-Token': clientToken,
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'init-ui',
					method: 'initialize',
					params: {
						protocolVersion: '2025-06-18',
						capabilities: {},
						clientInfo: { name: 'thinking-logger-ui', version: '0.1.0' }
					}
				})
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const body = await resp.json().catch(() => ({} as any));
			const protocol = body?.result?.protocolVersion ?? '2025-06-18';
			const sessionId = resp.headers.get('mcp-session-id') || '';
			if (!sessionId) throw new Error('Missing mcp-session-id');
			return { sessionId, protocol };
		}

		async function readClientSessions(sessionId: string, protocol: string): Promise<any[]> {
			const resp = await fetch(serverUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
					'mcp-session-id': sessionId,
					'mcp-protocol-version': protocol,
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'read-sessions',
					method: 'resources/read',
					params: { uri: `thinking://clients/${clientToken}/sessions` }
				})
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const body = await resp.json();
			const raw = body?.result?.contents?.[0]?.text ?? '[]';
			return JSON.parse(typeof raw === 'string' ? raw : '[]');
		}

		let session: { sessionId: string; protocol: string } | undefined;
		try {
			session = await initializeSession();
		} catch (err) {
			webviewView.webview.postMessage({ type: 'error', message: `Failed to connect to MCP server at ${serverUrl}: ${String(err)}` });
			return;
		}

		// No host-side messages needed; all state handled in the webview.

		// Initial load + polling
		async function pushOnce() {
			try {
				const list = await readClientSessions(session!.sessionId, session!.protocol);
				webviewView.webview.postMessage({ type: 'sessions', sessions: list.map((s: any) => ({
					id: s.id,
					title: s.title || 'Untitled task',
					started_at: s.started_at,
					ended_at: s.ended_at,
					status: s.ended_at ? 'done' : 'in_progress'
				})) });
			} catch (err) {
				webviewView.webview.postMessage({ type: 'error', message: `Load failed: ${String(err)}` });
			}
		}
		await pushOnce();
		const timer = setInterval(() => { void pushOnce(); }, 1500);
		webviewView.onDidDispose(() => clearInterval(timer));
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
			.list { padding: 12px; display: grid; gap: 10px; }
			.card { border: 1px solid var(--muted); border-radius: var(--radius); padding: 12px; background: rgba(127,127,127,0.03); display: grid; gap: 6px; }
			.title { font-size: 13px; font-weight: 600; }
			.meta { font-size: 11px; color: var(--muted); }
			.row { display: flex; align-items: center; gap: 8px; }
			.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s infinite ease-in-out; }
			.status { font-size: 11px; color: var(--muted); letter-spacing: 0.2px; }
			.ack { margin-left: auto; background: var(--success); color: white; border: none; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
			.ack:hover { filter: brightness(1.05); }
			@keyframes pulse { 0%, 100% { opacity: .4 } 50% { opacity: 1 } }
			.error { margin: 12px; padding: 8px 10px; border-radius: 8px; background: rgba(255,0,0,0.08); color: #ff6b6b; font-size: 12px; }
		</style>
	</head>
	<body>
		<header>
			<h1>Thinking Sessions</h1>
		</header>
		<section class="list" id="list"></section>
		<div id="error" class="error" style="display:none"></div>
		<script>
			const vscode = acquireVsCodeApi();
			const ACK_KEY = 'thinkingLogger.acknowledgedSessionIds';
			function loadAcked(){
				try { return new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]')); } catch { return new Set(); }
			}
			function saveAcked(set){ try { localStorage.setItem(ACK_KEY, JSON.stringify([...set])); } catch {}
			}
			let acked = loadAcked();
			window.addEventListener('message', (event) => {
				const msg = event.data;
				if (msg.type === 'sessions') render(msg.sessions || []);
				if (msg.type === 'error') showError(msg.message || 'Unknown error');
			});
			function toHuman(iso) {
				if (!iso) return '';
				const dt = new Date(iso);
				if (Number.isNaN(dt.getTime())) return iso;
				const now = new Date();
				const diffMs = now.getTime() - dt.getTime();
				const sec = Math.floor(diffMs / 1000);
				if (sec < 60) return 'just now';
				const min = Math.floor(sec / 60);
				if (min < 60) return min + ' min ago';
				const hr = Math.floor(min / 60);
				if (hr < 24) return hr + ' hr ago';
				return dt.toLocaleString();
			}
			function render(items) {
				hideError();
				const el = document.getElementById('list');
				el.innerHTML = '';
				const visible = items.filter(s => !(s.ended_at && acked.has(s.id)));
				for (const s of visible) {
					const running = s.status === 'in_progress' || !s.ended_at;
					const card = document.createElement('div');
					card.className = 'card';
					card.innerHTML = \`
						<div class=\"title\">\${escapeHtml(s.title || 'Untitled task')}<\/div>
						<div class=\"row\">
							\${running ? '<span class=\"dot\"><\/span><span class=\"status\">Running…<\/span>' : '<span class=\"status\">Completed<\/span>'}
							\${running ? '' : '<button class=\"ack\">Acknowledge<\/button>'}
						<\/div>
						<div class=\"meta\">Started \${escapeHtml(toHuman(s.started_at))}\${s.ended_at ? ' • Ended ' + escapeHtml(toHuman(s.ended_at)) : ''}<\/div>
					\`;
					if (!running) {
						card.querySelector('.ack')?.addEventListener('click', () => {
							acked.add(s.id);
							saveAcked(acked);
							card.remove();
						});
					}
					el.appendChild(card);
				}
			}
			function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
			function showError(text){ const e=document.getElementById('error'); e.style.display='block'; e.textContent=text }
			function hideError(){ const e=document.getElementById('error'); e.style.display='none'; e.textContent='' }
		</script>
	</body>
	</html>`;
}


