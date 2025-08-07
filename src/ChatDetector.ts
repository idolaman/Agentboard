import * as vscode from 'vscode';

export class ChatDetector {
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Assuming proposed VS Code chat API
    // Monitor chat sessions for changes (e.g., thinking state)
    // @ts-ignore - Proposed API, may not be typed
    const sessionListener = vscode.chat?.onDidChangeSessions?.((e: any) => {
      console.log('Chat session changed:', e);
      // TODO: Detect if session is 'thinking' - e.g., check if request is pending
    });

    if (sessionListener) {
      this.disposables.push(sessionListener);
    }

    // Log initial sessions
    // @ts-ignore - Proposed API, may not be typed
    const sessions = vscode.chat?.sessions;
    if (sessions) {
      console.log('Initial chat sessions:', sessions);
    }
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }
}
