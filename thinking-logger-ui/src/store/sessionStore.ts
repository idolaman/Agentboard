import * as vscode from 'vscode';
import { readConfig } from '../config';
import { logger } from '../logging';
import { HostToUiMessage, SessionSummary } from '../shared/messages';
import { initialize, readClientSessions } from '../rpc/rpcClient';

export class SessionStore {
	private view: vscode.WebviewView | undefined;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private generation = 0;
	private currentToken: string | undefined;
	private lastKey: string | undefined;
	private session: { sessionId: string; protocolVersion: string } | undefined;

	attach(view: vscode.WebviewView): void {
		this.view = view;
		this.view.onDidDispose(() => this.dispose());
	}

	setToken(token: string | undefined): void {
		this.currentToken = token;
		void this.restart();
	}

	private stop(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.session = undefined;
	}

	private computeKey(items: ReadonlyArray<SessionSummary>, token: string | undefined): string {
		const minimal = items.map((s) => ({
			id: s.id,
			started_at: s.started_at,
			ended_at: s.ended_at,
			title: s.title,
			status: s.status,
		}));
		return (token || '') + '|' + JSON.stringify(minimal);
	}

	private post(message: HostToUiMessage): void {
		this.view?.webview.postMessage(message).then(
			() => undefined,
			(err) => logger.debug(`postMessage failed: ${String(err)}`)
		);
	}

	private async restart(): Promise<void> {
		this.stop();
		this.lastKey = undefined;
		if (!this.view) return;
		const token = this.currentToken;
		if (!token) return; // no polling without token

		const { serverUrl } = readConfig();
		const myGen = ++this.generation;

		try {
			this.session = await initialize({ baseUrl: serverUrl, token });
		} catch (err) {
			logger.warn(`initialize failed: ${String(err)}`);
			this.post({ type: 'error', message: `Failed to connect to MCP server at ${serverUrl}: ${String(err)}` });
			return;
		}

		const pushOnce = async (): Promise<void> => {
			if (!this.view) return;
			if (myGen !== this.generation) return; // superseded
			if (!this.currentToken || !this.session) return;
			try {
				const list = await readClientSessions({
					baseUrl: serverUrl,
					token: this.currentToken,
					sessionId: this.session.sessionId,
					protocolVersion: this.session.protocolVersion,
				});
				const key = this.computeKey(list, this.currentToken);
				if (key === this.lastKey) return;
				this.lastKey = key;
				this.post({ type: 'sessions', sessions: list });
			} catch (err) {
				logger.warn(`read sessions failed: ${String(err)}`);
				this.post({ type: 'error', message: `Load failed: ${String(err)}` });
			}
		};

		await pushOnce();
		this.pollTimer = setInterval(() => void pushOnce(), 1500);
	}

	dispose(): void {
		this.stop();
		this.view = undefined;
	}
}


