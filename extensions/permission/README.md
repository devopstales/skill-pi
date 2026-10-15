# @devopstales/pi-permission

Opencode-style permission gate for pi tool calls.

## Features

- **Allow/deny/ask/always** rules for tool calls
- **conf.d persistence** — rules survive across sessions
- **Bash parsing** — tree-sitter-bash for command-level permission
- **Review dialog** — TUI popup for permission requests
- **Preview** — show what a tool call will do before approving
- **Permissive defaults** — matches opencode: reads/search run silently, only writes and shell prompt

## Defaults

When no rule matches a tool, the extension resolves using opencode-style per-tool defaults:

| Default | Tools |
|---------|-------|
| `allow` | `read`, `glob`, `grep`, `ls`, `fd`, `rg`, `find`, `task`, `skill` |
| `ask` | `edit`, `write`, `bash`, `webfetch`, `websearch`, `fetch` |

**Dynamic extension allow:** any tool registered by a local extension (discovered via `pi.getAllTools()` `sourceInfo`) is also `allow` by default — no per-tool rule needed. This covers bundled extensions (`todo`, …) and future ones. Namespaced/MCP tools are not covered and still `ask` unless a rule matches. Explicit rules always win: `deny`/`ask` entries in `conf.d/permission.conf` beat the auto-allow.

Additional guards:

- **`.env` guard (read only)** — reading `*.env` / `*.env.*` files prompts (`ask`). `.env.example` is allowed. Explicit rules override.
- **`external_directory`** — path-taking tools touching files outside the project working directory prompt (`ask`). Temp folder paths are allowed.

`settings.defaultMode` (when set) acts as the global catch-all and overrides per-tool defaults, matching opencode's `"*"` key.

## Config

Rules live in `<project>/.skill-pi/conf.d/permission.conf` (project) and `~/.skill-pi/conf.d/permission.conf` (user). Schema:

```json
{
  "defaultMode": "ask",
  "always": ["bash(git status *)"],
  "allow": ["read(*)"],
  "deny": ["bash(rm -rf *)"],
  "ask": ["webfetch(*)"]
}

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
