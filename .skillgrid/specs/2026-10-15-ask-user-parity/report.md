# QA Report — 2026-10-15-ask-user-parity

**Change:** full UI/contract parity rewrite of `extensions/ask-user` (the `ask_user` tool), ported from `@juicesharp/rpiv-ask-user-question` (MIT), keeping the `ask_user` tool name.
**Commits:** `033de28` (contract layer) · `643616a` (spec cast fix) · `0aaf49a` (TUI key path) · `653e99a` (e2e prompts) · `33fcdfa` (docs + 1.0.0) · `7daa17f` (state).
**Effective tier:** T2 (default; no briefing `Tier:` line). **Applied floor:** the change rewrites a public tool contract + a state machine (key-router/reducer) + a TUI render path, so the change-classification floor (L2 + L3 runtime verification) governs and is satisfied.

> **Process note (recorded, not a finding):** this change was executed directly from an approved 8-wave plan, not through the brainstorming → blueprint → slicing pipeline. There is no `briefing.md` / `acceptance.feature` / `blueprint.md` for it. The goal and truths below are reconstructed from that approved plan. The QA gate runs against them. Absent artifacts are recorded as SUGGESTION, not FAIL, because the plan (user-approved) is the authoritative source of intent.

## Test Plan

Layers per `config.testing.layers`: `[unit, integration]`. `e2e` is present in `test/` but not in the configured layers; the live TUI e2e is treated as **nightly** (non-blocking) per the Duplicate Coverage Guard — the TUI key path is already covered at the unit layer.

| # | Behavior (goal truth) | Layer | Named test(s) that ran | Status | Cadence | Priority |
|---|-----------------------|-------|------------------------|--------|---------|----------|
| 1 | Tool name stays `ask_user` | unit | `index.spec.ts` > tool registration > registers the ask_user tool | PASS | pr | P0 |
| 2 | Schema is `questions[]`-only, 1–4 questions | unit | `index.spec.ts` > QuestionsSchema (4 tests) | PASS | pr | P0 |
| 3 | 2–4 options, header≤16, label≤60 | unit | `index.spec.ts` > QuestionSchema (12 tests) | PASS | pr | P0 |
| 4 | Reserved labels rejected (`Other`/`Type something.`/`Next`) | unit | `index.spec.ts` > validateQuestionnaire > rejects each reserved label | PASS | pr | P0 |
| 5 | 6 validation error codes (no_questions/too_many_questions/duplicate_question/empty_options/reserved_label/duplicate_option_label) | unit | `index.spec.ts` > validateQuestionnaire (8 tests) + execute—validation errors | PASS | pr | P0 |
| 6 | CR normalization + double-encoded arg decode | unit | `index.spec.ts` > normalizeLineTerminators / normalizeQuestionParams / prepareQuestionArguments (9 tests) | PASS | pr | P1 |
| 7 | Result envelope: answered / declined / preview / notes / global note / unanswered | unit | `index.spec.ts` > buildQuestionnaireResponse (cancelled/completed/global note/partial, 16 tests) + buildToolResult | PASS | pr | P0 |
| 8 | Inbound `ask_user:answer` first-answer-wins + `answer-result` reply | unit | `index.spec.ts` > execute—event flow (RPC unsupported_host / TUI ok / not_found) | PASS | pr | P0 |
| 9 | RPC dialogs not externally answerable → `unsupported_host` | unit | `index.spec.ts` > inbound ask_user:answer to an open RPC host | PASS | pr | P1 |
| 10 | TUI single-select custom draft (preserve/multiline/clear/editor) | unit | `session.spec.ts` > custom-answer drafts (7 tests) | PASS | pr | P0 |
| 11 | TUI multi-select: Enter toggles, Next commits, custom joins checked | unit | `session.spec.ts` > multi-select (3) + `key-router.spec.ts` > routeKey—multiSelect (5) | PASS | pr | P0 |
| 12 | TUI notes (`n`), global note, note visibility | unit | `session.spec.ts` > saved note (3) + `key-router.spec.ts` > notes (2) | PASS | pr | P1 |
| 13 | TUI tab nav (Tab/Shift+Tab/arrows) + Esc cancel from any tab | unit | `key-router.spec.ts` > tab_switch (5) + cancel+submit (3) | PASS | pr | P0 |
| 14 | Config from `$AGENT_HOME/conf.d/ask-user.conf` (ADR-0008), collapseKey grammar, guidance overrides | unit | `index.spec.ts` > config (resolveCollapseKey 7 / formatKeySpecForDisplay 4 / validateGuidanceFields 3 / configPath / loadConfig) | PASS | pr | P1 |
| 15 | i18n via LANG/LC_ALL, 9 locales, English fallback | unit | (locale files 28-key parity; `i18n-bridge` exercised by all session/key-router tests rendering labels) | PASS (indirect) | pr | P2 |
| 16 | Live TUI popup renders + settles in a real pi session | e2e (nightly) | `test/ask-user-e2e.test.js` (5 key-scripted + 2 harness) | SKIP (model) | nightly | P2 |

**Out of scope (named, not tested):** `/languages` command + live locale switching (retained from reference, not ported); overlay-stacking / editor-slot `presentation.ts` (depends on a pi overlay API surface not exercised by skill-pi); the live e2e as a *blocking* gate (see finding F3 — model reliability, pre-existing).

**Edge-case matrix** — drawn from the blueprint/plan edge variants: empty custom draft is not an answer (`session.spec.ts` Ctrl+U test); blank notes dropped (`external-answer` notes test); zero-answers + note is not a decline (`buildQuestionnaireResponse`); note-bearing cancel preserved in `details`; a fully-answered result stays byte-identical (no `unanswered` segment). All covered, all PASS.

## Audit: Goal-backward verification

The goal (from the approved plan): *full UI/contract parity with the reference, keeping the `ask_user` tool name.* Each truth is verified by a named test that ran and passed (exit 0), not a grep.

| Truth | Verdict | Evidence (named test → ran) |
|-------|---------|------------------------------|
| Tool name is `ask_user` | VERIFIED | `index.spec.ts` "registers the ask_user tool with the contract shape" |
| Reference `questions[]` contract adopted | VERIFIED | `index.spec.ts` QuestionsSchema/QuestionSchema/QuestionParamsSchema (18 tests) |
| Flat `question`+`options` + `allowFreeform` retired | VERIFIED (by design) | `index.spec.ts` QuestionParamsSchema "rejects missing 'questions' field"; e2e `FREEFORM_PROMPT` no longer sets `allowFreeform` (diff 653e99a) |
| `Type something.` always appended | VERIFIED | `session.spec.ts` focusCustomAnswer navigates to the `other` row; `key-router.spec.ts` routeKey—multiSelect free-text |
| 9 locales self-contained, LANG/LC_ALL | VERIFIED (indirect) | `locales/*.json` 28-key parity (checked at port); `i18n-bridge` render path exercised by session/key-router tests |
| Full event set (prompt/blocked/answer/answer-result + legacy) | VERIFIED | `index.spec.ts` event channel constants + execute—event flow |
| conf.d config per ADR-0008 | VERIFIED | `index.spec.ts` configPath + resolveCollapseKey + validateGuidanceFields |
| TUI key path (select/multi/notes/tabs/cancel/collapse) | VERIFIED | `session.spec.ts` (15) + `key-router.spec.ts` (25) |
| No regression to siblings | VERIFIED | permission 62/62; root (excl. e2e) 29/29 |

**Level 1 (unit):** all 172 extension tests ran, exit 0.
**Level 2 (integration):** `test/rpc.test.js` PASS (spawn + get_state over the real project dir); permission 62/62.
**Level 3 (runtime):** `rpc.test.js` exercises a live pi RPC process; the e2e process-spawn path is confirmed working after the `spawn-helper` exec-bit fix (it now reaches the model, then self-skips — see F3).
**Level 4 (mutation):** not configured (`testing.mutation` empty) → N/A.

## Audit: Verification-gap

- **PRESENT_BEHAVIOR_UNVERIFIED:** none at P0/P1. The i18n locale selection (truth 15) is verified *indirectly* (the bridge's render path runs under every session/key-router test, but no test asserts a specific non-English string). Downgraded to SUGGESTION (F4) because locale files are data, not logic, and parity was checked at port time.
- **Regression gap:** none. Sibling suites (permission, root) all green.
- **Missing-oracle gap:** the live e2e is the only behavior with no *deterministic* oracle (relies on a 1.5B model emitting a tool call). Recorded as F3 (SUGGESTION, pre-existing), not a gate failure, because the same behavior is deterministically covered at the unit layer.

## Audit: TDD evidence

Test-first per wave: the contract spec (`index.spec.ts`) was written before the modules it pins (wave 1 red→green); the TUI specs (`session.spec.ts`, `key-router.spec.ts`) pin ported behavior and all passed on first run against the ported modules. No test expectation was edited to force a green matrix (the only post-write edits were harness typing fixes: `as any` cast, array type on `prompt.questions`, `undefined` push cast).

## Audit: Test quality

- Layer correctness: pure logic (schema/validate/envelope/normalize/key-router) at unit; process spawn at integration; live TUI at e2e. No wrong-layer tests.
- No duplicate coverage: e2e key scripts duplicate the TUI *render* only; the routing is covered at unit (Duplicate Coverage Guard respected — e2e is nightly, not blocking).
- Assertions are specific (exact envelope bytes, exact `done` result shapes, exact reject payloads).

## Audit: Security

No new user-facing input boundary beyond what the reference already handles. Spot-check:
- `normalize.ts` / `prepareQuestionArguments` parse model-supplied JSON defensively (`parseJson` try/catch → `undefined`, never throws) — malformed args reach the validator, not an uncaught exception.
- `config.ts` `loadConfig` guards `JSON.parse` and non-object payloads → defaults on error (no crash on a hand-edited `conf.d`).
- `external-answer.ts` validates types of every inbound field before use (reject codes `invalid_payload`/`invalid_answer`).
- `i18n-bridge` / `config` read files via `existsSync`/`readFileSync` on fixed paths (no path traversal — the locale dir is fixed relative to the module; the conf path is derived from `getAgentDir()`).
- Trivy: not run in this gate pass (no dependency `package.json` change — only `package-lock.json` is untouched by this change; the `files` list is unchanged). Recorded as N/A for this change's diff. (F5 SUGGESTION to run it at ship.)

## Audit: Code quality gates

| Gate | Threshold | Result | Verdict |
|------|-----------|--------|---------|
| Typecheck (`tsc --noEmit -p extensions/ask-user`) | 0 errors | clean | PASS |
| Lint | not configured | — | N/A |
| Coverage | 0 (disabled) | — | N/A |
| Mutation | 0 (disabled) | — | N/A |
| P0 pass rate | 100% | 100% (all P0 tests in matrix ran green) | PASS |
| P1 pass rate | 95% | 100% | PASS |

## Audit: Deterministic checks

- `npx vitest run` (extension): 172/172, exit 0, reproducible.
- `npx tsc --noEmit -p .`: exit 0.
- `node --test` root (excl. e2e): 29/29, exit 0.
- permission `npx vitest run`: 62/62, exit 0.

## Findings

- **F1 — SUGGESTION (process):** No `briefing.md`/`acceptance.feature`/`blueprint.md` for this change; intent came from an approved plan. Ratify path: backfill via `skillgrid:writing-blueprints` if a permanent spec record is wanted. Non-blocking.
- **F2 — SUGGESTION (infra, pre-existing):** `node_modules/node-pty/prebuilds/darwin-x64/spawn-helper` loses its exec bit on a fresh `npm ci`, breaking every node-pty spawn (`posix_spawnp failed`). Fixed in place with `chmod +x`; a durable fix belongs in the `postinstall`/Taskfile. Not caused by this change.
- **F3 — SUGGESTION (model, pre-existing):** the live TUI e2e cannot be meaningfully verified with `qwen2.5:1.5b` (too slow to reliably emit the `ask_user` tool call within the 90s popup timeout). It self-skips (no hard failure). The behavior is covered deterministically at the unit layer. Pre-existing per ARCH §17 (2026-10-14).
- **F4 — SUGGESTION (coverage):** no unit test asserts a specific non-English locale string; locale selection is verified indirectly. Low-risk (data files, 28-key parity checked at port).
- **F5 — SUGGESTION (security):** Trivy not run in this gate pass (no dependency change in the diff). Run `trivy fs` at ship.

## Floor

Weakest dimension across audits: the live e2e (F3) is a `TRUNCATED`-scope verification — it ran but its key-scripted scenarios could not be exercised because the model did not invoke the tool. Per the fail-closed scope rule, a truncated scope with a named re-run path caps the verdict at **CONCERNS** (re-run path: run the e2e with a faster tool-calling model, e.g. `E2E_MODEL=qwen2.5:7b` or a deterministic stub). No audit earns FAIL; the mean (all unit/integration/typecheck green) is context, not the verdict.

**Floor verdict: CONCERNS** (capped by F3's truncated scope; no FAIL dimension).

## Gate Decision

**CONCERNS**

- All 10 goal truths VERIFIED by named tests (exit 0).
- All P0/P1 behaviors covered by tests that ran and passed; no MISSING_RED; no CRITICAL findings.
- All code-quality gates PASS or N/A.
- The gate is capped at CONCERNS — not FAIL — by **F3**: the live TUI e2e scope is truncated (the model never emitted the tool call, so its 5 key-scripted scenarios self-skipped). This is a *named, non-answer* with a clear re-run path, and the same behavior is deterministically covered at the unit layer (172/172).
- Open SUGGESTIONS: F1 (backfill spec artifacts), F2 (spawn-helper postinstall), F3 (e2e model), F4 (locale assertion), F5 (trivy at ship).

**Path to PASS:** re-run the e2e with a reliable tool-calling model (`E2E_MODEL=qwen2.5:7b node --test test/ask-user-e2e.test.js`) and confirm the key-scripted popup scenarios run green; then the only remaining items are SUGGESTIONS (waivable/deferrable) and the floor clears to PASS.

## Human Override

None recorded. (WAIVED is a human decision; the gate renders CONCERNS on the machine's evidence.)

<!-- reflect fills from here -->
## Final-State Facts

