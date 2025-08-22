import * as vscode from 'vscode';
import { ThinkingIndicator } from './ThinkingIndicator';
import { DBChatDetector } from './DBChatDetector';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('cursor-heads-up');
  output.show(true);
  const log = (msg: string) => output.appendLine(`[${new Date().toISOString()}] ${msg}`);

  log('Extension: activating');

  const indicator = new ThinkingIndicator(log);
  const dbDetector = new DBChatDetector(context);
  dbDetector.onThinkingChange(({ isThinking }) => {
    log(`Extension: onThinkingChange → ${isThinking}`);
    if (isThinking) indicator.showThinking(); else indicator.hide();
  });
  try {
    log('Extension: calling DBChatDetector.start');
    dbDetector.start();
    log('Extension: DBChatDetector.start returned');
  } catch (e) {
    log(`Extension: DBChatDetector.start threw: ${String(e)}`);
  }

  const disposable = vscode.commands.registerCommand('cursorHeadsUp.showTasks', () => {
    log('Extension: command cursorHeadsUp.showTasks invoked');
    const msg = 'Heads Up: ' + (indicator ? 'Ready' : 'Not Ready');
    vscode.window.showInformationMessage(msg);
  });

  const testLogDisposable = vscode.commands.registerCommand('cursorHeadsUp.testLog', () => {
    log('Test log triggered');
  });

  const logDocsDisposable = vscode.commands.registerCommand('cursorHeadsUp.logOpenDocuments', () => {
    log('Debug: Logging open documents');
    const docs = vscode.workspace.textDocuments;
    log(`Debug: Total open documents = ${docs.length}`);
    docs.forEach((doc) => {
      log(`Debug: Open document - uri=${doc.uri.toString()}, lang=${doc.languageId}, isUntitled=${doc.isUntitled}`);
    });
  });

  context.subscriptions.push(disposable);
  context.subscriptions.push(testLogDisposable);
  context.subscriptions.push(logDocsDisposable);
  context.subscriptions.push({ dispose: () => dbDetector.dispose() });
  context.subscriptions.push({ dispose: () => indicator.dispose() });
  context.subscriptions.push(output);

  log('Extension: activated');
}

export function deactivate() {}
