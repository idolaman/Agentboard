import * as vscode from 'vscode';

const TOKEN_KEY = 'thinkingLogger.token';

export async function getToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	const token = await context.secrets.get(TOKEN_KEY);
	return token || undefined;
}

export async function setToken(context: vscode.ExtensionContext, token: string): Promise<void> {
	await context.secrets.store(TOKEN_KEY, token);
}

export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(TOKEN_KEY);
}


