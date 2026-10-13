# Technical Glossary

| Term | Definition |
|---|---|
| **wrapper** | `bin/skill-pi.js` — spawns pi's CLI bundle with an isolated agent dir, shim cwd, and extension flags. |
| **shim dir** | `~/.skill-pi/work/<hash>/` — owns an empty `.pi/` marker and a `project -> <repo>` symlink so pi's project discovery never touches the real project's `.pi/`. |
| **agent dir** | `~/.skill-pi/agent` (override `SKILL_PI_AGENT_DIR` / `--agent-dir`) — pi global config, auth, sessions, user extensions. |
| **pi manifest** | The `pi` field of a `package.json` (`extensions`/`skills`/`prompts`/`themes` arrays) that pi's `resolveExtensionEntries` reads for a directory passed via `--extension`. |
| **manifest dir** | A directory whose own `package.json` carries a `pi` manifest — skill-pi uses `extensions/`. |
| **`PI_CODING_AGENT_DIR`** | Env var pointing pi at the agent dir for all user-level path resolution. |
| **`PI_PACKAGE_DIR`** | Env var overriding pi's package dir; skill-pi does *not* set it. |
