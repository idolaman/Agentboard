import * as vscode from 'vscode';

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
		const icons = {
			chatgpt: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'chatgpt.svg')).toString(),
			github: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'github.svg')).toString(),
			cursor: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'cursor.svg')).toString(),
		};
		webviewView.webview.html = getWebviewHtml(icons);

		const cfg = vscode.workspace.getConfiguration('thinkingLogger');
		const serverUrl = cfg.get<string>('serverUrl') || 'http://127.0.0.1:17890';
		async function initializeSession(): Promise<{ sessionId: string; protocol: string; }> {
			const resp = await fetch(serverUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
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
					params: { uri: `thinking://sessions` }
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

		async function pushOnce() {
			try {
				const list = await readClientSessions(session!.sessionId, session!.protocol);
				webviewView.webview.postMessage({ type: 'sessions', sessions: list.map((s: any) => ({
					id: s.id,
					title: s.title || 'Untitled task',
					started_at: s.started_at,
					ended_at: s.ended_at,
					platform: s.platform || 'cursor',
					project: s.project || undefined,
					git_branch: s.git_branch || undefined,
					approval_pending_since: s.approval_pending_since || undefined,
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

function getWebviewHtml(icons: { chatgpt: string; github: string; cursor: string }): string {
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
				--warning: #f59e0b;
				--ring: rgba(0, 122, 204, 0.25);
				--radius: 10px;
				--card-bg: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.00));
				--border: color-mix(in srgb, var(--muted) 45%, transparent);
			}
			* { box-sizing: border-box; }
			body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); background: var(--bg); }
			header { position: sticky; top: 0; z-index: 1; backdrop-filter: saturate(150%) blur(6px); background: color-mix(in srgb, var(--bg) 80%, transparent); display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
			h1 { font-size: 14px; margin: 0; letter-spacing: 0.3px; font-weight: 700; }
			.list { padding: 12px; display: grid; gap: 10px; }
			.card { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--card-bg); display: grid; gap: 8px; box-shadow: 0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -18px rgba(0,0,0,0.4); position: relative; }
			.title { font-size: 13px; font-weight: 650; line-height: 1.35; }
			.meta { font-size: 11px; color: var(--muted); }
			.row { display: flex; align-items: center; gap: 8px; }
			.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 6px rgba(127,127,127,0.08); }
			.status { font-size: 11px; color: var(--muted); letter-spacing: 0.2px; }
			.meta-row { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap: wrap; }
			.chips { display:flex; align-items:center; gap:6px; flex-wrap: wrap; }
			.chip { display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:999px; border:1px solid var(--border); background: rgba(127,127,127,0.06); font-size:11px; color:var(--muted); }
			.chip .dot { width:6px; height:6px; box-shadow:none; }
			.chip .icon { width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; }
			.chip .icon svg, .chip .icon img { width:100%; height:100%; display:block; }
			.platform-icon { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; margin-right:12px; }
			.platform-icon img, .platform-icon svg { width:100%; height:100%; display:block; border-radius:8px; }
			.chip.status.running .dot { background: var(--accent); animation: pulse 1.2s infinite ease-in-out; }
			.dot.running { animation: pulse 1.2s infinite ease-in-out; }
			.chip.status.done { color:#2ea043; border-color: color-mix(in srgb, #2ea043 40%, var(--border)); }
			.chip.approval { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 40%, var(--border)); background: color-mix(in srgb, var(--warning) 12%, transparent); font-weight: 600; }
			.chip.approval .dot { background: var(--warning); }
			.badgeCol { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
			.subline { display:flex; align-items:center; gap:6px; font-size: 11px; color: var(--muted); overflow:hidden; }
			.tag { display:inline-flex; align-items:center; padding:2px 6px; border-radius:6px; background: rgba(127,127,127,0.08); border:1px solid var(--border); max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.tag-branch { color: var(--fg); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, transparent); }
			.platform.cursor { color: var(--fg); }
			.platform.chatgpt { color: var(--fg); }
			.platform.claude { color: var(--fg); }
			.platform.github { color: var(--fg); }
			.time { font-size:11px; color: var(--muted); white-space: nowrap; }
			.chip.cta { border-color: var(--accent); color: var(--fg); background: color-mix(in srgb, var(--accent) 10%, transparent); padding:4px 10px; font-weight:600; }
			.chip.cta:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
			.chip.cta:active { transform: translateY(1px); }
			.ack { margin-left: auto; background: var(--success); color: white; border: none; border-radius: 999px; padding: 6px 12px; cursor: pointer; transition: transform 0.08s ease, filter 0.08s ease; }
			.ack:hover { filter: brightness(1.05); }
			.ack:active { transform: translateY(1px); }
			.close { position: absolute; top: 8px; right: 10px; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; border: none; background: transparent; color: var(--muted); cursor: pointer; }
			.close:hover { background: rgba(127,127,127,0.12); color: var(--fg); }
			@keyframes pulse { 0%, 100% { opacity: .4 } 50% { opacity: 1 } }
			.error { margin: 12px; padding: 8px 10px; border-radius: 8px; background: rgba(255,0,0,0.08); color: #ff6b6b; font-size: 12px; }
		</style>
	</head>
	<body>
		<!-- Title bar removed to align with native VS Code view heading -->
		<section class="list" id="list"></section>
		<div id="error" class="error" style="display:none"></div>
		<script>
			const ICONS = { chatgpt: '${icons.chatgpt}', github: '${icons.github}', cursor: '${icons.cursor}' };
			const vscode = acquireVsCodeApi();
			const ACK_KEY = 'thinkingLogger.acknowledgedSessionIds';
			const keyFor = (s) => \`\${s.id}|\${s.started_at||''}\`;
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
				if (sec < 15) return 'just now';
				if (sec < 60) return sec + ' sec ago';
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
				// Hide sessions dismissed for this specific run (id + started_at)
				const visible = items.filter(s => !acked.has(keyFor(s)));
				for (const s of visible) {
					const running = s.status === 'in_progress' || !s.ended_at;
					const approval = s.approval_pending_since ? (Date.now() - new Date(s.approval_pending_since).getTime() > 5000) : false;
					const card = document.createElement('div');
					card.className = 'card';
					card.innerHTML = \`
						<button class=\"close\" title=\"Dismiss\">×</button>
						<div class=\"title\">\${escapeHtml(s.title || 'Untitled task')}<\/div>
						<div class=\"row\">
							\${running ? '<span class=\\"dot running\\"></span><span class=\\"status\\">Running…<\/span>' : '<span class=\\"status\\">Completed<\/span>'}
							\${approval ? '<span class=\\"chip approval\\"><span class=\\"dot\\"></span> Needs your approval<\/span>' : ''}
							\${running ? '' : '<button class=\\"chip cta ack\\">Acknowledge<\/button>'}
						<\/div>
						<div class=\"meta-row\">\n\t\t\t\t\t<div class=\"chips\">\n\t\t\t\t\t\t<span class=\"platform-icon\">\${s.platform==='chatgpt' ? '<img src=\\\"'+ICONS.chatgpt+'\\\" alt=\\\"ChatGPT\\\" />' : (s.platform==='github' ? '<img src=\\\"'+ICONS.github+'\\\" alt=\\\"GitHub\\\" />' : '<img src=\\\"'+ICONS.cursor+'\\\" alt=\\\"Cursor\\\" />')}<\/span>\n\t\t\t\t\t\t\${(s.platform==='cursor' && (s.project||s.git_branch))? ('<span class=\\\"chip platform cursor\\\">'+(escapeHtml(s.project||'')) + (s.git_branch? ' @ '+escapeHtml(s.git_branch):'')+'</span>') : ''}\n\t\t\t\t\t\t<span class=\"chip status \${running?'running':'done'}\">\${running?'<span class=\\\"dot\\\"></span> In progress':'Done'}</span>\n\t\t\t\t\t</div>\n\t\t\t\t\t<div class=\"time\">Started \${escapeHtml(toHuman(s.started_at))}\${s.ended_at ? ' • Ended ' + escapeHtml(toHuman(s.ended_at)) : ''}</div>\n\t\t\t\t</div>
					\`;
					// Dismiss via X: always allowed
					card.querySelector('.close')?.addEventListener('click', () => {
						acked.add(keyFor(s));
						saveAcked(acked);
						card.remove();
					});
					// Acknowledge button for completed rows
					if (!running) {
						card.querySelector('.ack')?.addEventListener('click', () => {
							acked.add(keyFor(s));
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


