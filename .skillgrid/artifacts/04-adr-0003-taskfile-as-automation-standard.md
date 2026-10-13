# Taskfile.yml as the automation standard for build/install/test/pack/publish

---
status: "accepted"
date: 2026-10-13
supersedes: none
---

- SDD change: none yet (pre-propose decision; candidate change `003-…`)
- Artifact: `Taskfile.yml` (root)

## Context

skill-pi needs a single, discoverable entry point for the lifecycle operations of the
wrapper: installing the tool (for development), running tests, packaging, and
publishing to npm. Without a standard, these operations live in `package.json`
scripts, ad-hoc shell commands, and README prose that drift apart. This ADR pins
`go-task` (`Taskfile.yml`) as that standard.

## Decision

**`Taskfile.yml` at the repo root is the single canonical entry point for
build/install/clean/test/pack/publish.** `package.json` `scripts` remain only as
minimal npm-lifecycle shims (e.g. `test`, so `npm test` / CI work without task); every
other lifecycle operation is a task.

Task surface (current `Taskfile.yml`):

| Task | Purpose |
|---|---|
| `install` | `npm ci` → version check → `npm link` (global dev install) → report agent/work dirs |
| `uninstall` | `npm unlink`/`uninstall -g skill-pi`; `--force` also wipes `~/.skill-pi/{agent,work}` |
| `clean` | `rm -rf node_modules .pi` |
| `test` | `node --test "test/**/*.test.js"` (same command as `npm test`) |
| `pack` | `npm pack` (inspectable `.tgz`) |
| `publish` | `deps: [test]` + auth precondition → `npm publish` with whitelisted pass-through args (`--dry-run`, `--access [value]`) |
| `all` | clean → install → test |

Conventions:

- **Declarative deps over ordering:** `publish` declares `deps: [test]`; tasks that
  compose other tasks use `cmds: [task: …]` rather than inlining their commands.
- **Idempotence via `status`:** `install` and `clean` carry `status:` checks so
  re-runs are no-ops when already satisfied.
- **Env-aware vars:** `AGENT_DIR` / `WORK_DIR` default to
  `${SKILL_PI_AGENT_DIR:-$HOME/.skill-pi/agent}` /
  `${SKILL_PI_WORK_DIR:-$HOME/.skill-pi/work}` — the *same* resolution as
  `lib/config.js` / `lib/shim.js`, so task output and runtime agree.
- **Destructive operations are explicit and gated:** only `uninstall --force` deletes
  user state; it is not a dep of anything else.
- **Publish is safe by default:** requires an npm auth token (precondition, not a
  silent failure) and forwards only whitelisted flags, so `task publish -- extra-args`
  cannot inject arbitrary npm flags.

## Alternatives considered

- **`package.json` scripts only** — npm-native, zero extra tooling, but no
  `status`-based idempotence, no first-class deps graph, weak precondition support,
  and awkward cross-platform quoting; rejected as the *primary* surface (kept as
  shims).
- **Makefile** — ubiquitous, but the project is JS/Node; duplicating the toolchain in
  Make and the runtime in Node is a split brain. Make's shell-quoting quirks and
  implicit targets make the deps graph harder to read than task's.
- **Just (`justfile`)** — modern and clean; close alternative, rejected for
  consistency with the already-committed `Taskfile.yml` and its `status`/`preconditions`
  model, which maps directly onto idempotent install/publish.
- **CI-only automation (GitHub Actions doing everything)** — CI is for the *remote*
  pipeline; developers still need a local, documented, repeatable entry point.

## Consequences

- `go-task` is a required dev tool for contributors (documented in README/AGENTS).
- New lifecycle operations (e.g. `release`, `docs`, `lint`) are added as tasks, not
  scripts; if an npm lifecycle must call one, the script delegates to `task`.
- README "Install" / "Upgrading" sections reference `task` commands as the canonical
  workflow (candidate change `003` updates the README accordingly).
- `Taskfile.yml` is a dev artifact: it is **not** in the npm `files` allowlist, so it
  ships in git only, not in the published package.
- CI (when added) invokes the same tasks (`task test`, `task pack`) so local and
  remote pipelines cannot drift. No CI workflow exists in the repo yet — out of scope
  for this decision.

## Follow-up

- Candidate SDD change `003-taskfile-readme-alignment`: document the task surface in
  README, add a `test` script parity check, and (optionally) a CI workflow that runs
  `task test` + `task pack`.
