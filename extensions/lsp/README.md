# lsp

LSP-backed `code_symbols` tool for the [Pi](https://pi.dev) coding agent.
Spawns and manages one LSP subprocess per `(serverId, workspace root)` pair and
routes symbol requests by `serverId`, `language`, and `filePath`.

Forked from [jtepe/pi-lsp](https://github.com/jtepe/pi-lsp) (MIT), homogenized
for skill-pi: imports moved to `@earendil-works/*`, config relocated to the
[ADR 0008](../../.skillgrid/artifacts/04-adr-0008-plugin-config-confd.md)
conf.d contract, and the test fake runs under node.

## Tool API

The extension registers one tool, `code_symbols`:

| Param | Notes |
|---|---|
| `action` | `"search"` \| `"definitions"` \| `"references"` |
| `name` | Symbol name or wildcard pattern (`*`, `?`). Partial names are auto-wildcarded for `search`. |
| `filePath` | Optional for `search`, required for `definitions`/`references` |
| `language` | Language override for server selection |
| `serverId` | Explicit server id from `lsp.conf` |
| `includeSource` | Include source snippets in results |
| `limit` | Result cap (clamped to `maxLimit`) |

Examples:

```
Use code_symbols to search for "run*"
Use code_symbols to find definitions of "runTask" in src/app.ts
Use code_symbols to find references of "make_widget" in pkg/tool.py
```

## Configuration

Config lives in `conf.d` (ADR 0008), one file per extension:

| Scope | Location |
|---|---|
| **Project** | `<git-root>/.skill-pi/conf.d/lsp.conf` |
| **User (global)** | `dirname(getAgentDir())/conf.d/lsp.conf` — `~/.skill-pi/conf.d/lsp.conf` under skill-pi, `~/.pi/conf.d/lsp.conf` under stock pi |

Project config is merged over user config; a project server with the same `id`
overrides the user server. The file is JSON; `//` and `/* */` comments are
tolerated.

```jsonc
{
  "defaultLimit": 25,
  "maxLimit": 100,
  "eagerInit": false,
  "servers": [
    {
      "id": "ts",
      "name": "TypeScript",
      "languages": ["typescript", "javascript"],
      "fileGlobs": ["src/*.ts", "src/*.tsx", "test/*.ts"],
      "rootMarkers": ["package.json", "tsconfig.json"],
      "command": { "command": "vtsls", "args": ["--stdio"] }
    },
    {
      "id": "py",
      "name": "ty",
      "languages": ["python"],
      "fileGlobs": ["pkg/*.py", "tests/*.py"],
      "rootMarkers": ["pyproject.toml", "setup.py"],
      "command": { "command": "ty", "args": ["--stdio"] }
    }
  ]
}
```

### Server fields

- `id` — stable server identifier (defaults to `server-<n>`)
- `languages` — optional language filter used during routing
- `fileGlobs` — optional minimatch globs evaluated relative to the workspace cwd
- `rootMarkers` — files/dirs used to compute the LSP server root
- `command.command` — executable to spawn (must be on `$PATH` or absolute)
- `command.args` — optional argument array
- `command.env` — optional environment variables
- `initializationOptions` — optional LSP initialization payload
- `trace` — `off` | `messages` | `verbose`
- `treeSitterLanguage` — reserved for upcoming tree-sitter source expansion

Language servers are **not** auto-installed; install them separately
(e.g. `npm install -g vtsls`).

## Development

```sh
npm install
npm run check   # tsc --noEmit
npm test        # vitest
```

Tests use a fake stdio LSP server (`fake-lsp-server.ts`, spawned via
`process.execPath`) and verify server routing, workspace symbol search,
definition/reference flows, and shutdown cleanup.

## Not implemented yet

- Tree-sitter-based expansion from a symbol range to the enclosing syntax node
- Automatic installation or discovery of language servers
- Rich disambiguation UI when multiple document symbols match the same pattern
