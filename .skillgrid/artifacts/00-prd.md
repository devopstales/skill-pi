# PRD — skill-pi

**Product:** an isolated, publishable coding agent built on the [Pi](https://pi.dev) harness.

**One-liner:** `skill-pi` bundles curated extensions, skills, and a system prompt as a thin wrapper around `@earendil-works/pi-coding-agent`, so users get a `skill-pi` binary that never touches an existing `pi` install.

## Core requirements

1. **Separate global config + auth** — pi runs with `PI_CODING_AGENT_DIR` pointing at `~/.skill-pi/agent`; the stock `~/.pi/agent` is never read or written.
2. **No shared project `.pi/`** — pi runs from a shim dir with an empty `.pi/` marker + `project` symlink; the real project's `.pi/` is never used (`--no-shim` opts out).
3. **Bundled extensions always load** — explicit `pi.extensions` manifest in `extensions/package.json` (ADR 0001).

## Out of scope (product-level)

- Forking pi — version moves come through npm semver.
- Managing user-level extensions (drop-file into `~/.skill-pi/agent/extensions/`).
- Windows support for PTY-based E2E (Linux `node-pty`).
