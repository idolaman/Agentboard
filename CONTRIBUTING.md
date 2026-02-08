# Contributing to Agentboard

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- **Node.js** 18+ (recommended 20+)
- **npm** 9+
- **VS Code** or **Cursor** (for running the sidebar extension)

## Repository structure

```
agentboard/
  mcp_based_chat_detection_extension/   # MCP HTTP/SSE server
  thinking-logger-ui/                   # VS Code/Cursor sidebar extension
```

## Development setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/idolaman/agentboard.git
   cd agentboard
   ```

2. **Install and run the MCP server**
   ```bash
   cd mcp_based_chat_detection_extension
   npm install
   npm run dev
   ```
   The server starts on `http://127.0.0.1:17890`.

3. **Install and build the sidebar extension**
   ```bash
   cd thinking-logger-ui
   npm install
   npm run build
   ```

4. **Launch the extension in debug mode**
   Open the repo in VS Code/Cursor, go to the **Run and Debug** panel, and start the provided launch configuration. A new Extension Development Host window will open with the sidebar active.

## Code style

- **TypeScript** with strict mode enabled
- **ESLint** for linting
- **Prettier** for formatting

Run the linter before submitting a PR:
```bash
npm run lint        # in the relevant package directory
```

## Making changes

1. Create a branch from `main`:
   ```bash
   git checkout -b my-feature
   ```
2. Make your changes in small, focused commits.
3. Test your changes locally (run the server + extension).
4. Push your branch and open a pull request.

## Pull request guidelines

- Give your PR a clear, descriptive title.
- Describe **what** changed and **why** in the PR body.
- Keep PRs focused — one logical change per PR.
- Include screenshots or screen recordings for UI changes.
- Make sure the project builds without errors before submitting.

## Reporting issues

- Use the [bug report template](https://github.com/idolaman/agentboard/issues/new?template=bug_report.md) for bugs.
- Use the [feature request template](https://github.com/idolaman/agentboard/issues/new?template=feature_request.md) for ideas.
- Search existing issues before opening a new one.

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0 license](./LICENSE.md).
