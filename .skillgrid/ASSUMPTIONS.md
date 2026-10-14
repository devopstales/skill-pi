# ASSUMPTIONS — skill-pi

Durable project understanding. Tiers: `## VERIFIED` (checked against code), `## INFERRED (HYPOTHESIS)` (likely, unverified), `## LOCKED` (ADR index — one pointer row per in-force decision), `## Open Questions`.

## VERIFIED

- skill-pi is a thin wrapper around `@earendil-works/pi-coding-agent` (npm semver), not a fork. It sets `PI_CODING_AGENT_DIR` to `~/.skill-pi/agent` before launching pi, and runs pi from a shim dir (`~/.skill-pi/work/<hash>/`) with an empty `.pi/` marker + `project -> <repo>` symlink so the real project's `.pi/` is never used.
- Bundled extensions load via explicit enumeration: the wrapper (`bin/skill-pi.js`) scans `<skill-pi>/extensions` and `<agent-dir>/extensions` with `collectExtensionFiles` (top-level `*.ts`/`*.js` + subdirectory `index.ts`/`index.js`), passing each as an `--extension` flag. `--no-extensions` suppresses pi's package-scope discovery (settings packages + auto-discovered dirs); it does not suppress the explicit CLI flags. No manifest file is required.
- The wrapper is a pass-through CLI: `skill-pi [project-path] [pi args after --]`. `--import-auth` copies credentials from an existing pi install; `--agent-dir` / `SKILL_PI_AGENT_DIR` relocate the global agent dir; `--no-shim` opts out of project isolation.
- Tests: `node --test "test/**/*.test.js"` (unit + integration; config/shim/rpc/integration suites).
- Node >= 22.19.0, ESM (`"type": "module"`).

## INFERRED (HYPOTHESIS)

- Small local Ollama models (function-calling capable) can drive `ask_user` E2E deterministically when prompted to call the tool explicitly. (Will be confirmed by the 2026-10-13-ask-user E2E step.)

## LOCKED

Highest sequence in use: 0008

| ADR | Decision | Status | Path |
|-----|----------|--------|------|
| 0001 | Load bundled extensions via explicit enumeration (`collectExtensionFiles`) + `--no-extensions` (supersedes dir-level manifest) | accepted | `.skillgrid/artifacts/04-adr-0001-extension-loading-via-dir-manifest.md` |
| 0002 | Full separation from pi — never load any `.pi` (user or project); pi reads `<cwd>/.skill-pi` via `piConfig.configDir` + `PI_PACKAGE_DIR`; shim retired | proposed | `.skillgrid/artifacts/04-adr-0002-full-separation-from-pi.md` |
| 0003 | `Taskfile.yml` is the canonical automation surface for build/install/test/pack/publish; `package.json` scripts are shims only | accepted | `.skillgrid/artifacts/04-adr-0003-taskfile-as-automation-standard.md` |
| 0004 | Extensions are separately published, independently versioned pi packages (`@skill-pi/pi-*`); wrapper ships them as workspace deps | superseded (scope) by ADR-0005 | `.skillgrid/artifacts/04-adr-0004-extensions-as-separately-published-packages.md` |
| 0005 | Package naming under `@devopstales`: wrapper `@devopstales/skill-pi`, extensions `@devopstales/pi-<name>` | accepted | `.skillgrid/artifacts/04-adr-0005-package-naming-devopstales-scope.md` |
| 0006 | Never modify pi source — build on top of its public surface (env, CLI flags, settings, `pi.extensions` manifest); no fork, no runtime patch, no post-install edit | accepted | `.skillgrid/artifacts/04-adr-0006-never-modify-pi-source.md` |
| 0007 | Bundled extensions are self-contained subdirs (`extensions/<name>/` + own `package.json` + toolchain); runtime deps resolve via the root `node_modules`, extension `node_modules` is a private dev toolchain | proposed | `.skillgrid/artifacts/04-adr-0007-self-contained-extensions.md` |
| 0008 | Plugin/extension config lives in `$AGENT_HOME/conf.d/<name>.conf` (user) + `<project-root>/conf.d/<name>.conf` (project); derived from `getAgentDir()` so the same extension works in stock pi and skill-pi; bounded ADR 0002 exception for the project `.pi/conf.d` fallback read | proposed | `.skillgrid/artifacts/04-adr-0008-plugin-config-confd.md` |

## Open Questions

- Pre-existing `--extension <dir>` failure when the seeded agent dir is empty (`ensureAgentDir`) — tracked separately from ask-user work.
