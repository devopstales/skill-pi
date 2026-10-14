# skill-pi

An isolated, publishable coding agent built on the [Pi](https://pi.dev) harness — not a fork of it.
`skill-pi` bundles your extensions, skills, and system prompt as a thin wrapper around
`@earendil-works/pi-coding-agent`, so you get a `skill-pi` binary that never touches an
existing `pi` install.

## What makes it isolated

| Resource | Stock `pi` | `skill-pi` |
|---|---|---|
| Binary | `pi` | `skill-pi` |
| Global config | `~/.pi/agent` | `~/.skill-pi/agent` |
| Credentials | `~/.pi/agent/auth.json` | `~/.skill-pi/agent/auth.json` |
| Sessions | `~/.pi/agent/sessions` | `~/.skill-pi/agent/sessions` |
| Project config | `<project>/.pi` | shim dir (`~/.skill-pi/work/<hash>/.pi`), real project untouched |
| Bundled extensions | n/a | `skill-pi/extensions/` (always loaded) |
| User extensions | `~/.pi/agent/extensions` | `~/.skill-pi/agent/extensions` |

How the two hard requirements work:

1. **Separate global config + auth** — the wrapper sets `PI_CODING_AGENT_DIR` to
   `~/.skill-pi/agent` before launching pi. Pi resolves all user-level paths (settings,
   auth, models, sessions, extensions, trust) from that directory. Your `~/.pi/agent`
   is never read or written. Override with `SKILL_PI_AGENT_DIR` or `--agent-dir`.

2. **No shared `.pi/` project folder** — pi's project-level discovery is anchored to its
   working directory (there is no `PI_CODING_AGENT_PROJECT_DIR` env var upstream yet).
   The wrapper therefore runs pi from a **shim dir**:
   `~/.skill-pi/work/<hash>/` containing an empty `.pi/` marker and a `project -> <your
   repo>` symlink. Pi discovers project config in the shim's `.pi/` (empty by default)
   and reaches your real code through the symlink, so repo `AGENTS.md` files still load.
   Your project's own `.pi/` directory is never used. Use `--no-shim` to run pi directly
   in the project (shares its `.pi/`) or `SKILL_PI_WORK_DIR` to relocate shim dirs.

3. **Bundled extensions always load** — the wrapper enumerates `<skill-pi>/extensions`
   and `~/.skill-pi/agent/extensions/` itself (top-level `*.ts`/`*.js` plus subdirectory
   `index.ts`/`index.js`) and passes each file as an explicit `--extension` flag to pi.
   It also passes `--no-extensions`, which suppresses pi's package-scope discovery
   (settings packages and auto-discovered dirs) so nothing the user installed elsewhere
   leaks in — while the explicit `--extension` flags above still load.

## Install

```sh
npm install -g @devopstales/skill-pi
```

## First run

```sh
# Copy credentials + custom providers from an existing pi install (explicit, one-time)
skill-pi --import-auth ~/.pi/agent

# Or authenticate fresh
skill-pi -- /path/to/project   # then /login inside the TUI
```

`skill-pi` is a pass-through CLI: anything after the project path goes to pi unchanged.

```sh
skill-pi                          # start in cwd
skill-pi /path/to/repo             # start in a project
skill-pi /path/to/repo -c          # continue last session
skill-pi --print "summarize repo"  # non-interactive
skill-pi -- --mode rpc             # force args through to pi
skill-pi --no-shim /path/to/repo   # share the project's .pi/ (opt out of project isolation)
skill-pi --agent-dir ~/other-agent # relocate the global agent dir
```

## Layout

```
skill-pi/
  bin/skill-pi.js        wrapper: env, seeding, shim, launch
  lib/config.js          agent dir resolution + first-run seeding
  lib/shim.js            shim-dir builder (project .pi isolation)
  lib/auth.js            import-auth helper
  extensions/            bundled pi extensions (TypeScript, always loaded)
  skills/                bundled skills
  SYSTEM.md              default system prompt (copy to <agent-dir>/SYSTEM.md to activate)
  defaults/              first-run seed values
```

## Adding your own extensions

User-level (all projects): drop TypeScript extensions into `~/.skill-pi/agent/extensions/`.
Bundled (shipped with the package): add the file to `extensions/` (or a subdirectory with
an `index.ts`) — the wrapper discovers it on the next launch; no manifest or registration
step.

Currently bundled:

- **`ask-user`** — the `ask_user` tool: pauses the agent to collect one focused
  decision (2–5 options, single choice or multi-select, optional freeform answer) or a
  batch of 2–4 independent decisions. In the TUI the question is shown as a popup; in
  RPC mode it falls back to select/input dialogs. The answer comes back as a structured
  tool result (`selection`, `freeform`, or `cancelled`), and `ask:answered` /
  `ask:cancelled` events fire for hosts that want to track prompt outcomes. In
  non-dialog modes (e.g. `--print`) it returns a graceful "unavailable" result instead
  of hanging.
- **`skill-pi-banner`** — a `session_start` notification confirming the isolated session.
- **`file-search`** — first-class `fd` (find files) and `rg` (search content) tools. On
  session start it resolves a usable binary per tool: a system `fd`/`fdfind`/`rg` is
  preferred silently, then a fallback in the package `bin/` (silently), and only when
  neither exists does it download an official release into `bin/` (the one case that
  notifies). Also published standalone as
  [`@devopstales/pi-file-search`](https://github.com/devopstales/skill-pi/tree/main/extensions/file-search)
  for pi users outside skill-pi.
- **`permission`** — an opencode-style permission gate for tool calls: allow/deny/ask
  rules resolved per call (strictest wins, bash commands AST-parsed), an interactive
  allow/reject prompt with an `edit`/`write` diff review, `Allow always` rules persisted
  to `conf.d/permission.conf`, and a `/permission-toggle-auto-accept` auto-accept toggle
  (status line reflects on/off; optional `keybindings.autoAcceptEdits` shortcut).

## Upgrading

`skill-pi` depends on `@earendil-works/pi-coding-agent` through normal npm semver.
`npm install -g @devopstales/skill-pi@latest` updates the wrapper *and* the pi version in one step.
There is no `pi update` interaction: the two installs are independent packages.

## Limitations

- The shim-cwd trick means pi reports the shim directory as its working directory in
  some contexts (session paths, debug logs). Tool paths still resolve through the
  `project` symlink into your real repo.
- Project trust prompts apply to the shim dir, not your project dir. First run in a new
  project may ask once per shim hash.
- pi's built-in `rg`/`fd` binaries live in the agent dir (`~/.skill-pi/agent/bin/`);
  they are installed by pi on first use, independent of the stock pi install.
