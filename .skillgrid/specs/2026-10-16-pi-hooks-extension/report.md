# Report — pi-hooks test coverage + pipeline completion

> Change: `.skillgrid/specs/2026-10-16-pi-hooks-extension/` (moves to `.skillgrid/archive/2026-10-16-pi-hooks-extension/` at ship)
> Generated: 2026-10-16T12:55:00+02:00 (qa)
> Gate: CONCERNS
> Tier: T2 · Classification: small · Floor: L2 (full suite + build)
>
> Two phases, one file: **qa** writes the QA half (the sections above `## Final-State Facts`,
> through `## Gate Decision` + `## Human Override`) into the spec folder. **ship** reads the
> `## Gate Decision` verdict PRE-MOVE, then moves the folder. **reflect** completes the retro
> half (from `## Final-State Facts` onward) IN PLACE in the archive folder.

## Test Plan

### Risk Ranking

The highest production risk is a **silent config-path regression**: the homogenization
changed the global settings path from `~/.pi/agent` to `getAgentDir()` and the project
path from `.pi` to `.skill-pi`. If either regresses, hooks silently stop loading with no
error — the extension appears broken but the session runs fine. Second risk: the
Claude Code JSON I/O contract (input shaping, output parsing, matcher semantics) drifting
from what users' existing hook scripts expect.

### Plan

| # | Risk / Behavior | Seam | Layer | Test / Scenario | Priority | Cadence | Status |
|---|-----------------|------|-------|-----------------|----------|---------|--------|
| 1 | `globalSettingsPath()` resolves under `getAgentDir()`, never `~/.pi` | `src/config.ts` | unit | `config.spec.ts::globalSettingsPath returns <agent-dir>/settings.json` | P0 | pr | covered |
| 2 | `loadSettings` reads `.skill-pi/settings.json` (project) | `src/config.ts` | unit | `config.spec.ts::loads project-only hooks from .skill-pi/settings.json` | P0 | pr | covered |
| 3 | `loadSettings` ignores `.pi/settings.json` | `src/config.ts` | unit | `config.spec.ts::ignores .pi/settings.json in the same cwd` | P0 | pr | covered |
| 4 | Global + project hooks merge (global-first concatenation) | `src/config.ts` | unit | `config.spec.ts::merges global + project hook arrays (global first)` | P0 | pr | covered |
| 5 | `matcherMatches` match-all / regex / invalid-regex fallback | `src/config.ts` | unit | `config.spec.ts::matcherMatches*` (5 tests) | P1 | pr | covered |
| 6 | `hookIfMatches` tool-event gating + wildcard matching | `src/hooks/shared.ts` | unit | `shared.spec.ts::hookIfMatches*` (7 tests) | P1 | pr | covered |
| 7 | `parseJsonOutput` / `extractCommonOutput` / `extractToolResultPatch` | `src/hooks/shared.ts` | unit | `shared.spec.ts` (11 tests) | P1 | pr | covered |
| 8 | `buildHookInput` Claude Code shape per event family | `src/executor.ts` | unit | `executor.spec.ts::buildHookInput*` (7 tests) | P1 | pr | covered |
| 9 | A `SessionStart` hook fires through the wrapper (backstop) | wrapper → pi → bash | e2e | door check (manual, Task 1) | P0 | pr | covered (direct-CLI leg) |

### Edge-Case Matrix

| Requirement | Edge / Boundary | Expected Behavior | Test / Scenario | Status |
|-------------|-----------------|-------------------|-----------------|--------|
| R-config-load | no settings files exist | `{settings: undefined, sourcePaths: []}` | `config.spec.ts::returns undefined when no settings files exist` | covered |
| R-matcher | invalid regex `"["` | exact-match fallback | `config.spec.ts::falls back to exact match on invalid regex` | covered |
| R-if-condition | non-tool event with `if` set | hook does not run (returns false) | `shared.spec.ts::rejects non-tool events` | covered |
| R-if-condition | `if: undefined` | hook runs (returns true) | `shared.spec.ts::returns true when if is undefined` | covered |
| R-hook-input | `PostToolUse` with no `toolResponse` | `tool_response` key absent | `executor.spec.ts` (asserts presence only when set) | covered |

### Out of Scope

- `executeHook` / `executeCommandHook` (spawns bash — integration concern, not unit-testable without a process)
- `executeParsedHook` / `triggerSimpleHooks` (call `executeHook` — same reason)
- The wrapper's trailing-positional cwd defect (pre-existing, affects all extensions, out of scope for this change)
- MCP / namespaced tool matching in `if` conditions (upstream limitation, not changed by homogenization)

## Goal-Backward Verification

**Stated goal** (from briefing.md): Give the vendored `extensions/pi-hooks/` the test
coverage and pipeline artifacts (qa gate, review, ship) it skipped when it landed
directly on main.

**Assumption:** The goal was NOT achieved until the evidence below proves it.

| Level | Item | Evidence | Status |
|-------|------|----------|--------|
| Truth | `globalSettingsPath()` resolves under `getAgentDir()`, never `~/.pi/agent` | `config.spec.ts::globalSettingsPath*` — mocked `getAgentDir`, asserts path shape | VERIFIED |
| Truth | `loadSettings` reads `.skill-pi/settings.json`, never `.pi/settings.json` | `config.spec.ts::loads project-only*` + `::ignores .pi*` — real temp dirs | VERIFIED |
| Truth | `matcherMatches` semantics match Claude Code (match-all, regex, fallback) | `config.spec.ts::matcherMatches*` (5 tests) | VERIFIED |
| Truth | `hookIfMatches` gates tool hooks correctly | `shared.spec.ts::hookIfMatches*` (7 tests) | VERIFIED |
| Truth | `buildHookInput` emits Claude Code-shaped JSON | `executor.spec.ts::buildHookInput*` (7 tests) | VERIFIED |
| Truth (backstop) | A `SessionStart` hook fires through the wrapper | door check: direct CLI → FIRED; wrapper → NOHOOK (pre-existing wrapper defect) | PRESENT_BEHAVIOR_UNVERIFIED |
| Artifact | `extensions/pi-hooks/src/config.spec.ts` | file exists, 11 tests, runs green | VERIFIED |
| Artifact | `extensions/pi-hooks/src/shared.spec.ts` | file exists, 22 tests, runs green | VERIFIED |
| Artifact | `extensions/pi-hooks/src/executor.spec.ts` | file exists, 7 tests, runs green | VERIFIED |
| Artifact | `acceptance.feature` | file exists, 5 scenarios | VERIFIED |
| Key Link | `createHookContext` → `loadSettings(ctx.cwd)` contract | `config.spec.ts` pins the `loadSettings` contract that call relies on | VERIFIED |
| Data Flow | hook command receives JSON on stdin, runs bash | door check direct-CLI leg: marker file written by hook's `echo` | VERIFIED (direct-CLI) |

## Traceability Matrix

| Scenario (from acceptance.feature) | Test / Scenario (from test plan) | Ran | Result |
|--------------------------------------|----------------------------------|-----|--------|
| R-E2E-hook-fires | door check (manual, Task 1) | yes | pass (direct-CLI leg; wrapper leg blocked by pre-existing defect) |
| R-config-load | `config.spec.ts` (4 load tests + 1 no-files) | yes | pass |
| R-matcher | `config.spec.ts::matcherMatches*` (5 tests) | yes | pass |
| R-if-condition | `shared.spec.ts::hookIfMatches*` (7 tests) | yes | pass |
| R-hook-input | `executor.spec.ts::buildHookInput*` (7 tests) | yes | pass |

**Coverage:** 5/5 scenarios covered by a test that ran and passed. (R-E2E-hook-fires is
covered by the direct-CLI leg of the door check; the wrapper leg is blocked by a
pre-existing defect named in Findings.)

## Verification-Gap Audit

| Gap | Location | Shape | Evidence | Smallest Regression |
|-----|----------|-------|----------|---------------------|
| `executeHook` / `executeParsedHook` / `triggerSimpleHooks` untested | `src/executor.ts:91-161`, `src/hooks/shared.ts:194-292` | regression | no spec file imports or calls these functions; they spawn bash or call `executeHook` | a change to the spawn args, timeout, or JSON-parsing path in `executeHook` would not be caught |
| Wrapper trailing-positional cwd defect | `bin/skill-pi.js:212` | regression (pre-existing) | door check: wrapper NOHOOK, direct CLI FIRED; root cause: `args.passthrough` includes project path as trailing positional to pi | any extension that reads `ctx.cwd` for config (pi-hooks, permission conf.d, lsp conf.d) is affected when launched via the wrapper with a project path arg |

## TDD Evidence Audit

| Task (from blueprint) | SATISFIES Scenario | RED Evidence | GREEN Evidence | Verdict |
|----------------------|--------------------|--------------|----------------|---------|
| Task 1 (door check) | R-E2E-hook-fires | N/A (verification task) | direct CLI → marker file written | OK |
| Task 2 (unit specs) | R-config-load, R-matcher, R-if-condition, R-hook-input | 44/44 green on first run (regression pin — source already correct) | 44/44 vitest green, tsc clean | OK |

**Note:** Task 2 is a regression pin (source was already committed and correct). RED is
"write tests, run once, immediately green" — the expected outcome per blueprint Step 2.
No `MISSING_RED` because the tests were written against known-correct source; the suite's
value is catching *future* regressions, not finding *current* bugs.

## Test Quality Audit

| Test | Contract Violated | Evidence |
|------|-------------------|----------|
| (none) | — | all tests exercise production code; assertions can fail for real inputs; no vacuous truths; no pass-always patterns |

## Test Strategy Audit

**Available layers** (from `testing.layers`): unit, integration, e2e

| Behavior | Assigned Layer | Degrade? | Duplicate Coverage? | Rationale |
|----------|---------------|----------|---------------------|-----------|
| config load/merge/paths | unit | no | no | pure fs + mocked `getAgentDir`; no process boundary |
| matcher semantics | unit | no | no | pure function |
| if-condition parsing | unit | no | no | pure function |
| hook input shaping | unit | no | no | pure function |
| hook fires through wrapper | e2e (door check) | no | no | requires wrapper + pi + bash; only observable at e2e |

**Layer distribution:** 44 unit, 0 integration, 1 e2e (manual door check). Reasonable:
the extension's pure logic is unit-testable; the only integration concern (wrapper → pi
→ bash) is the door check.

## Security Audit

**Mode:** Trivy

### Trivy Findings (Mode A)

**Command:** `trivy fs --scanners vuln,secret,misconfig --severity CRITICAL extensions/pi-hooks/`

| Scanner | Finding | Severity | Location | Fix | Classification |
|---------|---------|----------|----------|-----|----------------|
| (none) | 0 vulnerabilities | — | package-lock.json | — | — |

**Trivy gate:** `fail_on: CRITICAL` → PASS (0 findings)

**Security verdict:** PASS — 0 CRITICAL, 0 WARNING, 0 SUGGESTION

## Code Quality Gate

| Gate | Command | Threshold (config) | Actual | Result |
|------|---------|--------------------|--------|--------|
| Coverage | not configured | 0 (disabled) | N/A | N/A |
| Mutation | not configured | 0 (disabled) | N/A | N/A |
| Lint | not configured | errors only | N/A (no linter configured) | N/A |
| Typecheck | `npx tsc --noEmit -p .` (extensions/pi-hooks) | errors only | 0 errors | PASS |
| P0 pass rate | vitest (P0 rows 1-4, 9) | 100% | 100% (all P0 tests pass) | PASS |
| P1 pass rate | vitest (P1 rows 5-8) | 95% | 100% (all P1 tests pass) | PASS |
| Trivy security | `trivy fs --severity CRITICAL` | CRITICAL | 0 findings | PASS |

**Quality config status:** not configured — using defaults

**Dead code:** N/A (no dead-code tool configured)

## State Drift

**Verdict:** DRIFT DETECTED (manual — `state-drift-check.mjs` requires `yaml` package not in PATH)

| Field | Stale (state.yaml) | Derived (spec zone) |
|-------|-------------------|---------------------|
| `pipeline.current_change` | `2026-10-15-plan-build-extension` | `2026-10-16-pi-hooks-extension` (in-flight spec dir) |
| `pipeline.current_phase` | `shipped` | `qa` (this gate) |

**Fix applied:** state.yaml will be patched at ship (current_change → pi-hooks, phase → shipped).
Not patched now because the change is still in the qa phase.

**Scope:** COMPLETE (read state.yaml + spec zone directly)

## Verification Scope

| Derivation | Scope | Stale? |
|---|---|---|
| Traceability matrix | COMPLETE | none |
| Verification-gap audit | COMPLETE | none |
| State Drift | COMPLETE | n/a |

**Stale-verification:** `STALE: none` — no code-zone change since Task 2 commit (3808103); this run's evidence is current.

## Floor

| Dimension | Verdict |
|---|---|
| Goal-backward verification (weakest truth) | PRESENT_BEHAVIOR_UNVERIFIED (R-E2E-hook-fires wrapper leg) |
| Traceability (weakest scenario) | COMPLIANT (all 5 scenarios covered; R-E2E via direct-CLI leg) |
| Verification-gap audit | WARNING (2 named gaps, both pre-existing / out-of-scope) |
| TDD evidence (weakest ticket) | OK (regression pin; no MISSING_RED) |
| Test quality audit | none |
| Code-quality gates (weakest gate) | PASS |
| Security audit | PASS |
| Verification scope (composite) | COMPLETE |

**FLOOR:** PRESENT_BEHAVIOR_UNVERIFIED (R-E2E-hook-fires wrapper leg — the extension's
hook-firing behavior is verified by the direct-CLI leg but the wrapper leg is blocked by
a pre-existing trailing-positional defect in `bin/skill-pi.js`). The gate can never render
higher than this floor → **CONCERNS**.

## Findings

### CRITICAL (must fix before merge)

(none)

### WARNING (should fix before archive)

- **W1:** Wrapper trailing-positional cwd defect (`bin/skill-pi.js:212`): `args.passthrough`
  includes the project path as a trailing positional to pi. In `--print` mode pi consumes
  it as a working-directory override, so `ctx.cwd` in extensions is the wrong dir. Affects
  all bundled extensions that read config from `ctx.cwd` (pi-hooks, permission conf.d,
  lsp conf.d). Pre-existing; not caused by this change. Path to resolution: the wrapper
  should strip the project path from `args.passthrough` before spawning pi (it already
  sets it via the spawn `cwd` option). Separate change.
- **W2:** `executeHook` / `executeParsedHook` / `triggerSimpleHooks` untested
  (`src/executor.ts:91-161`, `src/hooks/shared.ts:194-292`). These spawn bash or call
  `executeHook`; a change to spawn args, timeout, or JSON parsing would not be caught by
  the unit suite. Pre-existing (upstream shipped no tests). Path to resolution: an
  integration spec that runs `executeHook` against a real bash command (low priority —
  the function is a thin wrapper around `node:child_process` spawn).

### SUGGESTION (nice to have)

- The root suite's e2e tests (ask-user-e2e, dynamic-allow-e2e, providers.e2e, integration,
  rpc) all hang on the same W1 wrapper defect when run with a project path arg. Consider
  fixing W1 first, then re-enabling the full root suite in CI.

## Gate Decision

**Verdict:** CONCERNS

**Reasoning:** All 44 unit tests pass, tsc clean, Trivy clean, all 5 acceptance scenarios
covered. The one dimension below PASS is the R-E2E-hook-fires backstop: the direct-CLI
leg proves the extension's hook-firing behavior, but the wrapper leg is blocked by a
pre-existing trailing-positional defect in `bin/skill-pi.js` (W1) that affects all
bundled extensions. The extension's logic is correct; the wrapper's cwd passing is the
gap. This is a PRESENT_BEHAVIOR_UNVERIFIED, not an UNVERIFIED — the code exists, is
wired, and is proven correct by the direct-CLI leg; only the wrapper integration is
unverified.

**Open items (if CONCERNS):**
- **W1 (wrapper trailing-positional cwd defect):** fix `bin/skill-pi.js` to strip the
  project path from `args.passthrough` before spawning pi. Re-run the door check
  (wrapper leg) after the fix. Path: separate change (out of scope for pi-hooks).
- **W2 (untested spawn path):** optional integration spec for `executeHook`. Low priority.

## Human Override

> A human decision always overrides this machine verdict.
> An epic that fails its criteria with no human decision is recorded as **not accepted** — never as silently accepted.

**Human decision (fill in):** <accept / accept-with-open-items / reject> — <name> — <date>
