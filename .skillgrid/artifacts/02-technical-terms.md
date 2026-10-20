# Technical Glossary

| Term | Definition |
|---|---|
| **wrapper** | `bin/skill-pi.js` — spawns pi's CLI bundle with an isolated agent dir, shim cwd, and extension flags. |
| **shim dir** | `~/.skill-pi/work/<hash>/` — owns an empty `.pi/` marker and a `project -> <repo>` symlink so pi's project discovery never touches the real project's `.pi/`. |
| **agent dir** | `~/.skill-pi/agent` (override `SKILL_PI_AGENT_DIR` / `--agent-dir`) — pi global config, auth, sessions, user extensions. |
| **pi manifest** | The `pi` field of a `package.json` (`extensions`/`skills`/`prompts`/`themes` arrays) that pi's `resolveExtensionEntries` reads for a directory passed via `--extension`. |
| **manifest dir** | A directory whose own `package.json` carries a `pi` manifest — skill-pi uses `extensions/`. |
| **`PI_CODING_AGENT_DIR`** | Env var pointing pi at the agent dir for all user-level path resolution. |
| **`PI_PACKAGE_DIR`** | Env var overriding pi's package dir; the wrapper does *not* set it for the parent session; pi-swarm deletes it from the child env (children read `<project>/.pi/`, not `.skill-pi/` — documented in `extensions/pi-swarm/README.md`). |
| **`webfetch`** | Bundled extension (`extensions/webfetch`) exposing a `webfetch` tool: static undici fetch (no headless browser) + trafilatura HTML→markdown extraction, with a 5MB response cap, bounded timeout, `beforeFetch` site short-circuits, and the `SKILL_PI_WEBFETCH` toggle. |
| **swarm child** | An isolated `skill-pi --mode rpc` subprocess spawned by the pi-swarm manager — a full coding agent under its own session, JSONL protocol on stdin/stdout, `PI_CODING_AGENT_DIR` set and `PI_PACKAGE_DIR` deleted. |
| **FleetView** | pi-swarm's below-prompt TUI list of tracked swarm children (main row + one row per agent), with a transcript overlay (Enter) and two-press `x` stop. |
| **agent type** | A `.skill-pi/agents/<name>.md` file (project) or `<agent-dir>/agents/<name>.md` (global) whose YAML frontmatter + body define a spawnable swarm child's persona (systemPrompt prepended to the prompt). |
| **`swarm:rpc:*`** | The frozen v1 cross-extension RPC contract (channels `ping`/`spawn`/`steer`/`consume`/`stop`, reply channel, envelope `{v, reqId, type, payload}`, `swarm:*` lifecycle events) — one-way door: renaming requires a protocol bump. |
| **prompt target** | The session-scoped selection (default `build`, Ctrl+Q `Tab` cycle per ADR-0010) deciding whether interactive input enters the main session or spawns a swarm child. |
