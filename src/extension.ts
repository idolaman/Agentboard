import * as vscode from 'vscode';
import { ChatDetector } from './ChatDetector';

export function activate(context: vscode.ExtensionContext) {
  console.log('Cursor Heads Up extension activated');

  const chatDetector = new ChatDetector();
  context.subscriptions.push({ dispose: () => chatDetector.dispose() });

  const disposable = vscode.commands.registerCommand('cursorHeadsUp.showTasks', () => {
    vscode.window.showInformationMessage('Show Active Tasks - TODO: Implement QuickPick');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
