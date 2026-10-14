# @devopstales/pi-permission

Opencode-style permission gate for pi tool calls.

## Features

- **Allow/deny/ask/always** rules for tool calls
- **conf.d persistence** — rules survive across sessions
- **Bash parsing** — tree-sitter-bash for command-level permission
- **Review dialog** — TUI popup for permission requests
- **Preview** — show what a tool call will do before approving

## Install

```bash
pi install npm:@devopstales/pi-permission
```

Or bundled with skill-pi (auto-discovered from `extensions/permission/index.ts`).

## Development

```bash
npm install
npm test          # vitest
npm run check     # tsc --noEmit
```

## License

MIT
