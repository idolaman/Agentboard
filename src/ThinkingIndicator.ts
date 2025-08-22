import * as vscode from 'vscode';

export class ThinkingIndicator {
  private statusItem: vscode.StatusBarItem;
  private log?: (message: string) => void;

  constructor(log?: (message: string) => void) {
    this.log = log;
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusItem.command = undefined;
    this.hide();
  }

  showThinking() {
    this.statusItem.text = '🤖 Chat: Thinking…';
    this.statusItem.tooltip = 'An AI chat is currently processing';
    this.statusItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusItem.show();
    this.log?.('ThinkingIndicator: showThinking');
  }

  hide() {
    this.statusItem.text = '';
    this.statusItem.tooltip = undefined;
    this.statusItem.color = undefined;
    this.statusItem.backgroundColor = undefined as unknown as vscode.ThemeColor | undefined;
    this.statusItem.hide();
    this.log?.('ThinkingIndicator: hide');
  }

  dispose() {
    this.statusItem.dispose();
    this.log?.('ThinkingIndicator: disposed');
  }
}
