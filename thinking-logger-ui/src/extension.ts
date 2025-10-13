import * as vscode from 'vscode';
import { getToken, setToken as saveToken, clearToken as removeToken } from './secrets';
import { logger } from './logging';
import { SessionStore } from './store/sessionStore';
import { getWebviewHtml, getSetupHtml } from './webview/html';
import { UiToHostMessageSchema } from './shared/messages';

export function activate(context: vscode.ExtensionContext) {
	const provider = new SessionsViewProvider(context);
	const registration = vscode.window.registerWebviewViewProvider(
		'thinkingLogger.sessions',
		provider
	);
	const clearCmd = vscode.commands.registerCommand('thinkingLogger.clearToken', async () => {
		await provider.clearToken();
	});

	context.subscriptions.push(registration, clearCmd);
}

export function deactivate() {}

class SessionsViewProvider implements vscode.WebviewViewProvider {
    private currentView: vscode.WebviewView | undefined;
	private readonly store = new SessionStore();
	private pendingToken: string | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

    async clearToken(): Promise<void> {
		await removeToken(this.context);
		this.pendingToken = undefined;
		this.store.setToken(undefined);
        if (this.currentView) {
            await this.resolveWebviewView(this.currentView);
        }
    }

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.currentView = webviewView;
		this.store.attach(webviewView);
		const token = await getToken(this.context);
		this.pendingToken = token;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};

		const icons = {
			chatgpt: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'chatgpt.svg')).toString(),
			github: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'github.svg')).toString(),
			cursor: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'cursor.svg')).toString(),
			claude: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'claudeicon.png')).toString(),
			vscode: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icons', 'vscode.jpeg')).toString(),
		};
		const nonce = createNonce();
		if (!token) {
			webviewView.webview.html = getSetupHtml(nonce);
		} else {
			webviewView.webview.html = getWebviewHtml({ webview: webviewView.webview, nonce, icons });
		}

		webviewView.webview.onDidReceiveMessage(async (raw) => {
			const parsed = UiToHostMessageSchema.safeParse(raw);
			if (!parsed.success) {
				logger.warn('Rejected unknown webview message');
			return;
		}
			switch (parsed.data.type) {
				case 'ui/ready': {
					this.store.setToken(this.pendingToken);
					break;
				}
				case 'ui/saveToken': {
					const t = parsed.data.token.trim();
					await saveToken(this.context, t);
					this.pendingToken = t;
					this.store.setToken(t);
					await this.resolveWebviewView(webviewView);
					break;
				}
				case 'ui/clearToken': {
					await removeToken(this.context);
					this.pendingToken = undefined;
					this.store.setToken(undefined);
					break;
				}
				case 'ui/retry': {
					this.store.setToken(this.pendingToken);
					break;
				}
			}
		});

		webviewView.onDidDispose(() => {
			this.store.dispose();
		});
	}
}

function createNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
	return text;
}


