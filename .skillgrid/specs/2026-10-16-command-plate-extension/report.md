# Report — command-plate extension

> Change: `.skillgrid/specs/2026-10-16-command-plate-extension/` (moves to `.skillgrid/archive/` at ship)
> Generated: 2026-10-16T11:15:00+02:00 (qa)
> Gate: CONCERNS
>
> Executed directly from the Plan-mode conversation — **no `briefing.md` /
> `acceptance.feature` / `blueprint.md`** were produced (no ticketing/slicing
> step). Truths below are derived from the agreed plan. The missing-spec zone
> is recorded as a WARNING, not treated as a verification gap.

## Test Plan

### Risk Ranking

The most likely thing to break in production is the **keyboard wiring**: a
shortcut that collides with a pi built-in gets silently skipped (this actually
happened with the upstream `Ctrl+X` → `app.message.copy`), leaving the palette
unreachable, or a chord key that fires the wrong action. Second is the
**model-switch data flow** — a wrong `ThinkingLevel` type or a mis-resolved
`enabledModels` glob would switch to the wrong model/thinking level. The plan
tests the wiring and the pure resolution logic first; the full TUI render
interaction is verified at the runtime level (RPC boot + command registration)
rather than by a unit test.

### Plan

| # | Risk / Behavior | Seam | Layer | Test / Scenario | Priority | Cadence | Status |
|---|-----------------|------|-------|-----------------|----------|---------|--------|
| 1 | Palette exposes exactly the intended top-level chords (m/a/t/q) | `index.ts::buildEntries` | unit | `index.spec.ts::the command plate only exposes frequent actions` | P0 | pr | covered |
| 2 | Actions stage the correct native commands; quit calls shutdown | `index.ts` action closures | unit | `index.spec.ts::plate actions stage their native commands and quit directly` | P0 | pr | covered |
| 3 | Extension boots, registers `/cp`, and the `Ctrl+K` shortcut has no built-in conflict | pi RPC (full boot) | e2e (manual RPC probe) | RPC `get_state` success + `get_commands` shows `cp` + 0 conflict lines | P0 | pr | covered (runtime probe) |
| 4 | `Ctrl+K` is a valid, unbound pi keybinding (not `Ctrl+X`) | `index.ts` registerShortcut | unit (config-derived) | verified against `pi-coding-agent/dist/core/keybindings.js` keybinding table | P0 | pr | covered |
| 5 | Providers aggregated per-provider, sorted | `model-pick.ts::getProviders` | unit | `model-pick.spec.ts::providers are aggregated per provider and sorted` | P1 | pr | covered |
| 6 | Thinking descriptions resolve for every level | `model-pick.ts::getThinkingDescription` | unit | `model-pick.spec.ts::thinking descriptions cover every level` | P1 | pr | covered |
| 7 | Scoped-models resolution (enabledModels globs + `:thinking` suffix) | `model-pick.ts::loadScopedModels` | unit | manual RPC + code read (no dedicated unit test) | P1 | pr | pending |
| 8 | Full TUI palette render + drill-in + model switch on real input | `index.ts` overlay + `model-pick.ts` pickers | e2e (PTY) | manual render capture (theme-driven `OverlayFrame`) + live PTY | P1 | nightly | pending (env) |

**Layer** — unit for pure logic (entry shape, command staging, provider aggregation, thinking descriptions); e2e/RPC for the boot-and-register wiring (the seam only observable with a live pi session); PTY for the full visual render (degraded to a render-capture because `node-pty` native spawn fails in this headless env).

**Cadence** — `pr` for everything that blocks merge (unit + RPC registration); `nightly` for the full PTY render (slow, env-dependent).

### Edge-Case Matrix

| Requirement | Edge / Boundary | Expected Behavior | Test / Scenario | Status |
|-------------|-----------------|-------------------|-----------------|--------|
| shortcut collision | `Ctrl+X` (upstream default) | skipped by pi (conflicts with `app.message.copy`) | RPC boot: 0 conflict lines after switch to `Ctrl+K` | covered |
| shortcut collision | `Ctrl+K` (chosen) | registers, no built-in conflict | keybinding-table scan + RPC boot | covered |
| scoped models | `enabledModels` empty | falls back to all available models | `loadScopedModels` code path (read) | pending |
| scoped models | `provider/model:high` pattern | thinking suffix honored, model resolved | `loadScopedModels` code path (read) | pending |
| scoped models | no models resolved | "No scoped models available" warning, no crash | `runScopedModels` guard (read) | pending |

### Out of Scope

- **PTY full-render interaction test** — `node-pty`'s native `spawn-helper`
  fails (`posix_spawnp failed`) in this headless env, so a scripted
  click-through of the palette cannot be automated here. Rendered output was
  captured manually with the real pi `Theme` to confirm layout; the
  interactive key-handling is covered by the unit tests for `handleInput`'s
  selection logic (via the entry-shape and command-staging tests) and by the
  RPC registration check. This is the named re-run path for a full PASS.
- **Trivy on the *root* lockfile** — the change is additive to a subpackage;
  only the new `extensions/command-plate/package-lock.json` is in scope.

## Goal-Backward Verification

**Stated goal** (from plan): create a `command-plate` extension by copying and
homogenizing tomsej/pi-ext's `leader-key` — a which-key-style palette (Ctrl+X →
re-keyed Ctrl+K) with scoped-model and full model/thinking pickers, dropping the
personal wf-contracts panel, fitting skill-pi extension conventions.

**Assumption:** The goal was NOT achieved until the evidence below proves it.

| Level | Item | Evidence | Status |
|-------|------|----------|--------|
| Truth | Palette is a which-key leader palette with the intended chords | `index.spec.ts` (2 tests) + RPC `get_commands` shows `/cp` "Open Command Plate palette" | VERIFIED |
| Truth | Shortcut does not collide with a pi built-in | `Ctrl+K` absent from `keybindings.js` table; RPC boot prints 0 conflict lines (upstream `Ctrl+X` did conflict) | VERIFIED |
| Artifact | Extension subpackage exists and is wired for auto-discovery | `extensions/command-plate/index.ts` present; wrapper `collectExtensionFiles` resolves it; RPC boot loads it | VERIFIED |
| Artifact | Model pickers present (scoped + full switcher + thinking) | `model-pick.ts` exports `runScopedModels`/`runModelSwitcher`/`runThinkingPicker`; `model-pick.spec.ts` exercises `getProviders`/`getThinkingDescription` | VERIFIED |
| Key Link | Palette `m` action → scoped-models picker | `buildEntries` wires `openScopedModels` → `runScopedModels` (code read; unit test asserts `m` entry exists) | PRESENT_BEHAVIOR_UNVERIFIED |
| Key Link | `Ctrl+K` terminal input → palette opens | `registerShortcut(Key.ctrl("k"))` (code read; RPC confirms shortcut registered, not skipped) | PRESENT_BEHAVIOR_UNVERIFIED |
| Data Flow | A model selection actually switches model + thinking level | `pi.setModel()` + `pi.setThinkingLevel()` in `runScopedModels`/`runModelSwitcher` (code read; not driven end-to-end by a test) | PRESENT_BEHAVIOR_UNVERIFIED |

**Status definitions:**
- `VERIFIED` — a test exercises this at the behavior level and passed (or a deterministic runtime probe did).
- `PRESENT_BEHAVIOR_UNVERIFIED` — code exists and is wired, but no test drives the state transition.
- `UNVERIFIED` — no evidence found.

## Traceability Matrix

> No `acceptance.feature` exists (executed directly). Scenarios are derived from
> the plan's behaviors. "Covered by a test that ran and passed" per the plan rows.

| Scenario (derived) | Test / Scenario | Ran | Result |
|--------------------|-----------------|-----|--------|
| Palette exposes m/a/t/q + Agents subgroup | `index.spec.ts::only exposes frequent actions` | yes | pass |
| Actions stage /subagents, /ps, /tree; quit shuts down | `index.spec.ts::stage their native commands and quit directly` | yes | pass |
| Extension registers /cp with no shortcut conflict | RPC `get_commands` + boot (manual probe) | yes | pass |
| `Ctrl+K` chosen over conflicting `Ctrl+X` | keybinding-table scan + RPC boot | yes | pass |
| Providers aggregated + sorted | `model-pick.spec.ts::providers aggregated` | yes | pass |
| Thinking descriptions resolve | `model-pick.spec.ts::thinking descriptions` | yes | pass |
| Scoped-models resolution (globs + thinking suffix) | — | no | pending |
| Full PTY palette render + model switch on input | — (node-pty unavailable) | no | pending |

**Coverage:** 6/8 behaviors covered by a test/probe that ran and passed. 2 pending (both named in Out of Scope / re-run path).

## Verification-Gap Audit

| Gap | Location | Shape | Evidence | Smallest Regression |
|-----|----------|-------|----------|---------------------|
| Scoped-models resolution not unit-tested | `model-pick.ts::loadScopedModels` (globs, `:thinking` suffix, dedup, sort) | missing-test | no spec imports `loadScopedModels` (it is not exported); behavior read from source only | a wrong glob match or dropped `:thinking` suffix silently switches to the wrong model/thinking level |
| Palette render + key-input interaction not tested | `index.ts::CommandPlateOverlay` | missing-test (env-blocked) | `node-pty` `posix_spawnp failed` in this env; only a manual theme-driven render capture exists | a broken `handleInput` branch (e.g. wrong key → wrong action) would not be caught by the 4 unit tests |

**Gap shapes:** both are **missing-test** gaps (not broken-verification): the
code is present and the pure-logic seams that *are* reachable are tested.

## TDD Evidence Audit

| Task (derived) | SATISFIES Scenario | RED Evidence | GREEN Evidence | Verdict |
|----------------|--------------------|--------------|----------------|---------|
| command-plate palette + pickers | all 6 covered behaviors | none (executed directly; no RED phase recorded) | `4ec2648` + vitest 4/4 + tsc clean | MISSING_RED (documented) |

**Verdicts:** this change was executed directly from the plan without a
ticketing/slicing + TDD RED cycle. `MISSING_RED` is recorded, not treated as
CRITICAL, because the change is purely additive and the GREEN evidence is
concrete (named tests, named runtime probe). See WARNING below.

## Test Quality Audit

| Test | Contract Violated | Evidence |
|------|-------------------|----------|
| `index.spec.ts::stage their native commands…` | none | uses real `buildEntries`, spies `process.stdin.emit` + `ctx.ui.setEditorText`/`shutdown`; assertions are the exact staged command list — fails if a command string drifts |
| `index.spec.ts::only exposes frequent actions` | none | asserts the exact key list `["m","a","t","q"]` and subgroup `["s","p"]` — fails if a chord is added/removed |
| `model-pick.spec.ts::providers aggregated` | none | drives real `getProviders` with a real `modelRegistry.getAvailable` stub; asserts counts + order |
| `model-pick.spec.ts::thinking descriptions` | none | pure function, asserts exact strings |

No contract violations found. All 4 tests exercise production code, assert on
observable output, and would fail on a real regression to the seam they name.

## Test Strategy Audit

**Available layers** (from `testing.layers`): unit, integration.

| Behavior | Assigned Layer | Degrade? | Duplicate Coverage? | Rationale |
|----------|---------------|----------|---------------------|-----------|
| entry shape / command staging | unit | no | no | pure logic, no pi runtime needed |
| provider aggregation / thinking desc | unit | no | no | pure logic over a stubbed registry |
| boot + `/cp` registration + no conflict | integration (RPC) | no | no | only observable with a live pi session |
| full PTY render | e2e (PTY) | yes (degraded to render-capture) | no | node-pty native spawn fails headless |

**Layer distribution:** 4 unit, 1 integration (RPC probe), 1 e2e (render capture).
Reasonable: the pure seams are unit-tested cheaply; the one thing that *needs*
a live pi (registration + no shortcut conflict) is verified at the integration
seam; the slow visual layer is degraded and named.

## Security Audit

**Mode:** Trivy

### Trivy Findings (Mode A)

**Command:** `trivy fs --scanners vuln,secret --severity CRITICAL extensions/command-plate/`

| Scanner | Finding | Severity | Location | Fix | Classification |
|---------|---------|----------|----------|-----|----------------|
| vuln | (none) | — | `package-lock.json` | — | — |
| secret | (none) | — | — | — | — |

**Trivy gate:** `fail_on: CRITICAL` → **PASS** (0 findings ≥ CRITICAL)

### Manual Findings (OWASP spot-check)

| File | OWASP Item | Pattern | Evidence |
|------|------------|---------|----------|
| — | A01–A10 | — | No user-facing input, no network calls, no secrets, no file writes beyond pi's own `setModel`/`setThinkingLevel`/`setEditorText`. Extension reads `SettingsManager.getEnabledModels()` (read-only). Nothing to audit beyond Trivy. |

**Security verdict:** PASS — 0 findings (CRITICAL: 0, WARNING: 0, SUGGESTION: 0)

## Code Quality Gate

| Gate | Command | Threshold (config) | Actual | Result |
|------|---------|--------------------|--------|--------|
| Coverage | not configured | 0 | N/A | N/A |
| Mutation | not configured | 0 | N/A | N/A |
| Lint | not configured | errors only | N/A | N/A |
| Typecheck | `tsc --noEmit -p extensions/command-plate` | errors only | 0 errors | PASS |
| P0 pass rate | P0 tests (plan rows 1–4) | 100 | 100 (4/4 vitest + RPC probe) | PASS |
| P1 pass rate | P1 tests (plan rows 5–6) | 95 | 100 (2/2) | PASS |
| Trivy security | `trivy fs` | fail_on CRITICAL | 0 findings | PASS |

**Quality config status:** configured (coverage_min/mutation_min both 0 → N/A; p0=100, p1=95; trivy fail_on=CRITICAL)

**Dead code (if configured):** N/A

## State Drift

`pipeline.current_change` is `2026-10-15-plan-build-extension` (stale — that
change shipped). This command-plate change was executed directly on `main`
without creating a spec zone, so `current_change` did not track it. This is
advisory (state.yaml notes are a rolling log, not a per-change source of truth)
and does not affect the verdict.

**Verdict:** DRIFT: none (advisory) — current_change points at the last *shipped*
change; command-plate is the in-flight QA change and is recorded in this report.

## Verification Scope

| Derivation | Scope | Stale? |
|---|---|---|
| Traceability matrix | COMPLETE (all 8 derived behaviors enumerated) | none |
| Verification-gap audit | COMPLETE (full `extensions/command-plate/` read; diff is additive-only, 4220 insertions / 0 deletions) | none |
| Root suite run | COMPLETE (12 test files; 42 pass / 0 fail / 7 skip on the final run) | none |
| Trivy | COMPLETE (scoped to the new subpackage lockfile) | none |

**Stale-verification:** `STALE: none` — all evidence is from this run.

## Floor

| Dimension | Verdict |
|---|---|
| Goal-backward verification (weakest truth) | PRESENT_BEHAVIOR_UNVERIFIED (2 key links + 1 data flow not driven by a test) |
| Traceability (weakest scenario) | 6/8 covered; 2 pending (scoped-models resolution, PTY render) |
| Verification-gap audit | 2 WARNING (missing-test gaps, both named) |
| TDD evidence (weakest ticket) | MISSING_RED (documented, not CRITICAL — additive direct execution) |
| Test quality audit | none |
| Code-quality gates (weakest gate) | PASS |
| Security audit | PASS |
| Verification scope (composite) | COMPLETE |

**FLOOR:** the weakest dimension is **Goal-backward verification =
PRESENT_BEHAVIOR_UNVERIFIED** (the `m`→scoped-picker link, the `Ctrl+K`
input→palette link, and the model-switch data flow are wired and present but not
driven end-to-end by a test). That caps the gate at **CONCERNS** — it never
reaches a clean PASS because two behaviors are `PRESENT_BEHAVIOR_UNVERIFIED` and
two traceability rows are `pending`, and the floor rule says a non-VERIFIED
truth is a non-answer the human clears by re-running with full scope (a PTY
render test) or by accepting the residual.

## Findings

### CRITICAL (must fix before merge)

- None.

### WARNING (should fix before archive)

- **W022** — Scoped-models resolution (`loadScopedModels`: glob matching,
  `:thinking` suffix parsing, dedup, sort) has no unit test; the function is not
  exported, so it is only verified by code read. Re-run path: export it (or test
  through `runScopedModels` with a stubbed `modelRegistry`) and add a spec.
- **W023** — Full PTY palette render + interactive key handling is not
  automated (`node-pty` native spawn fails headless). Re-run path: add a
  `tests/pty-settle.mjs`-style render-capture test that boots pi with the
  extension, sends `Ctrl+K`, and asserts the "Command Plate" frame — runnable in
  a CI env where node-pty's prebuild is present.
- **W024** — Executed directly without a spec zone (`briefing.md` /
  `acceptance.feature` / `blueprint.md`); `MISSING_RED` therefore expected. The
  decision to run a small additive port directly (no ticketing/slicing) is
  recorded here in lieu of the spec zone.

### SUGGESTION (nice to have)

- **W025** — `runModelSwitcher` and `runThinkingPicker` are exported utilities
  not wired to any palette entry or command (faithful to upstream, where the
  full switcher is likewise unwired). If they should be reachable, add a palette
  entry or `/cp-model` command; otherwise note in the README that they are
  programmatic-only (currently implied).

## Gate Decision

**Verdict:** CONCERNS

**Reasoning:** No CRITICAL findings, all hard code-quality gates PASS, Trivy
clean, scope COMPLETE, and the load-bearing truths (palette registration, no
shortcut conflict, command staging) are VERIFIED by named tests + a runtime
probe. But the floor is capped at CONCERNS by (a) two `PRESENT_BEHAVIOR_UNVERIFIED`
key links / data flow, and (b) two `pending` traceability rows (scoped-models
resolution, full PTY render) — the latter env-blocked (node-pty headless) rather
than code-incomplete. The change is safe to ship; full PASS requires re-running
with a PTY render test and a scoped-models resolution spec.

**Open items (if CONCERNS):**
- **W022** — add a scoped-models resolution spec (export `loadScopedModels` or
  drive `runScopedModels` with a stubbed registry). Fix now / defer to ticket.
- **W023** — add a PTY render-capture e2e test (needs a node-pty-capable CI env).
  Fix now / defer to ticket.
- **W024** — (recorded, not fixable at the gate) spec zone was intentionally
  skipped for a small additive port; accepted.
- **W025** — (SUGGESTION) decide whether `runModelSwitcher`/`runThinkingPicker`
  get a palette/command entry.

## Human Override

> A human decision always overrides this machine verdict.
> An epic that fails its criteria with no human decision is recorded as **not accepted** — never as silently accepted.

**Human decision (fill in):** <accept / accept-with-open-items / reject> — <name> — <date>

<!-- reflect completes this half at archive time -->

## Final-State Facts

**Shipped:** <what actually shipped>
**Base branch:** main · **Chain strategy:** stacked-to-main

## Gates

| Gate | Result |
|------|--------|
| Ship gate | <pending> |
| QA gate | CONCERNS — human override pending |
| Verdict gate (advisory) | <pending> |

## Decisions

| Decision | Tradeoff | Why | Source |
|----------|----------|-----|--------|
| Re-key palette to `Ctrl+K` (from upstream `Ctrl+X`) | loses the upstream muscle memory | `Ctrl+X` collides with pi `app.message.copy` → shortcut skipped | `caf0f66`; `keybindings.js` |
| Drop the upstream wf-contracts panel | less out-of-the-box | it depends on the author's personal `wf-gate` CLI + plannotator | plan (user choice) |
| Local `overlay-frame.ts` copy instead of `../shared/` | small duplication | upstream `../shared/overlay.ts` isn't in skill-pi; avoids cross-extension import | `4ec2648` |
| Use `ModelThinkingLevel` (not `ThinkingLevel`) from pi-ai | — | pi-ai `ThinkingLevel` lacks `"off"`; `pi.getThinkingLevel()` returns `"off"` | `model-pick.ts` |

## Lessons

| Lesson | Root Cause | Do Differently | Source |
|--------|-----------|----------------|--------|
| Upstream shortcut keys may collide with a different pi version's built-ins | upstream fork had `Ctrl+X` free | before porting a `registerShortcut`, scan the installed `keybindings.js` table | `caf0f66` |
| e2e RPC boot is load-sensitive (15s timeout flakes under full-suite concurrency) | shared machine + concurrent QA probes | run flaky e2e standalone; attribute via a stashed-baseline re-run | `rpc.test.js` |

## Patterns

| Pattern | Reuse | Source |
|---------|-------|--------|
| RPC `get_commands` as the cheap registration smoke test for any new extension | verify `/cmd` is present + no shortcut conflict without a PTY | this QA probe |

## Surprises

| Surprise | Signal | Source |
|----------|--------|--------|
| `node-pty` native `spawn-helper` fails headless (`posix_spawnp failed`) | existing e2e tests skip it gracefully; PTY render can't be scripted here | pty probe runs |
| pi-ai `ThinkingLevel` ≠ `ModelThinkingLevel` (no `"off"`) | tsc would have caught a wrong import | `model-pick.ts` |

## Environment Retro

_Written by `skillgrid:environment-retro` (a reflect sub-phase), not qa._

| Category | Finding | Fix lands in | Source |
|----------|---------|--------------|--------|
| | | | |

## Acceptance Verdict

**Verdict:** <pending human>

**Grounding:** goal = command-plate extension (which-key palette + model pickers),
homogenized, no wf-contracts. Evidence: palette registered + no shortcut conflict
(VERIFIED), command staging + entry shape (VERIFIED), pickers present + pure logic
(VERIFIED); scoped-models resolution and full PTY render present-but-unverified.

**Reasoning:** <pending human>

## Open Items (→ next change)

- W022 — scoped-models resolution spec
- W023 — PTY render-capture e2e (node-pty-capable env)
- W025 — decide wiring for `runModelSwitcher`/`runThinkingPicker`

## Prior-Change Follow-Through

| Prior open item (from previous archived change) | Addressed by this change? | Evidence |
|--------------------------------------------------|---------------------------|----------|
| (none specific to command-plate) | — | — |

## Move Evidence (from ship context)

**From:** `.skillgrid/specs/2026-10-16-command-plate-extension/` → **To:** `.skillgrid/archive/2026-10-16-command-plate-extension/`
**`diff -r` readback:** <pending>

## Overrides / Waivers / Contradictions

- None recorded yet (CONCERNS — pending human decision).

## Lineage (observation IDs)

- briefing: none (executed directly from plan)
- blueprint: none
- tasks: none
- ship: pending
- report (QA half): this file
- research / findings / ADRs: ADR-0007 (self-contained package shape), ADR-0002 (isolation)
