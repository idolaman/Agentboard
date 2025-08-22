import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

export type ChatThinkingChange = {
  conversationId: string;
  isThinking: boolean;
  title?: string;
};

export class DBChatDetector implements vscode.Disposable {
  private db: any | null = null;
  private disposed = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private lastState = new Map<string, boolean>();
  private output = vscode.window.createOutputChannel('cursor-heads-up');
  private rowState = new Map<string, { lastValue: string; lastUpdatedAt: number }>();
  private bubbleRowState = new Map<string, { lastValue: string; lastUpdatedAt: number }>();

  private readonly onThinkingEmitter = new vscode.EventEmitter<ChatThinkingChange>();
  public readonly onThinkingChange = this.onThinkingEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public start(): void {
    this.log('DBChatDetector.start: begin');

    const dbPath = this.getDbPath();
    this.log(`DBChatDetector.start: resolved dbPath=${dbPath ?? 'undefined'}`);
    if (!dbPath) {
      this.log('DBChatDetector.start: no dbPath resolved');
      return;
    }
    if (!fs.existsSync(dbPath)) {
      this.log('DBChatDetector.start: db file does not exist');
      return;
    }

    // Initial sweep
    this.refreshViaCli();

    // Polling
    const intervalMs = vscode.workspace.getConfiguration().get<number>('cursorHeadsUp.dbPollingIntervalMs', 5000);
    this.log(`DBChatDetector.start: polling every ${Math.max(500, intervalMs)} ms`);
    this.pollTimer = setInterval(() => this.refreshViaCli(), Math.max(500, intervalMs));

    // File watcher (best-effort)
    try {
      this.watcher = fs.watch(dbPath, { persistent: false }, () => {
        this.log('DBChatDetector.watcher: change detected → refresh');
        this.refreshViaCli();
      });
      this.log('DBChatDetector.start: file watcher attached');
    } catch {
      // Ignore watcher failure; polling will still work
      this.log('DBChatDetector.start: file watcher attach failed (ignored)');
    }
  }

  private refreshViaCli(): void {
    const dbPath = this.getDbPath();
    if (!dbPath) {
      this.log('DBChatDetector.refreshViaCli: no dbPath');
      return;
    }
    const query = "SELECT key, CAST(value AS TEXT) AS value FROM cursorDiskKV WHERE key LIKE 'composerData:%'";
    execFile('sqlite3', ['-readonly', dbPath, '-cmd', '.mode json', query], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        this.log(`DBChatDetector.refreshViaCli: sqlite3 error: ${String(err)}`);
        return;
      }
      try {
        const composerRows = JSON.parse(stdout) as Array<{ key: string; value: string }>;
        const rows = Array.isArray(composerRows) ? composerRows : [];
        this.log(`DBChatDetector.refreshViaCli: composerRows=${rows.length}`);
        // collect bubble keys from latest headers
        const bubbleKeys: string[] = [];
        for (const r of rows) {
          if (!r?.value) continue;
          try {
            const obj = JSON.parse(r.value);
            const headers: any[] | undefined = Array.isArray(obj?.fullConversationHeadersOnly)
              ? obj.fullConversationHeadersOnly
              : undefined;
            if (headers && headers.length > 0) {
              const last = headers[headers.length - 1];
              const bid: string | undefined = last?.serverBubbleId || last?.bubbleId;
              const cid: string | undefined = obj?.composerId || this.deriveComposerIdFromKey(r.key);
              if (bid && cid) bubbleKeys.push(`bubbleId:${cid}:${bid}`);
            }
          } catch {}
        }
        if (bubbleKeys.length === 0) {
          this.processRows(rows);
          return;
        }
        const inList = bubbleKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
        const bubbleQuery = `SELECT key, CAST(value AS TEXT) AS value FROM cursorDiskKV WHERE key IN (${inList})`;
        execFile('sqlite3', ['-readonly', dbPath, '-cmd', '.mode json', bubbleQuery], { maxBuffer: 50 * 1024 * 1024 }, (bErr, bStdout) => {
          if (bErr) {
            this.log(`DBChatDetector.refreshViaCli: sqlite3 bubble error: ${String(bErr)}`);
            this.processRows(rows);
            return;
          }
          try {
            const bubbleRows = JSON.parse(bStdout) as Array<{ key: string; value: string }>;
            this.log(`DBChatDetector.refreshViaCli: bubbleRows=${Array.isArray(bubbleRows) ? bubbleRows.length : 0}`);
            this.processRows(rows, Array.isArray(bubbleRows) ? bubbleRows : []);
          } catch (pe) {
            this.log(`DBChatDetector.refreshViaCli: bubble parse error: ${String(pe)} stdoutSnippet=${bStdout?.slice(0,200)}`);
            this.processRows(rows);
          }
        });
      } catch (e) {
        this.log(`DBChatDetector.refreshViaCli: parse error: ${String(e)} stdoutSnippet=${stdout?.slice(0, 200)}`);
      }
    });
  }

  private processRows(rows: { key: string; value: string }[]): void {
    const nextState = new Map<string, { thinking: boolean; title?: string }>();
    for (const row of rows) {
      const raw = row.value;
      if (typeof raw !== 'string' || raw.length === 0) continue;
      const composerIdFromKey = this.deriveComposerIdFromKey(row.key);
      let obj: any;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      const composerId: string | undefined = obj?.composerId || composerIdFromKey;
      if (!composerId) continue;
      const now = Date.now();
      const prev = this.rowState.get(composerId);
      const changed = !prev || prev.lastValue !== raw;
      const lastUpdatedAt = changed ? now : (prev?.lastUpdatedAt ?? now);
      if (changed) this.rowState.set(composerId, { lastValue: raw, lastUpdatedAt });
      const headers: any[] | undefined = Array.isArray(obj?.fullConversationHeadersOnly)
        ? obj.fullConversationHeadersOnly
        : undefined;
      const last = headers && headers.length > 0 ? headers[headers.length - 1] : undefined;
      const candidateStreaming = this.deriveThinkingFromComposerData(obj);
      const msSinceComposer = now - lastUpdatedAt;
      let msSinceBubble = Number.POSITIVE_INFINITY;
      let hasBubble = false;
      if (last) {
        const bid: string | undefined = last?.serverBubbleId || last?.bubbleId;
        if (bid) {
          const bkey = `bubbleId:${composerId}:${bid}`;
          hasBubble = true;
          const prevB = this.bubbleRowState.get(bkey);
          if (prevB) msSinceBubble = now - prevB.lastUpdatedAt;
        }
      }
      let isThinking = false;
      if (last?.type === 2) {
        const recency = hasBubble ? msSinceBubble : msSinceComposer;
        isThinking = candidateStreaming && recency < 5000;
      } else {
        isThinking = msSinceComposer < 1500;
      }
      this.log(
        `DBChatDetector.eval: id=${composerId} headers=${headers ? headers.length : 0} ` +
        `lastType=${last?.type ?? 'n/a'} hasServerBubbleId=${last?.serverBubbleId ? 'yes' : 'no'} ` +
        `changed=${changed ? 'yes' : 'no'} msSinceComposer=${msSinceComposer} ` +
        `hasBubble=${hasBubble ? 'yes' : 'no'} msSinceBubble=${isFinite(msSinceBubble) ? msSinceBubble : 'n/a'} → ${isThinking}`
      );
      nextState.set(composerId, { thinking: isThinking });
    }
    for (const [id, data] of nextState.entries()) {
      const prev = this.lastState.get(id) ?? false;
      if (prev !== data.thinking) {
        this.log(`DBChatDetector.refreshViaCli: onThinkingChange id=${id} → ${data.thinking}`);
        this.onThinkingEmitter.fire({ conversationId: id, isThinking: data.thinking, title: data.title });
      }
    }
    this.lastState = new Map(Array.from(nextState.entries()).map(([k, v]) => [k, v.thinking]));
  }

  private deriveComposerIdFromKey(key: string): string | undefined {
    // e.g., composerData:<composerId>
    const parts = key.split(':');
    if (parts.length === 2 && parts[0] === 'composerData') return parts[1];
    return undefined;
  }

  private deriveThinkingFromComposerData(obj: any): boolean {
    const headers: any[] | undefined = Array.isArray(obj?.fullConversationHeadersOnly)
      ? obj.fullConversationHeadersOnly
      : undefined;
    if (!headers || headers.length === 0) return false;
    const last = headers[headers.length - 1];
    // type: 1 = user, 2 = assistant
    if (last?.type === 2) {
      // While streaming, serverBubbleId is not yet set
      if (!last.serverBubbleId) return true;
    }
    return false;
  }

  private getDbPath(): string | undefined {
    const override = vscode.workspace.getConfiguration().get<string>('cursorHeadsUp.dbPathOverride', '').trim();
    if (override) return override;

    const platform = process.platform;
    const home = os.homedir();
    if (platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    if (platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    // linux
    return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.watcher) this.watcher.close();
    if (this.db) {
      try { this.db.close(); } catch {}
    }
    this.log('DBChatDetector.dispose: disposed');
    this.onThinkingEmitter.dispose();
  }

  private log(message: string): void {
    try {
      this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    } catch {
      // ignore logging errors
    }
  }
}


