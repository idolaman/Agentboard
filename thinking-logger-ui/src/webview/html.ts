import * as vscode from 'vscode';

export function getWebviewHtml(options: {
	webview: vscode.Webview;
	nonce: string;
	icons: { chatgpt: string; github: string; cursor: string; claude: string; vscode: string };
}): string {
	const { webview, nonce, icons } = options;
	const csp = [
		"default-src 'none'",
		`img-src ${webview.cspSource} blob:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="${csp}" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<style>
			:root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); --muted: var(--vscode-descriptionForeground); --accent: var(--vscode-focusBorder); --success: #2ea043; --warning: #f59e0b; --ring: rgba(0, 122, 204, 0.25); --radius: 10px; --card-bg: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.00)); --border: color-mix(in srgb, var(--muted) 45%, transparent); }
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
			button.chip { appearance:none; -webkit-appearance:none; background: rgba(127,127,127,0.06); border:1px solid var(--border); }
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
			.platform.vscode { color: var(--fg); }
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
		<header style="display:flex;align-items:center;justify-content:flex-end;padding:8px 10px;border-bottom:1px solid var(--border);">
			<button id="clear" class="chip" title="Log Out" style="cursor:pointer;">Log Out</button>
		</header>
		<section class="list" id="list"></section>
		<div id="error" class="error" style="display:none"></div>
		<script nonce="${nonce}">
			const ICONS = { chatgpt: '${icons.chatgpt}', github: '${icons.github}', cursor: '${icons.cursor}', claude: '${icons.claude}', vscode: '${icons.vscode}' };
			const vscodeApi = acquireVsCodeApi();
			const ACK_KEY = 'thinkingLogger.acknowledgedSessionIds';
			const keyFor = (s) => s.id + '|' + (s.started_at || '');
			function loadAcked(){ try { return new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]')); } catch { return new Set(); } }
			function saveAcked(set){ try { localStorage.setItem(ACK_KEY, JSON.stringify([...set])); } catch {} }
			let acked = loadAcked();
			window.addEventListener('message', (event) => {
				const msg = event.data;
				if (msg.type === 'sessions') render(msg.sessions || []);
				if (msg.type === 'error') showError(msg.message || 'Unknown error');
			});
			window.addEventListener('DOMContentLoaded', () => {
				vscodeApi.postMessage({ type: 'ui/ready' });
				document.getElementById('clear')?.addEventListener('click', () => { vscodeApi.postMessage({ type: 'ui/clearToken' }); });
			});
			// setup page is served separately when no token
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
			function render(items){
				hideError();
				const root = document.getElementById('list');
				if (!root) return;
				root.innerHTML = '';
				const visible = items.filter((s) => !acked.has(keyFor(s)));
				for (const s of visible) {
					const running = s.status === 'in_progress' || !s.ended_at;
					const approval = s.approval_pending_since ? (Date.now() - new Date(s.approval_pending_since).getTime() > 5000) : false;
					const card = document.createElement('div');
					card.className = 'card';
					card.innerHTML = \`
						<button class="close" title="Dismiss">×</button>
						<div class="title">${'$'}{escapeHtml(s.title || 'Untitled task')}</div>
						<div class="row">
							${'$'}{running ? '<span class="dot running"></span><span class="status">Running…</span>' : '<span class="status">Completed</span>'}
							${'$'}{approval ? '<span class="chip approval"><span class="dot"></span> Needs your approval</span>' : ''}
							${'$'}{running ? '' : '<button class="chip cta ack">Acknowledge</button>'}
						</div>
						<div class="meta-row">
							<div class="chips">
								<span class="platform-icon">${'$'}{s.platform==='chatgpt' ? '<img src="'+ICONS.chatgpt+'" alt="ChatGPT" />' : (s.platform==='github' ? '<img src="'+ICONS.github+'" alt="GitHub" />' : (s.platform==='claude' ? '<img src="'+ICONS.claude+'" alt="Claude" />' : (s.platform==='vscode' ? '<img src="'+ICONS.vscode+'" alt="VS Code" />' : '<img src="'+ICONS.cursor+'" alt="Cursor" />')))}</span>
								${'$'}{((s.platform==='cursor'||s.platform==='vscode') && (s.project||s.git_branch))? ('<span class="chip platform '+(s.platform==='vscode'?'vscode':'cursor')+'">'+(escapeHtml(s.project||'')) + (s.git_branch? ' @ '+escapeHtml(s.git_branch):'')+'</span>') : ''}
								<span class="chip status ${'$'}{running?'running':'done'}">${'$'}{running?'<span class="dot"></span> In progress':'Done'}</span>
							</div>
						</div>\`;
					card.querySelector('.close')?.addEventListener('click', () => {
						acked.add(keyFor(s));
						saveAcked(acked);
						card.remove();
					});
					if (!running) {
						card.querySelector('.ack')?.addEventListener('click', () => {
							acked.add(keyFor(s));
							saveAcked(acked);
							card.remove();
						});
					}
					root.appendChild(card);
				}
			}
			function escapeHtml(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
			function showError(text){ const e=document.getElementById('error'); if(!e) return; e.style.display='block'; e.textContent=text }
			function hideError(){ const e=document.getElementById('error'); if(!e) return; e.style.display='none'; e.textContent='' }
		</script>
	</body>
	</html>`;
}

export function getSetupHtml(nonce: string): string {
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<style>
			:root { --bg: #1e1e1e; --card: #2a2a2a; --fg: #e6e6e6; --muted:#9aa0a6; --accent:#0a84ff; --border: #3a3a3a; }
			* { box-sizing: border-box; }
			body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); background: var(--bg); }
			.card { width: min(520px, 92vw); background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 18px 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.3); }
			h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 700; }
			p.desc { margin: 0 0 14px 0; font-size: 12px; color: var(--muted); }
			label { display:block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
			.row { display:flex; align-items:center; gap:8px; }
			input[type=password], input[type=text] { flex:1; width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); color: var(--fg); background: #1b1b1b; }
			input::placeholder { color: #717171; }
			button.primary { padding: 10px 14px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--accent) 65%, transparent); background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); cursor: pointer; font-weight: 600; }
			button.primary:disabled { opacity: .6; cursor: default; }
			button.link { background: transparent; border: none; color: var(--muted); cursor: pointer; text-decoration: underline; padding: 0; }
			.hint { margin-top: 10px; font-size: 11px; color: var(--muted); }
		</style>
	</head>
	<body>
		<div class="card">
			<h3>Thinking Logger – Enter Token</h3>
			<p class="desc">Paste the token you generated to view your sessions.</p>
			<label for="t">Token</label>
			<div class="row">
				<input id="t" type="password" placeholder="Your token" />
				<button id="toggle" class="link" aria-label="Show password">Show</button>
			</div>
			<div style="margin-top: 12px; display:flex; align-items:center; gap:8px;">
				<button id="s" class="primary" disabled>Save token</button>
			</div>
			<div class="hint">Tokens are stored in VS Code Secret Storage on this machine.</div>
		</div>
		<script nonce="${nonce}">
			const vscodeApi = acquireVsCodeApi();
			const el = document.getElementById('t');
			const btn = document.getElementById('s');
			const toggle = document.getElementById('toggle');
			el.addEventListener('input', () => { btn.disabled = !String(el.value||'').trim(); });
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
			toggle.addEventListener('click', (e) => {
				e.preventDefault();
				if (el.getAttribute('type') === 'password') { el.setAttribute('type', 'text'); toggle.textContent = 'Hide'; }
				else { el.setAttribute('type', 'password'); toggle.textContent = 'Show'; }
			});
			btn.addEventListener('click', () => {
				const token = String(el.value||'').trim();
				if (token) vscodeApi.postMessage({ type: 'ui/saveToken', token });
			});
		</script>
	</body>
	</html>`;
}


