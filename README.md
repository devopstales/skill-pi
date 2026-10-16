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
- **`skill-pi-tui`** — the TUI surface: a `session_start` header (logo, tagline,
  session stats grid) confirming the isolated session, plus a fullscreen
  right-side sidebar (terminals ≥ 140 columns) with a live Status card
  (project path, git branch, session name, uncommitted change counts), an
  enriched footer (cwd, git, runtime, model/cost, extension statuses), a
  thinking-peek label, and provider-error cleanup. See
  [`extensions/skill-pi-tui/README.md`](extensions/skill-pi-tui/README.md).
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
- **`todo`** — a `todo` tool (`write`/`add`/`update`/`clear`/`list`) that gives the model
  a task list you can see, drawn as a card in the `skill-pi-tui` sidebar (widget above the
  editor on narrow terminals). The open snapshot is mirrored into the transcript, so the
  list survives `/reload`, compaction, and branch navigation. `ctrl+shift+t` collapses,
  `alt+shift+up/down` scrolls; a stale warning appears after several untouched turns.
  Published standalone as
  [`@devopstales/pi-todo`](https://github.com/devopstales/skill-pi/tree/main/extensions/todo).
- **`providers`** — model-provider extensions: the vendored
  [`pi-free`](https://github.com/apmantza/pi-free) package plus the `opencode-zen`
  and `antigravity` OAuth providers behind the `SKILL_PI_DISABLE_PROVIDERS`
  seam
  ([`extensions/providers/README.md`](extensions/providers/README.md),
  [`pi-free/README.md`](extensions/providers/pi-free/README.md)). Registers native
  providers (Kilo, Cline, LLM7, ZenMux, DeepInfra, Novita, GMI Cloud, Agnes AI, …) and
  captures Pi's built-in OpenCode / OpenCode Go / OpenRouter catalogs, refreshing them
  after session start. Free-only filter on by default; per-provider toggles
  (`/toggle-kilo`, `/toggle-openrouter`, …), `/pi-free-health` diagnostics, and opt-in
  auto-fallback to another free model on error.
- **`plan-build`** — Plan/Build modes with a persistent plan, explicit approval,
  clean-session handoff, and step-by-step execution. The plan is drawn as a card in
  the `skill-pi-tui` sidebar rail (same component machinery as the todo card);
  the mode rail is a footer status line. Core lifecycle forked from
  [janvitos/pi-plan-build](https://github.com/janvitos/pi-plan-build) (MIT);
  composer, 64-column panel, per-mode model memory, and the question tool are
  replaced by the sidebar integration and `ask_user`. `Alt+M` toggles
  modes; `--plan` / `--build` set the start mode; config at
  `~/.skill-pi/agent/skill-pi-plan-build.json`. See
  [`extensions/plan-build/README.md`](extensions/plan-build/README.md).
- **[`pi-hooks`](extensions/pi-hooks/)** — Claude Code-compatible command hooks.
  Hook groups are declared in the `hooks` key of `settings.json` (project
  `.skill-pi/settings.json`, merged over `~/.skill-pi/agent/settings.json`) and
  run as bash commands that receive Claude Code-style JSON on stdin and may
  answer with Claude Code-style JSON on stdout. Supported events: `SessionStart`,
  `SessionEnd`, `PreCompact`, `PostCompact`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `UserPromptSubmit`, `Stop`; `PreToolUse` / `PostToolUse` /
  `PostToolUseFailure` support per-handler `if` conditions and a tool-name
  `matcher`; `Stop` and `UserPromptSubmit` can block and continue for one more
  turn. Forked from
  [hsingjui/pi-hooks](https://github.com/hsingjui/pi-hooks) (MIT), homogenized for
  the isolated agent dir. See
  [`extensions/pi-hooks/README.md`](extensions/pi-hooks/README.md).

## Choosing a model

Pi's model selector has two distinct actions:

| Key | What it does | Persists across launches? |
|---|---|---|
| **Enter** | Switch the current session's model | No — session-only |
| **ctrl+s** (`app.models.save`) | Switch model **and** save as default | Yes — writes `defaultProvider` + `defaultModel` to `~/.skill-pi/agent/settings.json` |

The `/model <name>` command always uses the session-only path (`persist: false`).

If your model change "reverts" on the next launch, you pressed Enter. Press **ctrl+s** in the selector instead. The status line confirms: `Default model: <provider>/<model>` (persisted) vs `Model: <model>` (session-only).

### Settings.json quarantine

On every launch, `skill-pi` validates `~/.skill-pi/agent/settings.json` against pi's own
`SettingsSchema`. If the file is unparseable or schema-invalid, it is copied to
`settings.json.bak` and reseeded with defaults. This guards against a class of silent
failure where pi's `SettingsManager` sets `globalSettingsLoadError` at startup and then
skips every subsequent settings write (including model-default persistence), with no
visible error in the TUI.

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
