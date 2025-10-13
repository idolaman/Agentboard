import * as vscode from 'vscode';

class ThinkingLoggerChannel {
	private readonly channel: vscode.OutputChannel;
	private _debug = false;

	constructor() {
		this.channel = vscode.window.createOutputChannel('Thinking Logger');
	}

	setDebug(enabled: boolean): void {
		this._debug = enabled;
	}

	info(message: string): void {
		this.channel.appendLine(`[info ] ${new Date().toISOString()} ${message}`);
	}

	warn(message: string): void {
		this.channel.appendLine(`[warn ] ${new Date().toISOString()} ${message}`);
	}

	error(message: string): void {
		this.channel.appendLine(`[error] ${new Date().toISOString()} ${message}`);
	}

	debug(message: string): void {
		if (!this._debug) return;
		this.channel.appendLine(`[debug] ${new Date().toISOString()} ${message}`);
	}
}

export const logger = new ThinkingLoggerChannel();


