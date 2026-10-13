# ASSUMPTIONS — skill-pi

Durable project understanding. Tiers: `## VERIFIED` (checked against code), `## INFERRED (HYPOTHESIS)` (likely, unverified), `## LOCKED` (ADR index — one pointer row per in-force decision), `## Open Questions`.

## VERIFIED

- skill-pi is a thin wrapper around `@earendil-works/pi-coding-agent` (npm semver), not a fork. It sets `PI_CODING_AGENT_DIR` to `~/.skill-pi/agent` before launching pi, and runs pi from a shim dir (`~/.skill-pi/work/<hash>/`) with an empty `.pi/` marker + `project -> <repo>` symlink so the real project's `.pi/` is never used.
- Bundled extensions load via a dir-level manifest: `extensions/package.json` `pi.extensions` array; pi's `resolveExtensionEntries` reads the *dir's own* `package.json`. User extensions in `~/.skill-pi/agent/extensions/` keep auto-discovery (no manifest).
- The wrapper is a pass-through CLI: `skill-pi [project-path] [pi args after --]`. `--import-auth` copies credentials from an existing pi install; `--agent-dir` / `SKILL_PI_AGENT_DIR` relocate the global agent dir; `--no-shim` opts out of project isolation.
- Tests: `node --test "test/**/*.test.js"` (unit + integration; config/shim/rpc/integration suites).
- Node >= 22.19.0, ESM (`"type": "module"`).

## INFERRED (HYPOTHESIS)

- Small local Ollama models (function-calling capable) can drive `ask_user` E2E deterministically when prompted to call the tool explicitly. (Will be confirmed by the 2026-10-13-ask-user E2E step.)

## LOCKED

Highest sequence in use: 0005

| ADR | Decision | Status | Path |
|-----|----------|--------|------|
| 0001 | Load bundled extensions via a dir-level pi manifest (`extensions/package.json` `pi.extensions`) | accepted | `.skillgrid/artifacts/04-adr-0001-extension-loading-via-dir-manifest.md` |
| 0002 | Full separation from pi — never load any `.pi` (user or project); pi reads `<cwd>/.skill-pi` via `piConfig.configDir` + `PI_PACKAGE_DIR`; shim retired | proposed | `.skillgrid/artifacts/04-adr-0002-full-separation-from-pi.md` |
| 0003 | `Taskfile.yml` is the canonical automation surface for build/install/test/pack/publish; `package.json` scripts are shims only | accepted | `.skillgrid/artifacts/04-adr-0003-taskfile-as-automation-standard.md` |
| 0004 | Extensions are separately published, independently versioned pi packages (`@skill-pi/pi-*`); wrapper ships them as workspace deps | superseded (scope) by ADR-0005 | `.skillgrid/artifacts/04-adr-0004-extensions-as-separately-published-packages.md` |
| 0005 | Package naming under `@devopstales`: wrapper `@devopstales/skill-pi`, extensions `@devopstales/pi-<name>` | accepted | `.skillgrid/artifacts/04-adr-0005-package-naming-devopstales-scope.md` |

## Open Questions

- Pre-existing `--extension <dir>` failure when the seeded agent dir is empty (`ensureAgentDir`) — tracked separately from ask-user work.
