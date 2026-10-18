# Report — pi-vcc include-awareness

> Change: `.skillgrid/specs/2026-10-16-pi-vcc-include-awareness/` (moves to `.skillgrid/archive/2026-10-16-pi-vcc-include-awareness/` at ship)
> Generated: 2026-10-18T10:55:00+02:00 (qa)
> Gate: CONCERNS
>
> Two phases, one file: **qa** writes the QA half (the sections above `## Final-State Facts`,
> through `## Gate Decision` + `## Human Override`) into the spec folder. **ship** reads the
> `## Gate Decision` verdict PRE-MOVE, then moves the folder. **reflect** completes the retro
> half (from `## Final-State Facts` onward) IN PLACE in the archive folder.

## Test Plan

> Derived from `blueprint.md` (4 tasks) and `briefing.md` (R1–R4). No `acceptance.feature`
> exists for this change (not produced at spec time); the blueprint's `SATISFIES` scenario
> names are the traceability oracle. TDD RED→GREEN per `bun test` is the evidence.

### Risk Ranking

Most likely thing to break in production: the compaction pipeline regression — a bad edit to
the section emission/merge path would corrupt EVERY future compaction's summary (sticky
sections accumulate forever). Second: the cross-extension handshake contract — a shape
mismatch between this extension's writer (the companion pi-context-include change, not yet
built) and `readIncludes()` would silently disable the `[Standing Rules]` section. The plan
tests the merge path hardest (real `compile()` pipeline, prev+fresh) and the contract with
table-driven edge cases.

### Plan

| # | Risk / Behavior | Seam | Layer | Test / Scenario | Priority | Cadence | Status |
|---|-----------------|------|-------|-----------------|----------|---------|--------|
| 1 | Compaction emits capped `[Standing Rules]` from handshake file | compile() pipeline | unit (integration-grade: real pipeline) | `tests/standing-rules-compile.test.ts` (door check: 200-rule fixture, ≤150 bullets, footer, no section when missing) | P0 | pr | covered |
| 2 | Missing/invalid handshake file → no section, never throws | readIncludes() | unit | `tests/includes.test.ts` (missing, invalid JSON, non-.md dropped, non-absolute dropped, unreadable path) | P0 | pr | covered |
| 3 | Caps: 150 lines / 6 KB total, first-wins, truncation footer | readIncludedRules() | unit | `tests/includes.test.ts` (2000-line file → truncated, ≤150 total lines) + `tests/extract-standing-rules.test.ts` (footer shape) | P0 | pr | covered |
| 4 | Sticky merge: dedup + cap 15 + slice(-15) + no double-prefix across compactions | mergePrevious() | unit (real compile with previousSummary) | `tests/standing-rules-compile.test.ts` (shared-line dedup=1, no `--`, 16 old + 1 fresh → 15 bullets, oldest dropped) | P0 | pr | covered |
| 5 | Fence-aware extraction (``` blocks, list markers, emails, mid-sentence) | extractReferences grammar | unit | `tests/includes.test.ts` `extractRefTokens` table (6 rows) | P1 | pr | covered |
| 6 | Section emission order + omission when empty | formatSummary() | unit | `tests/format.test.ts` (Standing Rules between Outstanding Context and User Preferences; absent when empty) | P1 | pr | covered |
| 7 | vcc_recall expandRefs: known @path → file body appended under hit | formatRecallOutput() | unit (real temp file + real resolver) | `tests/vcc-recall-expand-refs.test.ts` (sentinel body, off = unchanged, 10/page cap with 12 hits, 40-line truncation, 3-arg byte-identical, relative-token non-match) | P0 | pr | covered |
| 8 | parseRecallScope expandRefs token (tool + command) | parseRecallScope() | unit | `tests/recall-scope.test.ts` (`"foo expandRefs"` → true + stripped; `"foo"` → false) | P1 | pr | covered |
| 9 | Ref token grammar pinned against Task 1's extractRefTokens (drift guard) | refTokensIn vs extractRefTokens | unit (differential) | `tests/vcc-recall-expand-refs.test.ts` (shared grammar sample, per-line + whole-body agreement) | P1 | pr | covered |
| 10 | last-compaction.json: write never throws, read → null on missing/invalid, round-trip | writeLastCompaction/readLastCompaction | unit | `tests/last-compaction.test.ts` (missing→null, invalid→null, valid round-trip, unwritable path, env override at call time) | P1 | pr | covered |
| 11 | /pi-vcc:status renders last-compaction + settings + include status; empty state | vcc-status command handler | unit (faked pi ctx, real temp files) | `tests/vcc-status.test.ts` (populated, empty state, missing-handshake) | P1 | pr | covered |
| 12 | Command registered in extension entry point | index.ts | unit (registration capture) | `tests/vcc-status.test.ts` (registerVccStatusCommand captured) | P2 | pr | covered |
| 13 | Compaction return object byte-identical (persist is sibling side-effect) | compact-handler success path | unit (existing strict-equality suite) | `tests/before-compact-hook.test.ts` (21/21 unchanged, strict toEqual on returned objects) | P0 | pr | covered |
| 14 | Table-driven extractor suites (R4) + behavior-preserving refactor | extract-preferences tests | unit | `tests/extract-preferences.test.ts` (4→12 table rows, originals verbatim, length→toEqual upgrades) | P2 | pr | covered |

**Layer note:** the extension's own test runner is `bun test` (ADR-0007 self-contained
toolchain); the project's `testing.runner` (`node --test "test/**/*.test.js"`) covers the
wrapper and was run as a regression net (58 tests, 51 pass / 0 fail / 7 skipped — the 7
skipped are pre-existing e2e/env-gated skips, not this change). All rows above ran in the
extension suite: 262 tests, 261 pass / 1 fail (pre-existing `real-sessions.test.ts`,
verified red on the clean pre-change baseline 998c6ed during Task 1 — environmental,
missing large-session fixture data, not a regression of this change).

### Edge-Case Matrix

| Requirement | Edge / Boundary | Expected Behavior | Test / Scenario | Status |
|-------------|-----------------|-------------------|-----------------|--------|
| R1 Standing Rules | handshake file missing | no section, no throw | `includes.test.ts` missing-file + `standing-rules-compile.test.ts` no-section case | covered |
| R1 | invalid JSON in handshake | `[]`, no throw | `includes.test.ts` invalid-JSON | covered |
| R1 | entry non-`.md` / relative path | dropped | `includes.test.ts` drop cases | covered |
| R1 | 2000-line file | truncated at 150 total lines, footer `(+N more in <basename>)` | `includes.test.ts` cap case + `extract-standing-rules.test.ts` footer | covered |
| R1 | repeated lines across files | deduped | `includes.test.ts` dedup case | covered |
| R1 | fenced block in rule file | stripped | `includes.test.ts` fence case | covered |
| R1 | second compaction over first | dedup + cap 15 + slice(-15), no double-prefix | `standing-rules-compile.test.ts` prev+fresh cases | covered |
| R2 recall refs | expandRefs unset/absent | output byte-identical to pre-change | `vcc-recall-expand-refs.test.ts` 3-arg + expand-off cases | covered |
| R2 | 12 hits with known refs | exactly 10 expanded (page cap) | `vcc-recall-expand-refs.test.ts` cap case (BODY_9 in, BODY_10/11 out) | covered |
| R2 | file > 40 lines / 2 KB | truncated with `(truncated)` marker | `vcc-recall-expand-refs.test.ts` truncation case | covered |
| R2 | relative @token vs absolute handshake path | no match (documented) | `vcc-recall-expand-refs.test.ts` relative-token case | covered |
| R2 | `@` grammar drift between the two scanners | differential test fails | `vcc-recall-expand-refs.test.ts` drift-pin (shared sample) | covered |
| R3 status | no compaction yet | `none yet` empty state, no error | `vcc-status.test.ts` empty state | covered |
| R3 | last-compaction.json invalid JSON | null → empty state, no throw | `last-compaction.test.ts` invalid-JSON | covered |
| R3 | include entry whose file vanished | `missing <path>` row | `vcc-status.test.ts` missing-handshake case | covered |
| R3 | persist write to unwritable path | swallowed, compaction unaffected | `last-compaction.test.ts` unwritable-path | covered |

### Out of Scope

- Live skill-pi session E2E (compacting a real session and reading the rendered prompt) —
  the extension's test layers are unit/integration per ADR-0007; the `real-sessions.test.ts`
  suite is the closest proxy and its 1 failing test is pre-existing/environmental.
- The companion producer (pi-context-include extension) — separate change, not built yet;
  the handshake contract is verified against the JSON shape, not a live writer.
- Trivy full-repo vuln baseline beyond `extensions/pi-vcc` — no new deps in this change;
  the extension lock file was scanned separately (clean).

## Goal-Backward Verification

**Stated goal** (from briefing.md): Make pi-vcc compaction and recall include-aware: a
`[Standing Rules]` sticky section sourced from a resolved-include handshake file, `@path`
ref expansion in `vcc_recall`, and a `/pi-vcc:status` diagnostic — all without depending on
the user's separate include-extension.

**Assumption:** The goal was NOT achieved until the evidence below proves it.

| Level | Item | Evidence | Status |
|-------|------|----------|--------|
| Truth | Compacting with a populated handshake file yields `[Standing Rules]` with included rule lines, capped | `tests/standing-rules-compile.test.ts` — real `compile()`, 200-rule fixture, asserts ≤150 bullets, first bullet, footer; ran, passed | VERIFIED |
| Truth | Missing/empty handshake → NO section, never throws | `tests/includes.test.ts` (missing/invalid) + `standing-rules-compile.test.ts` no-section case; ran, passed | VERIFIED |
| Truth | Second compaction dedups `[Standing Rules]` (no stacking) | `tests/standing-rules-compile.test.ts` prev+fresh: shared line count = 1, 16→15 cap, oldest dropped; ran, passed | VERIFIED |
| Truth | `vcc_recall expandRefs:true` appends resolved file body for a known @path hit | `tests/vcc-recall-expand-refs.test.ts` — real temp file + real resolver, sentinel `ALWAYS_RUN_TESTS` present in output; ran, passed | VERIFIED |
| Truth | expandRefs absent → output unchanged (byte-identical 3-arg path) | `tests/vcc-recall-expand-refs.test.ts` 3-arg case + full existing recall suite green (recall-tool-scope, recall-expand, recall-scope); ran, passed | VERIFIED |
| Truth | Ref expansion bounded: 10/page, 40 lines / 2 KB per ref | `tests/vcc-recall-expand-refs.test.ts` cap + truncation cases; ran, passed | VERIFIED |
| Truth | `/pi-vcc:status` renders last-compaction + settings + include status; graceful empty state | `tests/vcc-status.test.ts` populated + empty-state + missing-handshake; ran, passed | VERIFIED |
| Truth | `last-compaction.json` written on every successful compaction, presence does not alter behavior | `tests/last-compaction.test.ts` round-trip + unwritable; `tests/before-compact-hook.test.ts` 21/21 unchanged (strict toEqual on returned objects) | VERIFIED |
| Artifact | `src/core/includes.ts` (readIncludes/readIncludedRules/extractRefTokens + caps) | exists, 92+ lines, exercised by 3 test files; grep + tests | VERIFIED |
| Artifact | `src/extract/standing-rules.ts`, `src/commands/vcc-status.ts`, `src/core/last-compaction.ts` | exist, wired into buildSections / index.ts / compact-handler respectively; exercised by tests | VERIFIED |
| Key Link | buildSections → formatSummary → mergePrevious section pipeline (order + omission + sticky merge) | `tests/format.test.ts` + `standing-rules-compile.test.ts` end-to-end through real `compile()` | VERIFIED |
| Key Link | recall tool + command share the single resolver (readIncludes) — no second parser | `tools/recall.ts` + `commands/vcc-recall.ts` call `readIncludes()`; drift-pin test pins the token grammar | VERIFIED |
| Key Link | compact-handler persist + vcc-status read share `last-compaction.ts` (one writer, one reader) | `tests/last-compaction.test.ts` round-trip + `vcc-status.test.ts` render-from-seeded-file | VERIFIED |
| Data Flow | real rule file → handshake JSON → compile() → summary text containing the rules, capped | `standing-rules-compile.test.ts` full pipeline with mkdtemp fixtures | VERIFIED |

## Traceability Matrix

> No `acceptance.feature` for this change (spec-time gap, noted in ledger). Scenario names
> below are the blueprint's `SATISFIES` names — the oracle this execution ran against.

| Scenario (SATISFIES) | Test / Scenario (from test plan) | Ran | Result |
|--------------------------------------|----------------------------------|-----|--------|
| standing-rules-section (T1) | `standing-rules-compile.test.ts` + `includes.test.ts` + `extract-standing-rules.test.ts` + `build-sections.test.ts` + `format.test.ts` | yes | pass |
| recall-expand-refs (T2) | `vcc-recall-expand-refs.test.ts` + `recall-scope.test.ts` + `format-recall.test.ts` + `recall-tool-scope.test.ts` | yes | pass |
| vcc-status (T3) | `vcc-status.test.ts` + `last-compaction.test.ts` + `before-compact-hook.test.ts` | yes | pass |
| test-hygiene (T4) | `extract-preferences.test.ts` (12 table rows) + full suite | yes | pass |

**Coverage:** 4/4 scenarios covered by tests that ran and passed.

## Verification-Gap Audit

| Gap | Location | Shape | Evidence | Smallest Regression |
|-----|----------|-------|----------|---------------------|
| None material. All changed behaviors have a covering test that ran and passed; the drift-pin (row 9) closes the one cross-module duplication; the byte-identity constraint (row 13) is covered by the unchanged strict-equality suite. One residual: the cross-process "write in process A, read in process B" handshake is exercised by round-trip + seeded-render separately but not in a single two-process test — unit layer is adequate for a file contract with a shape test; noted as SUGGESTION, not a gap. | — | — | — | — |

## TDD Evidence Audit

> No `tasks.md` (slicing was skipped for this execution — tasks dispatched straight from the
> blueprint). Evidence source: the four implementer reports in `.skillgrid/sdd/blueprint/`.

| Task (blueprint) | SATISFIES Scenario | RED Evidence | GREEN Evidence | Verdict |
|----------------------|--------------------|--------------|----------------|---------|
| Task 1 | standing-rules-section | report TDD Evidence: module-not-found RED for includes/extract-standing-rules/build-sections additions (command + output in task-1-report.md) | 230/231 suite (1 pre-existing baseline fail); tsc clean | OK |
| Task 2 | recall-expand-refs | report: RED showing expandRefs missing from parseRecallScope + no `@ref:` in output (task-2-report.md) | 239/240 suite; tsc clean; drift-pin added in fix round 1 (60ce814) | OK |
| Task 3 | vcc-status | report: module-not-found RED for last-compaction/vcc-status (task-3-report.md) | 251/252 suite; tsc clean; before-compact-hook 21/21 | OK |
| Task 4 | test-hygiene | sticky-merge test written first (pass-immediately case — pins existing behavior; noted in task-4-report.md as the TDD case that occurs) | 261/262 suite; tsc clean | OK |

## Test Quality Audit

| Test | Contract Violated | Evidence |
|------|-------------------|----------|
| (none) | — | All new tests assert on production behavior with real temp files + real env vars (no mocks of the resolver); the faked `pi` ctx in `vcc-status.test.ts` returns the realistic `sendMessage` shape; counter-tests exist for every "does not X" (no-section-when-missing, byte-identical-3-arg, relative-token-non-match, expand-off, empty-state); the drift-pin is a differential test, not a tautology. P0 triangulation: every P0 behavior has ≥2 tests with different inputs (e.g. caps tested with 2000-line file AND prev+fresh 16-rule merge; expandRefs tested on + off + cap + truncation). |

## Test Strategy Audit

**Available layers** (from `testing.layers`): unit, integration.

| Behavior | Assigned Layer | Degrade? | Duplicate Coverage? | Rationale |
|----------|---------------|----------|---------------------|-----------|
| extraction + caps + fence-aware grammar | unit | no | no | pure functions, table-driven |
| section pipeline (emit/merge/order) | unit (integration-grade: real compile) | no | no | exercises the full in-process pipeline — the highest layer that fits without a live pi session |
| recall ref expansion | unit | no | no | real resolver + real temp file; no pi runtime needed |
| last-compaction write/read + status render | unit | no | no | file contract; two-process case degraded to round-trip + seeded-render (noted in gap audit) |

**Layer distribution:** 14 unit (of which 3 are integration-grade through the real pipeline).
Reasonable for this risk profile: the risk is in the merge/emit logic, which the in-process
pipeline tests reach directly; a live-session E2E would add little over `standing-rules-compile.test.ts`.

## Security Audit

**Mode:** Trivy (configured: `security.trivy.command: "trivy fs"`)

### Trivy Findings (Mode A)

**Command:** `trivy fs --severity CRITICAL --scanners vuln,secret,misconfig extensions/pi-vcc` (and full-repo scan)

| Scanner | Finding | Severity | Location | Fix | Classification |
|---------|---------|----------|----------|-----|----------------|
| (none) | 0 CRITICAL findings in `extensions/pi-vcc` and full repo; no new dependencies introduced by this change | — | — | — | — |

**Trivy gate:** `fail_on: CRITICAL` → PASS (0 findings at or above threshold)

**OWASP spot-check:** the changed code reads user-controlled files (handshake JSON, rule
`.md` files, session JSONL via recall) — all reads are try/catch-bounded, size-capped
(6 KB / 2 KB), and path-constrained to absolute paths from a single trusted writer (the
companion extension, which owns the path-safety fence per the briefing's out-of-scope
split). No shell interpolation, no eval, no new network surface.

**Security verdict:** PASS — 0 CRITICAL, 0 WARNING, 0 SUGGESTION.

## Code Quality Gate

| Gate | Command | Threshold (config) | Actual | Result |
|------|---------|--------------------|--------|--------|
| Coverage | not configured | 0 | N/A | N/A |
| Mutation | not configured | 0 | N/A | N/A |
| Lint | not configured | errors only | N/A | N/A |
| Typecheck | `./node_modules/.bin/tsc --noEmit -p .` (extension) | errors only | 0 errors | PASS |
| P0 pass rate | P0 rows 1–4, 7, 13 of the test plan | 100% | 100% (all P0 tests ran and passed) | PASS |
| P1 pass rate | P1 rows 5, 6, 8–11 of the test plan | 95% | 100% | PASS |
| Trivy security | `trivy fs` | CRITICAL | 0 findings ≥ CRITICAL | PASS |

**Quality config status:** configured (`quality:` present; coverage/mutation thresholds 0 = disabled).

**Dead code (if configured):** N/A (no dead-code tool configured; jscpd config exists at repo root but is not a QA gate).

## State Drift

> `node .agents/skills/verification/qa/scripts/state-drift-check.mjs` via `qa-gate.mjs`.

**Verdict:** PARSE ERROR (advisory only — the check's helper scripts report "script not found" in this environment; composite scope still `COMPLETE` per the guard's JSON)

| Field | Stale (state.yaml) | Derived (spec zone) |
|-------|-------------------|---------------------|
| pipeline.current_phase | executing (set at execution start) | qa (this gate) |
| pipeline.current_change | 2026-10-16-pi-vcc-include-awareness | matches spec folder |

**Fix applied:** `state.yaml` `current_phase` patched `executing` → `qa` by this run (committed with this report).
**Scope (from the guard's `SCOPE:` line):** composite `COMPLETE`.

## Verification Scope

| Derivation | Scope | Stale? |
|---|---|---|
| Traceability matrix | COMPLETE (all 4 SATISFIES scenarios read from the blueprint; no acceptance.feature exists — named above) | none |
| Verification-gap audit | COMPLETE (all changed behaviors enumerated from the 5 task commits: f659019, f8c5a96, 60ce814, ca78065, 6661bda, de476bd) | none |
| State Drift (9.5) | COMPLETE (guard JSON composite; helper-script error is advisory, recorded) | n/a |
| Structure Drift (9.6) | N/A (skipped: no --anticipated paths) | n/a |

**Stale-verification:** `STALE: none` — no code-zone change since the Task 4 review (de476bd is HEAD for this change); this run's own suite runs (262 tests, extension) + root suite (58 tests) are the evidence.

## Floor

| Dimension | Verdict |
|---|---|
| Goal-backward verification (weakest truth) | VERIFIED (all 8 truths + 3 artifacts + 3 key links + 1 data flow) |
| Traceability (weakest scenario) | COMPLIANT (4/4) |
| Verification-gap audit | none (one SUGGESTION-level residual, named) |
| TDD evidence (weakest ticket) | OK (4/4; Task 4 RED = pass-immediately pin, documented) |
| Test quality audit | none |
| Code-quality gates (weakest gate) | PASS (typecheck + P0 + P1 + Trivy; coverage/mutation/lint N/A by config) |
| Security audit | PASS (0 findings) |
| Verification scope (composite) | COMPLETE |

**FLOOR:** all dimensions at their best value — floor is PASS-eligible. The gate renders
**CONCERNS** (not PASS) solely on the fail-closed treatment of one named non-answer: the
pre-existing `real-sessions.test.ts` failure is outside this change's scope (verified red on
the clean pre-change baseline) but it keeps the extension suite from exiting 0, which is the
P0-suite-exit criterion. A human can clear this by (a) accepting the baseline failure as
environmental (the evidence for that is in the Task 1 ledger + this report's Test Plan note),
or (b) fixing the missing-fixture issue in a separate change.

## Findings

### CRITICAL (must fix before merge)

- None.

### WARNING (should fix before archive)

- Pre-existing `tests/real-sessions.test.ts` failure ("compiles copied large sessions without
  mutating originals" — expects > 0 large-session fixtures, finds 0). Red on the clean
  pre-change baseline 998c6ed (verified by controller during Task 1: the test fails identically
  when the pi-vcc tree is checked out at baseline). Not caused by this change; blocks the
  suite from exiting 0. Path to resolution: restore/commit the large-session fixture data, or
  mark the suite env-gated — as a SEPARATE change (out of scope here).

### SUGGESTION (nice to have)

- README anchor link `#ref-expansionexpandrefs` is missing GitHub's retained trailing `)`
  (parked from Task 4 review).
- Two-process handshake test (write in A, read in B) is covered by round-trip + seeded-render
  halves rather than one two-process test (noted in gap audit).
- `PI_VCC_CONFIG_PATH` appears in the README env table beyond the new-vars set (accurate, useful).

## Gate Decision

**Verdict:** CONCERNS

**Reasoning:** Every truth, scenario, artifact, and key link of the goal is VERIFIED by named
tests that ran and passed; all code-quality gates PASS or N/A; security clean; scope COMPLETE.
The single non-answer is the pre-existing environmental `real-sessions.test.ts` failure, which
keeps the extension suite from exiting 0 — verified pre-existing at baseline, not a regression
of this change. Per the fail-closed rule, that routes the gate off PASS to CONCERNS with a
named re-run path.

**Open items (if CONCERNS):**
- Pre-existing `real-sessions.test.ts` environmental failure — human decision: accept as
  environmental (evidence: red at baseline 998c6ed, before any change commit) or schedule a
  separate fixture-restore change. Re-run path: `cd extensions/pi-vcc && ./node_modules/.bin/bun test`
  exits 0 once the fixture data is restored.

**Waiver (if WAIVED):**
- n/a

## Human Override

> A human decision always overrides this machine verdict.
> An epic that fails its criteria with no human decision is recorded as **not accepted** — never as silently accepted.

**Human decision (fill in):** <accept / accept-with-open-items / reject> — <name> — <date>

<!-- reflect completes this half at archive time -->

## Final-State Facts

**Shipped:** <what actually shipped>
**Base branch:** <base-branch> · **Chain strategy:** <strategy>
**Integration:** <merged @ <commit> | PR <url> | kept branch <name>> (from ship context)

## Gates

| Gate | Result |
|------|--------|
| Ship gate | ✅ success + `diff -r` empty (or: blocked — {reason}) |
| QA gate | ✅ {PASS \| WAIVED \| CONCERNS — human override recorded} |
| Verdict gate (advisory) | {accepted \| accepted-with-open-items \| rejected} — recorded, not enforced |

## Decisions

**Every entry MUST cite a source** — a file:line, a commit, a ticket ID, or a scenario name. No source = undiagnosed, not a learning.

| Decision | Tradeoff | Why | Source |
|----------|----------|-----|--------|
| <choice made> | <what was given up> | <why it won> | <file:line / commit / ADR / ticket> |

## Lessons

| Lesson | Root Cause | Do Differently | Source |
|--------|-----------|----------------|--------|
| <what to do differently> | <why it went wrong — root, not symptom> | <the concrete change> | <file:line / commit / ticket> |

## Patterns

| Pattern | Reuse | Source |
|---------|-------|--------|
| <named reusable approach / convention> | <when a future change should apply it> | <file:line / commit / ticket> |

## Surprises

| Surprise | Signal | Source |
|----------|--------|--------|
| <non-obvious gotcha / edge case / behavior> | <what the evidence shows> | <file:line / commit / scenario> |

## Environment Retro

**Written by `skillgrid:environment-retro` (a reflect sub-phase), not qa.** Improvements to the *agent environment*, never the code. A finding appears only where its "Use when" fired; a clean session leaves this empty.

| Category | Finding | Fix lands in | Source |
|----------|---------|--------------|--------|
| <navigation \| automated checks \| coding standards \| steering no-ops \| tool economy \| information access> | <what to change + why> | <linter rule \| pre-commit \| CI job \| ARCHITECTURE.md pointer \| steering file> | <file:line / commit / ticket / session symptom> |

## Acceptance Verdict

**Verdict:** accepted | accepted-with-open-items | rejected

**Grounding:** <goal from briefing.md + the Goal-Backward Verification / Traceability Matrix evidence above that supports the verdict>

**Reasoning:** <2–3 sentences: what drove the verdict>

## Open Items (→ next change)

- <item + path to resolution> (or "None")

## Prior-Change Follow-Through

| Prior open item (from previous archived change) | Addressed by this change? | Evidence |
|--------------------------------------------------|---------------------------|----------|
| <item + path to resolution> | yes / no / partially | <commit / file:line / scenario, or "still open"> |

## Move Evidence (from ship context)

**From:** `.skillgrid/specs/2026-10-16-pi-vcc-include-awareness/` → **To:** `.skillgrid/archive/2026-10-16-pi-vcc-include-awareness/`
**`diff -r` readback:** <empty → PASS | verbatim output → FAIL>

## Overrides / Waivers / Contradictions

- <QA waiver, human CONCERNS override, size-exception, or "None">
- <Unrankable contradiction: both statements + sources + when written — or "None">

## Lineage (observation IDs)

Every artifact read this close, for traceability:

- briefing: .skillgrid/specs/2026-10-16-pi-vcc-include-awareness/briefing.md
- blueprint: .skillgrid/specs/2026-10-16-pi-vcc-include-awareness/blueprint.md
- tasks: none (slicing skipped; tasks dispatched from blueprint)
- ship: pending
- report (QA half): this file
- research / findings / ADRs: ADR-0002, ADR-0006, ADR-0007 (constraints); companion spec 2026-10-16-pi-context-include-extension (handshake contract)
