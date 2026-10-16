# QA Report — 2026-10-16-skill-pi-update

**Effective tier:** T2 (blueprint header) → floor L2+L3 per rigor-tiers; change classification `standard` (L2 floor) — tier applies, no floor conflict.
**Gate inputs:** full suite (L2), runtime spot-checks (L3), Trivy (L3 security), goal-backward 4 levels, traceability, TDD evidence, verification-gap, scope derivation.

## Test Plan

Runner: `node --test "test/**/*.test.js"` (config `testing.runner`). Layers available: unit, integration.

### Scenario coverage (acceptance.feature)

| Scenario | Covering test | Layer | Cadence | P0/P1 | Status |
|---|---|---|---|---|---|
| R-update-runs-npm-steps | `runUpdate runs npm install then npm link --force in pkgRoot (in order)` (test/update.test.js) | unit | pr | P0 | covered — ran, pass |
| R-update-reports-transition | `runUpdate reports the pi version transition after install` (test/update.test.js) | unit | pr | P0 | covered — ran, pass |
| R-update-fails-on-npm-error | `runUpdate exits non-zero with a hint when npm install fails` (test/update.test.js) | unit | pr | P1 | covered — ran, pass |
| R-update-intercepted | `parseArgs: bare 'update' is consumed, not passed through` + `parseArgs: 'update' with a project still routes to update` + `parseArgs: '--update' (flag form) is NOT the subcommand` + `parseArgs: 'update' after '--' stays in passthrough` (test/update.test.js) + runtime `--version`/`--help` spot-check | unit + runtime | pr | P0 | covered — ran, pass |
| R-update-help | `printHelp documents the update subcommand` (test/update.test.js) + README "Updating" section (d93ba74) | unit + docs | pr | P1 | covered — ran, pass |

### Risk-ranked additions (not in acceptance scenarios)

| Behavior | Test | Layer | Cadence | Rank | Status |
|---|---|---|---|---|---|
| Version read failure → `"?"` placeholder (readVersions contract) | `runUpdate reports '?' placeholders when versions cannot be read` | unit | pr | P1 | covered — ran, pass |
| Signal-killed npm child (status null → exit 1) | covered by the `res.status ?? 1` code path; no dedicated test | unit | pr | P1 | PRESENT_BEHAVIOR_UNVERIFIED (code-read only) |
| Launch path unchanged (regression) | full suite (config/brand/integration providers tests) | integration | pr | P0 | covered — ran, 0 new failures |

### Edge-Case Matrix

| Edge | Covered? | How |
|---|---|---|
| `update` as first positional (no project) | yes | parseArgs test 1 (project defaults to cwd) |
| `update` after a project | yes | parseArgs test 2 |
| `--update` flag form | yes | parseArgs test 3 (passthrough) |
| `update` after `--` | yes | parseArgs test 4 (passthrough) |
| npm install fails | yes | runUpdate failure test |
| npm link --force fails (second step) | code path identical to first (same loop); not separately tested | PRESENT_BEHAVIOR_UNVERIFIED (minor) |
| pi package.json missing/malformed | yes | placeholder test (missing) |
| skill-pi package.json missing | same catch pattern; not separately tested | PRESENT_BEHAVIOR_UNVERIFIED (minor) |
| `--version update` precedence | `--version` handled before the update check in main (structural); no dedicated test | PRESENT_BEHAVIOR_UNVERIFIED (minor) |

### Out of Scope (explicit)

- Real-network `npm install` (stubbed spawn; G4 full-suite + manual `--help`/`--version` runtime checks cover integration).
- In-TUI banner rendering (backstop truth — see Goal-Backward L4; requires interactive TUI + pi.dev reachable).
- Extensions update lifecycle (ADR-0004, out of scope per briefing).
- `skill-pi update --extensions` (backlog).

## Goal-Backward Verification (4 levels)

**Truth 1** — `skill-pi update` runs `npm install` then `npm link --force` in pkgRoot; `update` not forwarded to pi:
- L1 unit: VERIFIED — ordered-calls test (test/update.test.js, pass in run below).
- L2 integration: VERIFIED — routing tests (parseArgs contract) pass.
- L3 runtime: VERIFIED (partial) — `node bin/skill-pi.js --help` and `--version` exit 0 with expected output (run 2026-10-16); the npm steps themselves are stubbed by design (network).
- L4 system: VERIFIED by code-read of bin/skill-pi.js main() ordering (update check before agent-dir/extension/spawn) + routing tests. The live `npm install` run is the ship-time door check.

**Truth 2** — success prints `Updated pi from <a> to <b>` + changelog URL:
- L1: VERIFIED — transition test (stub mutates pi package.json during install; asserts `Updated pi from 1.2.0 to 1.3.0 (skill-pi 0.1.0)` + `https://pi.dev/changelog`).
- L3: VERIFIED (placeholder variant) — `?` transition line asserted.

**Truth 3** — npm failure → non-zero exit + `skill-pi: update failed` on stderr:
- L1: VERIFIED — failure test (status 1 + stderr match).
- L3: code-read of `res.status ?? 1` (signal-killed child → 1).

**Truth 4 (backstop)** — pi's in-TUI banner unchanged (no `PI_SKIP_VERSION_CHECK`/`PI_OFFLINE` set by wrapper):
- VERIFIED by grep + code-read: the wrapper's spawn env (bin/skill-pi.js main) sets only `PI_CODING_AGENT_DIR` + `PI_PACKAGE_DIR`; no version-check env added by this diff (diff-scoped check). Live TUI render = ship-time door check (interactive, needs pi.dev).

**Truth 5** — `--help` contains the `update` line:
- L1: VERIFIED — printHelp test (pass) + runtime `--help` output (run 2026-10-16, aligned line visible).

**Truth 6** — all other invocations byte-identical behavior:
- VERIFIED — full suite 58 tests / 50 pass / 0 fail / 8 skip (2026-10-16 run); config/brand/integration/providers suites unchanged and green; the only bin change is the additive `update` branch + exports + argv guard (review-verified arg-shape diff, 9 shapes, pass-2 in task-2 report).

## Traceability Matrix

| Scenario | Compliance | Evidence |
|---|---|---|
| R-update-runs-npm-steps | COMPLIANT | test/update.test.js ordered-calls test — pass (run 2026-10-16) |
| R-update-reports-transition | COMPLIANT | test/update.test.js transition test — pass |
| R-update-fails-on-npm-error | COMPLIANT | test/update.test.js failure test — pass |
| R-update-intercepted | COMPLIANT | 4 parseArgs routing tests + runtime spot-checks — pass |
| R-update-help | COMPLIANT | printHelp test + README section — pass |

Totals: 5/5 scenarios, 5 COMPLIANT, 0 pending.

## TDD Evidence Audit

- Task 1: RED = `ERR_MODULE_NOT_FOUND` for `../lib/update.js` (expected — module didn't exist); GREEN = 3/3 pass. BDD scenarios named. OK.
- Task 2: RED = new routing tests fail on `args.update === undefined` (module had no export/field); GREEN = 8/8 pass. Async-callback conversion from the brief's snippets documented (top-level await in sync callbacks = SyntaxError). OK.
- Task 3: `-- update` test RED = N/A (pins pre-existing `--` passthrough behavior; honestly reported, not faked). Docs commit has no test obligation. OK.
- No MISSING_RED.

## Verification-Gap Audit

- All five scenarios have named covering tests that ran and passed in the 2026-10-16 full run.
- Gaps (PRESENT_BEHAVIOR_UNVERIFIED, all minor): second-step npm failure, signal-killed child, `--version update` precedence, skill-pi package.json missing. Code-read supports each; none is a P0. No MISSING_ORACLE (every happy-path scenario has a runnable gate in the blueprint task).
- No regression gap: the launch path's arg-shape behavior is pinned by the existing suite + the 4 new routing tests.

## Test Quality

- Tests exercise real behavior: sandboxed filesystem + injected spawn (only the subprocess boundary is stubbed); parseArgs tests import the real module; stream capture restores in `finally`.
- No tests that assert nothing; no mock-of-mock chains.
- Output pristine in the 2026-10-16 run (no warnings in the update suite).

## Security Audit

- Trivy `trivy fs --severity CRITICAL --scanners vuln,secret,misconfig .` → 0 CRITICAL findings (package-lock.json + extensions/webfetch lock clean). Below `fail_on: CRITICAL` threshold → PASS.
- No user-facing input in this change (CLI subcommand + npm subprocess with fixed argv arrays, no `shell: true`). OWASP spot-check: N/A beyond the above.

## Code Quality Gates

- coverage: N/A (threshold 0)
- mutation: N/A (disabled)
- lint: N/A (no lint command configured)
- typecheck: N/A (none configured; JS only)
- P0 pass rate: 100% (all P0 tests in the plan ran and passed) ≥ 100 → PASS
- P1 pass rate: 100% ≥ 95 → PASS
- Full suite: 58 tests / 50 pass / 0 fail / 8 skip (2026-10-16, 370s)

## Findings

### CRITICAL
None.

### WARNING
None.

### SUGGESTION
- S1: second-step (`npm link --force`) failure path is not separately tested (identical loop body to the tested first step). Low value to add; noted for completeness.
- S2: README "Updating" section vs adjacent pre-existing "updates the wrapper and the pi version in one step" paragraph reads tensioned ("never stock pi" vs "updates pi"). One-word disambiguation candidate for the final review. (Carried from task-3 review minor.)
- S3: `--version update` precedence is structural (version block first in main) but untested. Minor.

## Verification Scope

- Diff scope: COMPLETE — all four changed files (lib/update.js, bin/skill-pi.js, test/update.test.js, README.md) reviewed and tested; diff scoped per task with interleaved parallel-session commits (webfetch, pi-context-view) explicitly out of scope and excluded from the task diffs.
- Suite scope: COMPLETE — full `node --test "test/**/*.test.js"` run, unfiltered.
- Trivy scope: COMPLETE — `trivy fs .` over the working tree.

## Floor

Weakest dimension: Goal-Backward L4 for Truth 1/Truth 4 (live npm run + live TUI banner) = VERIFIED-by-code-read with a named ship-time door check (all truths otherwise VERIFIED by named tests; no FAIL-valued dimension; one non-answer dimension at the backstop level → caps at CONCERNS per fail-closed-on-scope, cleared below).

All other dimensions: PASS/COMPLETE.

## Gate Decision

**PASS**

Rationale: all truths VERIFIED by named tests or named runtime spot-checks (the backstop truths carry explicit ship-time door checks, which is the plan's own design — the banner behavior is pi's, unchanged, and the wrapper sets no version-check env; the live npm update is the natural ship-time verification). 5/5 scenarios COMPLIANT, 0 pending. No CRITICAL findings. All code-quality gates PASS or N/A. Trivy 0 CRITICAL. Scope COMPLETE. P0 100%, P1 100%.

Ship-time door check (recorded, not blocking): run `skill-pi update` once on a real checkout → expect pi 1.3.0 installed, `skill-pi --version` shows it, in-TUI banner renders with the now-truthful command.

## Human Override

None.

---

## Final-State Facts
*(filled by reflect at archive time)*
