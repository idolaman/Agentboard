vscode-jumpmate/
├── package.json              # commands, views, activationEvents
├── tsconfig.json
├── src/
│   ├── extension.ts          # activates, wires registries, starts IPC hub
│   │
│   ├── core/                 # framework-level plumbing
│   │   ├── Store.ts          # in-memory task graph (observable)
│   │   ├── EventBus.ts       # WebSocket broker (cross-window)
│   │   ├── Collector.ts      # subscribes to all Detectors, updates Store
│   │   ├── JumpManager.ts    # receives “row-clicked” events → runs Action
│   │   └── types.ts          # shared enums/interfaces
│   │
│   ├── detectors/            # 🔌 plug-ins that *discover* work-in-progress
│   │   ├── Detector.ts       # interface: `start(ctx): Disposable`
│   │   ├── ChatDetector.ts   # uses vscode.chat.sessions & onDidChange…  :contentReference[oaicite:0]{index=0}
│   │   └── TerminalDetector.ts  # uses onDidOpenTerminal / exitStatus   :contentReference[oaicite:1]{index=1}
│   │
│   ├── matchers/             # decide which task-manager item a runtime event maps to
│   │   ├── Matcher.ts        # interface
│   │   ├── RegexMatcher.ts   # `[A-Z]+-\d+` in branch / prompt
│   │   └── LlmMatcher.ts     # calls `vscode.lm.sendRequest` for fuzzy mapping
│   │
│   ├── taskManagers/         # generic façade over ticket systems
│   │   ├── TaskManager.ts    # interface: `get(id)`, `search(user)`
│   │   ├── JiraManager.ts    # REST /search + SecretStorage creds
│   │   └── ____future____.ts # Linear, GitHub Issues, etc.
│   │
│   ├── actions/              # what happens when the user clicks a row
│   │   ├── Action.ts         # interface
│   │   ├── FocusChat.ts      # reveal chat tab
│   │   ├── FocusTerminal.ts  # terminal.show()
│   │   └── JumpWindow.ts     # `cursor <ws> --reuse-window --open-url ...` :contentReference[oaicite:2]{index=2}
│   │
│   ├── ui/                   # presentation layer (replace QuickPick later with React Webview)
│   │   ├── TaskQuickPick.ts  # mini pop-up listing Store items
│   │   └── IntegrationsView.ts # tree-view listing enabled MCP/Jira servers
│   │
│   └── utils/
│       ├── Config.ts         # loads ~/.cursor/mcp.json & workspace .cursor/mcp.json  :contentReference[oaicite:3]{index=3}
│       ├── Logger.ts
│       └── Paths.ts
└── test/
    └── …


Detectors ─┐        ┌── Matchers ─┐
           │        │             │
           ▼        ▼             │
        Collector──────→ TaskManager(s)
           │                      │
           ▼                      │
           Store  ◀─┐             │
             ▲     │  EventBus ───┘  (cross-window sync)
             └─────┘
                 │    UI emits  JumpRequests
                 ▼
            JumpManager ────► Actions (chat / terminal / window)

## Usage
- Open the Command Palette and run "Show Active Tasks" (or press Alt+Cmd+T) to verify the extension is active.
- To enable chat thinking detection from Cursor data, set the following settings:
  - `cursorHeadsUp.enableDbAccess`: true
  - Optional: `cursorHeadsUp.dbPollingIntervalMs` (default 5000)
  - Optional: `cursorHeadsUp.dbPathOverride` (absolute path to state.vscdb)

When detection is active, a status bar indicator shows "🤖 Chat: Thinking…" while Cursor chat is streaming.

## Security & Privacy
- This extension can read Cursor's local state database (`state.vscdb`) in read-only mode to infer chat status. No data is sent anywhere.
- The feature is opt-in via `cursorHeadsUp.enableDbAccess` and can be disabled anytime.
- Paths are auto-detected per OS; you can override with `cursorHeadsUp.dbPathOverride`.

## Development
- Build: `npm run compile`
- Watch: `npm run watch`
- Debug: F5 to launch Extension Development Host

## TODO
- Ship DB-based detector (done)
- Polish status bar indicator (done)
- Add QuickPick with active chats/terminals (future)
