# ARCHITECTURE.md

**Project:** skill-pi
**Version:** 0.1.0
**Last Updated:** 2026-10-14

> This file describes the **live structure** of the codebase and is the source
> of truth for "how the system is built". It does **not** re-argue decisions —
> architectural decisions are recorded as `### ADR-NNNN` entries in
> `.skillgrid/ASSUMPTIONS.md` (LOCKED) and this file points at them.
>
> **Keep it factual and verifiable.** Every diagram, table row, and code snippet
> must correspond to something real in the repo (a package, a file:line, a
> config key). When you are unsure, write `<detect>` and fill it from the code.

## Table of Contents

1. Architecture Overview
2. Top-Level Layout
3. Application Layering
4. Entry Points & Command Surface
5. Domain / Core Logic
6. Data & Persistence
7. Storage & State
8. Cross-Cutting Transports (API / MCP / HTTP)
9. Frontend / UI (if any)
10. Plugin & Extension Architecture
11. Configuration & Feature Flags
12. Workflow / Pipeline (if any)
13. Enforcement & Quality Gates (tests, hooks, lint)
14. Error Handling & Degradation
15. Security
16. Testing Strategy
17. Known Gaps & TODOs

## 1. Architecture Overview

`skill-pi` is a **thin wrapper** around `@earendil-works/pi-coding-agent` — not a
fork. It bundles its own extensions, skills, and system prompt and launches pi with
two env vars and an explicit `--extension` flag list, so a `skill-pi` binary never
reads or writes the stock `~/.pi/agent` install. All behavior comes from pi; the
wrapper only resolves directories, builds a brand overlay, and wires the extension
set.

```
                        +--------------------------------------------------+
   skill-pi CLI          |  wrapper (bin/skill-pi.js)                       |
  (spawnSync node) --->  |  1. agentDirFor()      -> ~/.skill-pi/agent      |
                         |  2. ensureAgentDir()   seed settings/auth/sessions|
                         |  3. brandOverlayDir()  -> <agent>/pi-brand       |
                         |  4. collectExtensionFiles() bundled + user exts  |
                         +--------------------------------------------------+
                                   |  spawnSync(process.execPath,
                                   |    pi/dist/bundle/cli.js,
                                   |    --extension f1..fN --no-extensions,
                                   |    env PI_CODING_AGENT_DIR=<agent>,
                                   |    env PI_PACKAGE_DIR=<overlay>,
                                   |    cwd=<project>)
                                   v
                         +--------------------------------------------------+
   pi-coding-agent       |  @earendil-works/pi-coding-agent  (not forked)    |
   (dist/bundle/cli.js)  |  TUI / RPC / print modes; runs the agent         |
                         +--------------------------------------------------+
                                   |
                    +--------------+--------------+
                    |              |              |
              bundled exts   ask-user.ts   user exts
              file-search    (tool:          <agent>/extensions/
              permission     ask_user)       (dropped in)
              skill-pi-tui   permission,
                             ask-user,
                             skill-pi-tui
```

## 2. Top-Level Layout

| Path | Purpose |
|---|---|
| `bin/` | CLI entrypoints — `skill-pi.js` (wrapper: env, seeding, extension wiring, launch) and `skill-pi-version.js` (prints version). |
| `lib/` | Wrapper modules — `config.js` (agent-dir resolution + first-run seeding), `brand.js` (brand overlay), `auth.js` (import-auth helper). |
| `extensions/` | Bundled pi extensions (TypeScript, always loaded): `ask-user.ts` (top-level) + `file-search/`, `permission/`, `skill-pi-tui/` subpackages. |
| `test/` | `node --test` suites (unit + integration + E2E). |
| `Taskfile.yml` | `task` automation: install/uninstall/clean/test/pack/publish. |
| `SYSTEM.md` | Default system prompt (copy to `<agent-dir>/SYSTEM.md` to activate). |
| `.skillgrid/` | Skillgrid config/state/artifacts (this zone). |
| `package.json` | Package `@devopstales/skill-pi`; bins, deps, `npm test` script. |

## 3. Application Layering

```
 bin/skill-pi.js   (entry: arg parse, orchestration, spawn)
   |  imports
   v
 lib/config.js     (agentDirFor, ensureAgentDir, seedDefaultPackages)
 lib/brand.js      (brandOverlayDir, linkOverlayAssets, piPackageRoot)
 lib/auth.js       (importAuth)
   |  resolves / symlinks
   v
 node_modules/@earendil-works/pi-coding-agent   (dist/bundle/cli.js — the real agent)
```

**Dependency rules:** `bin/` → `lib/` → `node_modules` (pi package). The wrapper
never imports pi's internals; it spawns `pi/dist/bundle/cli.js` as a child process
(`bin/skill-pi.js:210`). Extensions (`extensions/`) are loaded *by pi* at runtime
via `--extension` flags, not imported by the wrapper — so they may `import` from
`@earendil-works/pi-coding-agent` and the bundled runtime deps, but the wrapper and
the extensions do not import each other.

## 4. Entry Points & Command Surface

- **Entry point:** `bin/skill-pi.js:1` (shebang `#!/usr/bin/env node`). `main()` is
  `bin/skill-pi.js:169`; it resolves the bundled pi CLI (`resolvePiCli()` →
  `node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`) and `spawnSync`s
  it with `stdio: "inherit"` (`bin/skill-pi.js:210`).
- **Versioning:** read from `package.json` (`printVersion()` → `bin/skill-pi.js:128`);
  the pi version is read live from the package's `VERSION` export. `skill-pi-version.js`
  prints only the wrapper version.

| Command / Operation | What it does |
|---|---|
| `skill-pi [PROJECT] [pi args…]` | Launch pi for PROJECT (default `cwd`); everything after the project (or after `--`) passes through to pi unchanged. |
| `skill-pi --import-auth DIR` | Copy `auth.json` + `models.json` from DIR (default `~/.pi/agent`) into the agent dir. |
| `skill-pi --agent-dir DIR` | Override the agent directory (`~/.skill-pi/agent`). |
| `skill-pi --version` / `-v` | Print `skill-pi <ver> (wraps pi-coding-agent <ver>)`. |
| `skill-pi --help` / `-h` | Print the usage banner. |

## 5. Domain / Core Logic

| Module / Package | Responsibility |
|---|---|
| `lib/config.js` | Resolve the agent dir (`--agent-dir` > `$SKILL_PI_AGENT_DIR` > `~/.skill-pi/agent`) and first-run-seed it: `sessions/ prompts/ themes/ bin/`, a default `settings.json`, and an empty `auth.json`. No default provider packages are seeded (`defaultPackages = []`). |
| `lib/brand.js` | Build the brand overlay at `<agent-dir>/pi-brand`: a `package.json` that re-exports the real pi package with only `piConfig` overridden (`name: "skill-pi"`, `configDir: ".skill-pi"` — ADR-0002 D2), plus symlinks to the real `dist/ docs/ schemas/ examples/` so asset paths resolve. This is the directory `PI_PACKAGE_DIR` points at. |
| `lib/auth.js` | `importAuth()`: copy `auth.json` (+ `models.json` when present) from a source agent dir into the skill-pi agent dir. |
| `bin/skill-pi.js` | Orchestration: arg parsing, extension enumeration, env setup, and the `spawnSync` of pi. |

The core invariant the whole design serves: **isolation** — the wrapper only sets
`PI_CODING_AGENT_DIR` (and `PI_PACKAGE_DIR` for the overlay) and never touches the
stock `~/.pi/agent`. See ADR-0002 (full separation from pi) and ADR-0006 (never
modify pi source) in `.skillgrid/ASSUMPTIONS.md` § LOCKED.

## 6. Data & Persistence

The wrapper holds no persistent domain data of its own. It materializes an isolated
agent directory on first run:

```
 first run
   |
   v
 ensureAgentDir(~/.skill-pi/agent)
   |  mkdir sessions/ prompts/ themes/ bin/
   |  write settings.json (quietStartup, collapseChangelog, showHardwareCursor, packages: [])
   |  write auth.json {}
   v
 brandOverlayDir(~/.skill-pi/agent/pi-brand)   # package.json re-export + asset symlinks
   |
   v
 spawnSync(pi cli.js, --extension …, env PI_CODING_AGENT_DIR, PI_PACKAGE_DIR, cwd=<project>)
```

Sessions, credentials, and models are written by **pi** into the agent dir; the
wrapper's data responsibilities stop at seeding the directory and the overlay.
Project-level config is read by pi from `<project>/.skill-pi` (never `.pi` — ADR-0002 D2).

## 7. Storage & State

- **Primary store:** the JSON/files agent directory at `~/.skill-pi/agent` (override:
  `$SKILL_PI_AGENT_DIR` or `--agent-dir`). Zones: `auth.json`, `models.json`,
  `settings.json`, `sessions/`, `prompts/`, `themes/`, `bin/`, `extensions/`, and the
  `pi-brand/` overlay.
- **Migrations:** none — state is plain JSON; schema changes ride on the pi package
  version (npm semver).
- **State zones:** per-user global (`~/.skill-pi/agent`) vs per-project (`<project>/.skill-pi`,
  read by pi). The wrapper's own `Taskfile.yml` vars also honor `$SKILL_PI_AGENT_DIR` /
  `$SKILL_PI_WORK_DIR` for install/uninstall bookkeeping.

## 8. Cross-Cutting Transports (API / MCP / HTTP)

The wrapper itself exposes no network transport — it is a local CLI that `spawnSync`s
pi. The **pi agent** provides the transports (TUI, RPC over stdio, `--print`). The
`ask-user` extension adapts to whatever mode pi is in (TUI popup in interactive mode;
select/input dialogs in RPC; a graceful "unavailable" result in `--print`). No
server-facing surface is added by skill-pi.

## 9. Frontend / UI (if any)

There is no standalone web frontend. The UI is pi's TUI, extended by the bundled
`skill-pi-tui` extension (startup banner + fullscreen sidebar with a live Status card)
and the `ask-user` popup. `skill-pi-tui` is bundled, not published separately.

## 10. Plugin & Extension Architecture

Extensions are the **only** extension mechanism — there is no runtime registry in the
wrapper. pi's package-scope auto-discovery is suppressed with `--no-extensions`; the
wrapper re-injects exactly the sources it owns, as explicit `--extension` flags
(`bin/skill-pi.js:198-208`):

- **Bundled** — `<skill-pi>/extensions`: `ask-user.ts` (top-level `*.ts`) plus
  subpackage dirs `file-search/`, `permission/`, `skill-pi-tui/` (each resolved via
  its `package.json` `pi.extensions` manifest, else `index.ts`/`index.js` —
  `resolveDirEntryPoints()`, `bin/skill-pi.js:17`).
- **User** — `~/.skill-pi/agent/extensions/`, enumerated the same way.

Each extension imports from `@earendil-works/pi-coding-agent` and registers tools
(e.g. `ask-user` → the `ask_user` tool; `file-search` → `fd`/`rg`; `permission` →
allow/deny/ask gate) or TUI surface. `file-search` and (per ADR-0004) the extension
packages are also published standalone under the `@devopstales` scope. See ADR-0001
(extension loading via dir manifest), ADR-0004 (extensions as separately published
packages), ADR-0007 (self-contained extensions) in § LOCKED.

## 11. Configuration & Feature Flags

- **Precedence:** CLI flag (`--agent-dir`) > env (`$SKILL_PI_AGENT_DIR`) > default
  (`~/.skill-pi/agent`). pi-level config is the `<agent-dir>/settings.json` +
  `<project>/.skill-pi` config, read by pi.
- **Main config:** the wrapper has no config file of its own; it seeds
  `<agent-dir>/settings.json` (default keys: `quietStartup`, `collapseChangelog`,
  `showHardwareCursor`, `packages`) and `<agent-dir>/auth.json` on first run
  (`lib/config.js:49`). The brand overlay's `piConfig` (`name`, `configDir`) is the
  one piece the wrapper writes authoritatively (`lib/brand.js:38`).
- **Feature flags:** none at the wrapper level. Per-extension behavior (e.g.
  `permission` auto-accept, `file-search` binary fallback) lives inside each
  extension and its `conf.d/` persistence.

## 12. Workflow / Pipeline (if any)

_(none — skill-pi is a binary, not a staged pipeline. The Skillgrid SDD pipeline in
this repo is a meta-workflow for developing skill-pi itself, not part of the shipped
artifact.)_

## 13. Enforcement & Quality Gates (tests, hooks, lint)

| Gate | Enforced by | Fails on |
|---|---|---|
| Tests | `node --test "test/**/*.test.js"` (package.json `test`; `Taskfile.yml` `task test`) | any failing test |
| Publish | `Taskfile.yml` `task publish` (deps: `test`; preconditions: `//npm.pkg.github.com/:_authToken` present) | missing auth token or failing tests |
| Lint / typecheck | not configured at the wrapper level (extensions carry their own `tsc --noEmit` + vitest in their subpackage `package.json`) | — |

No git hooks are committed in this repo. CI is `<detect: confirm any .github/workflows>`.

## 14. Error Handling & Degradation

- **Error convention:** the wrapper `fail()`s with `process.exit(2)` on arg errors
  (`bin/skill-pi.js:116`) and exits with pi's spawn status on launch
  (`bin/skill-pi.js:223`). Library functions throw (`importAuth` throws when
  `auth.json` is absent — `lib/auth.js:6`).
- **Degradation floors:** extension loading **fails open** — if a bundled extension
  can't load, pi reports the load error and continues (the error surfaces as a
  "Failed to load extension …" hint). The brand overlay degrades to a minimal
  `{name, piConfig}` package if the real pi `package.json` can't be read
  (`lib/brand.js:39`), and asset symlinks fail silently so missing assets fall back
  to (missing) overlay copies (`lib/brand.js:70`). `ask-user` degrades to an
  "unavailable" tool result in non-dialog modes instead of hanging.

## 15. Security

```
 trust boundary: the wrapper trusts pi's own security; it adds the
 isolation boundary (separate agent dir) and the extension set boundary
 (--no-extensions + explicit enumeration, so nothing auto-discovered leaks in).
```

| Control | Where | Notes |
|---|---|---|
| Isolation | `PI_CODING_AGENT_DIR` → `~/.skill-pi/agent` | stock `~/.pi/agent` never read/written |
| Extension allow-list | `--no-extensions` + explicit `--extension` flags | suppresses package-scope auto-discovery |
| Credentials | `<agent-dir>/auth.json`, `models.json` | separate from stock pi; imported via `--import-auth` |
| Secret scan (QA) | `.skillgrid/config.yaml` → `security.trivy` (`trivy fs`, `CRITICAL`, `vuln,secret,misconfig`, fail on `CRITICAL`) | enforced at the Skillgrid QA gate, not in CI |

## 16. Testing Strategy

- **Runner:** `node --test "test/**/*.test.js"` (package.json `test`; `Taskfile.yml`).
- **Layers:** unit + integration + E2E, all in `test/`:
  `ask-user.test.js`, `brand.test.js`, `config.test.js`, `integration.test.js`
  (integration: spawns the real wrapper), `rpc.test.js` (integration: pi RPC mode),
  `ask-user-e2e.test.js` (E2E: TUI harness).
- **Coverage:** not measured at the wrapper level (`.skillgrid/config.yaml` has
  `coverage_min: 0`, `mutation_min: 0`). Extension subpackages run `vitest` + `tsc
  --noEmit` independently (`task`/`check` in each `package.json`).

## 17. Known Gaps & TODOs

- **No `defaults/` or `skills/` dirs** exist in the repo, though `package.json`
  `files` and the README reference them — seeding for them is a no-op today.
- **`task build`** (set as `commands.build` in `.skillgrid/config.yaml`) is not a
  defined Taskfile task (`Taskfile.yml` has no `build` target) — there is no build
  step; the wrapper is pure JS + TS extensions.
- **No lint/format/typecheck** at the wrapper level (`commands.lint/format/typecheck`
  are empty in config); only the extension subpackages typecheck.
- **No CI workflow** was detected at the repo root (`.github/workflows` not present).
- **`skillgrid` CLI has no `init` subcommand** (v1.0.0-1059: only `install`,
  `sync-repo`, `help`) — `ARCHITECTURE.md` was hand-scaffolded from the onboarding
  template rather than generated by `skillgrid init`.
- **Test suite currently red on this machine** (2026-10-14): `integration.test.js`
  and `rpc.test.js` fail to spawn pi because bundled-extension deps are missing from
  `node_modules` (`effect/dist/encoding.js`, `web-tree-sitter` — likely a stale
  install; run `npm ci`), and `ask-user-e2e.test.js` hangs past 60s. Not an
  onboarding change — flagging so the next session verifies the test gate.
