# Tasks: 001-ask-user

> **STATUS:** `in-progress` — 0/3 steps PASS
>
> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (or simple-execution) to implement step-by-step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** skill-pi ships a bundled `ask_user` tool so the agent can pause and collect one focused decision (2–5 options, multi-select, freeform) or a batch of 2–4 independent decisions with a review page, in TUI and RPC modes.

**Architecture:** One self-contained TypeScript extension registers a single `ask_user` tool; `execute()` branches on `ctx.mode` (TUI popup via `ctx.ui.custom` vs RPC dialogs via `ctx.ui.select`/`ctx.ui.input`) and funnels both into one result builder so `details` shapes are identical across modes. See `change.md` Architecture decisions.

**Tech Stack:** Node.js 22 ESM, TypeScript, `@earendil-works/pi-coding-agent` 1.2.0 extension API, TypeBox, `node-pty` (E2E), local Ollama (E2E model)

**Spec:** `.skillgrid/specs/2026-10-13-ask-user/change.md`

**Acceptance:** `.skillgrid/specs/2026-10-13-ask-user/acceptance.feature` (`@step-NN`)

---

## Goal

A `skill-pi` session can call `ask_user`: the user answers one question or a batch (with review page) in a TUI popup or RPC dialogs, and the agent receives a structured answer — selection(s), freeform text, or cancellation — reconstructible from the tool result's `details`.

## Out of scope / Non-Goals

- Searchable option filter (pi-ask-user feature; deferred)
- Overlay/inline display-mode toggle key and context-collapse UI; deferred
- Optional comment/extra-context row (`allowComment`); deferred
- Auto-dismiss timeout parameter; deferred
- Per-user env-var defaults (`PI_ASK_USER_*`); deferred
- Bundled `ask-user` skill (SKILL.md); deferred
- Windows support for the PTY-based E2E test (Linux `node-pty` only)
- No changes to `bin/`, `lib/`, or the pi wrapper

## Definition of Done

Change is done only when **all** of the following are true:

- [ ] Every success criterion in `change.md` `## Definition of Done` is met
- [ ] Every `@step-NN` Feature in `acceptance.feature` has passing `@happy`, `@edge`, and `@failure` scenarios
- [ ] Every step below has Verdict `PASS` or `PASS WITH WARNINGS`
- [ ] No unchecked `- [ ]` under any `### Tasks`
- [ ] No **Global Constraint** violated
- [ ] Rollback path in `change.md` is still valid
- [ ] `## State` status is `done` (set at archive gate)

## Global Constraints

- No comments in code unless asked (repo convention); keep changes minimal and scoped
- Verify before claiming: run the tests, read the output, then report
- Tool name `ask_user` is exclusive — no other bundled extension may register the same name
- Cancellation is not an answer: cancelled single → `answer: null`; cancelled batch cancels every question
- Multi-select never commits a partial selection silently — only explicit Done (or all options on) commits
- Exactly one of `question` / `questions` per call; 2–5 options per question; 2–4 questions per batch
- Non-interactive modes without dialog-capable UI return a graceful "unavailable" result — never a hang, never a throw
- E2E must never fail the suite when Ollama is unreachable or `node-pty` fails to load — skip with a reason
- Do not touch `bin/`, `lib/`, or `extensions/skill-pi-banner.ts`
- Base path: repo root `/data/git/AI/skill-pi`; extensions under `extensions/`, tests under `test/`

---

## State

```yaml
phase: spec
current_step: 01-tool-contract
status: in_progress
updated: 2026-10-13T00:00:00Z
```

## Step map

| NN | Step | Tag | Blocked by | Acceptance |
|----|------|-----|------------|------------|
| 01 | `tool-contract` | `@step-01` | — | Feature tagged `@step-01` |
| 02 | `tui-interaction` | `@step-02` | 01 | Feature tagged `@step-02` |
| 03 | `e2e-harness` | `@step-03` | 01, 02 | Feature tagged `@step-03` |

## Review workload (change-level)

| Field | Value |
|-------|-------|
| Estimated changed lines (change) | ~900 (extension ~550, unit tests ~200, E2E ~200, docs/config ~50) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

---

## 01-tool-contract

### Goal

The `ask_user` tool exists and its full contract surface is proven by unit tests against a mocked ctx: registration, schema + runtime validation, result `details` shapes (single + batch), RPC dialog fallback, renders, prompt text, events, and manifest registration. The TUI popup is out (lands in 02); `execute()` in TUI mode may return a placeholder until step 02.

### Out of scope / Non-Goals

- The TUI popup component (render/handleInput) — step 02
- E2E automation — step 03
- Deferred features (search, comments, timeouts, env defaults, skill)

### Definition of Done

This step is done only when:

- [ ] All `### Tasks` checkboxes below are `[x]`
- [ ] All `@step-01` scenarios in `acceptance.feature` pass
- [ ] `### Verification` Verdict is `PASS` or `PASS WITH WARNINGS`
- [ ] Produces contracts listed under Interfaces are available to dependents
- [ ] No Global Constraint violated

> Depends on: none

**Files:**
- Create: `extensions/ask-user.ts`
- Modify: `extensions/package.json`
- Modify: `package.json`
- Modify: `README.md`
- Create: `test/ask-user.test.js`

**Interfaces:**
- Consumes: none (first step)
- Produces: `ask_user` tool (name, params schema, `details` shapes), RPC fallback path, result builder, `ask:answered`/`ask:cancelled` events — step 02 builds the TUI branch on top; step 03 drives the real tool end-to-end

### Tasks

- [ ] 01.1 `[RED]` Validation: both/neither `question`+`questions` and out-of-bounds option counts produce error results
  - [ ] 01.1.a Write failing tests: Scenario "Validation rejects conflicting or missing question parameters"; Scenario "Validation rejects out-of-bounds option counts"; Scenario "Validation rejects oversized batches"
  - [ ] 01.1.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.1.c Minimal implementation: tool registration + TypeBox flat schema + runtime validation returning `isError` results naming the fix
  - [ ] 01.1.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.1.e Commit — `feat(ask-user): tool registration with schema and runtime validation`
- [ ] 01.2 `[RED]` Single-question result contract: selection, freeform, cancel via RPC dialogs
  - [ ] 01.2.a Write failing tests: Scenario "Single question selection returns structured details"; Scenario "Single question freeform returns structured details"; Scenario "Dialog cancellation returns cancelled with no answer"
  - [ ] 01.2.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.2.c Minimal implementation: RPC fallback (`ctx.ui.select` + `ctx.ui.input`) + single-question result builder producing `{question, context?, options, answer, cancelled}`
  - [ ] 01.2.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.2.e Commit — `feat(ask-user): single-question result contract with RPC dialog fallback`
- [ ] 01.3 `[RED]` Multi-select commits only on explicit Done; round-cap cancel
  - [ ] 01.3.a Write failing tests: Scenario "Multi-select commits the explicit selection on Done"; Scenario "Multi-select round cap without Done cancels without partial commit"
  - [ ] 01.3.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.3.c Minimal implementation: bounded toggle-round loop (cap `max(32, options.length + 2)`), Done (or all-on) commits, cap-exhaustion cancels
  - [ ] 01.3.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.3.e Commit — `feat(ask-user): bounded multi-select toggle rounds`
- [ ] 01.4 `[RED]` Batch contract: index-aligned answers, cancel-any-cancels-all
  - [ ] 01.4.a Write failing tests: Scenario "Batch of two returns index-aligned answers"; Scenario "Cancelling any batch question cancels the whole batch"
  - [ ] 01.4.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.4.c Minimal implementation: batch loop over questions (RPC dialogs) + batch result builder `{kind:"batch", questions, answers, cancelled}`
  - [ ] 01.4.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.4.e Commit — `feat(ask-user): batch result contract with cancel-any-cancels-all`
- [ ] 01.5 `[RED]` Unavailable-mode graceful result (no hang, no throw)
  - [ ] 01.5.a Write failing test: Scenario "Non-dialog mode returns a graceful unavailable result"
  - [ ] 01.5.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.5.c Minimal implementation: mode/hasUI guard returning an unavailable result (`cancelled: true`, clear text)
  - [ ] 01.5.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.5.e Commit — `feat(ask-user): graceful unavailable result for non-dialog modes`
- [ ] 01.6 `[RED]` Events fire exactly once per resolved call
  - [ ] 01.6.a Write failing tests: Scenario "Answer outcome emits the answered event once"; Scenario "Cancellation emits the cancelled event once"
  - [ ] 01.6.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.6.c Minimal implementation: `pi.events.emit("ask:answered" | "ask:cancelled", …)` in the single resolve path
  - [ ] 01.6.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.6.e Commit — `feat(ask-user): answered/cancelled outcome events`
- [ ] 01.7 `[RED]` Renderers and prompt text
  - [ ] 01.7.a Write failing tests: Scenario "Render call summarizes question and options"; Scenario "Render result shows success or cancelled rows"; Scenario "Prompt guidelines steer the model to focused questions"
  - [ ] 01.7.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 01.7.c Minimal implementation: `renderCall` (≤120-char summary for batches), `renderResult` (`✓ …` / warning), `promptSnippet` + `promptGuidelines`
  - [ ] 01.7.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 01.7.e Commit — `feat(ask-user): tool renders and prompt guidance`
- [ ] 01.8 `[AFK]` Manifest registration + wrapper still starts + README docs — `Run: npm test` — Expected: PASS
  - [ ] 01.8.a Add `./ask-user.ts` to `pi.extensions` in `extensions/package.json`
  - [ ] 01.8.b Add `node-pty` to `devDependencies` in `package.json` and install
  - [ ] 01.8.c Document `ask_user` under a "Bundled extensions" section in `README.md`
  - [ ] 01.8.d Verify existing suite green: `Run: npm test` — Expected: PASS
  - [ ] 01.8.e Commit — `feat(ask-user): register bundled extension and document it`

### Verification

Verdict: `PENDING`  <!-- PASS | PASS WITH WARNINGS | FAIL -->

Evidence:

| Check | Run | Expected | Result | Notes |
|-------|-----|----------|--------|-------|
| Focused test | `node --test test/ask-user.test.js` | PASS | | |
| Acceptance `@step-01` / `@p0` | `node --test test/ask-user.test.js` | PASS | | |
| Runtime harness | `npm test` | PASS | | |
| Rollback boundary | remove `./ask-user.ts` from `extensions/package.json`, `Run: npm test` | PASS | | one-line rollback |
| Global Constraints | — | held | | |

### Commit

When step DoD is met: `feat(ask-user): tool contract — schema, details, renders, events, RPC fallback`

---

## 02-tui-interaction

### Goal

The TUI popup delivers the interactive experience in a real TUI session: single-select with arrow/number navigation, multi-select toggle rows, inline freeform editor, and the paged batch view with review page — all returning the same `details` shapes as step 01.

### Out of scope / Non-Goals

- E2E automation of the popup — step 03
- Search filter, comments, overlay toggle, timeouts, context collapse (deferred)

### Definition of Done

This step is done only when:

- [ ] All `### Tasks` checkboxes below are `[x]`
- [ ] All `@step-02` scenarios in `acceptance.feature` pass (live TUI, manual or scripted)
- [ ] `### Verification` Verdict is `PASS` or `PASS WITH WARNINGS`
- [ ] Depends-on step(s) already PASS / PASS WITH WARNINGS
- [ ] No Global Constraint violated

> Depends on: 01-tool-contract

**Files:**
- Modify: `extensions/ask-user.ts`
- Modify: `test/ask-user.test.js`

**Interfaces:**
- Consumes: tool registration, result builder, validation from 01
- Produces: TUI popup component (single/batch/multi-select/freeform) — step 03 drives it through a PTY

### Tasks

- [ ] 02.1 `[RED]` TUI single-select popup: navigate, confirm, result row
  - [ ] 02.1.a Write failing tests (mock `ctx.ui.custom` capturing the component; drive `render`/`handleInput`): Scenario "TUI single-select popup confirms a focused option"; Scenario "TUI popup number keys jump to an option"
  - [ ] 02.1.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 02.1.c Minimal implementation: TUI branch of `execute()` building the popup component (question, numbered options + descriptions, footer hint)
  - [ ] 02.1.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.1.e Commit — `feat(ask-user): TUI single-select popup`
- [ ] 02.2 `[RED]` TUI freeform editor
  - [ ] 02.2.a Write failing tests: Scenario "TUI freeform editor submits non-empty text"; Scenario "TUI freeform Esc returns to options without answering"
  - [ ] 02.2.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 02.2.c Minimal implementation: "✎ Type something…" row (when `allowFreeform !== false`), inline editor mode, submit/cancel semantics
  - [ ] 02.2.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.2.e Commit — `feat(ask-user): TUI freeform editor`
- [ ] 02.3 `[RED]` TUI Esc cancels; abort signal dismisses
  - [ ] 02.3.a Write failing tests: Scenario "TUI Esc cancels the prompt with cancelled details"; Scenario "Aborting the agent dismisses the open prompt"
  - [ ] 02.3.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 02.3.c Minimal implementation: Esc handling → `cancelled: true`; `ctx.signal` abort listener → dismiss + cancel result
  - [ ] 02.3.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.3.e Commit — `feat(ask-user): TUI cancel and abort dismissal`
- [ ] 02.4 `[RED]` TUI multi-select toggle rows
  - [ ] 02.4.a Write failing tests: Scenario "TUI multi-select commits the selected set on Done"; Scenario "TUI multi-select toggling is reversible before Done"
  - [ ] 02.4.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 02.4.c Minimal implementation: `[ ]`/`[x]` toggle rows + Done row; commit on Done or all-on
  - [ ] 02.4.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.4.e Commit — `feat(ask-user): TUI multi-select toggle rows`
- [ ] 02.5 `[RED]` TUI batch pages + review page
  - [ ] 02.5.a Write failing tests: Scenario "TUI batch switches pages without losing answers"; Scenario "TUI review page warns then submits with skips"
  - [ ] 02.5.b Run to confirm fail — `Run: node --test test/ask-user.test.js` — Expected: FAIL
  - [ ] 02.5.c Minimal implementation: paged view (tab/shift+tab), review page with per-question answers/"skipped" + number-key jump-back, warn-once then submit
  - [ ] 02.5.d Run to confirm pass — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.5.e Commit — `feat(ask-user): TUI batch pages and review page`
- [ ] 02.6 `[AFK]` Same `details` shapes across TUI and RPC — `Run: node --test test/ask-user.test.js` — Expected: PASS
  - [ ] 02.6.a Add parity assertions: TUI-driven component results equal the RPC-fallback `details` for selection / freeform / cancel / multi / batch
  - [ ] 02.6.b Commit — `test(ask-user): TUI/RPC details parity assertions`
- [ ] 02.7 `[AFK]` Live TUI smoke (manual): start `skill-pi`, trigger `ask_user`, exercise single/freeform/multi/batch/Esc — `Run: node bin/skill-pi.js` (manual) — Expected: PASS
  - [ ] 02.7.a Record observations in Verification notes
  - [ ] 02.7.b Commit if fixes needed — `fix(ask-user): TUI interaction fixes from live smoke`

### Verification

Verdict: `PENDING`

Evidence:

| Check | Run | Expected | Result | Notes |
|-------|-----|----------|--------|-------|
| Focused test | `node --test test/ask-user.test.js` | PASS | | |
| Acceptance `@step-02` / `@p0` | live TUI session, scripted or manual | PASS | | |
| Runtime harness | `npm test` | PASS | | |
| Rollback boundary | revert 02 commits, `Run: npm test` | PASS | | TUI branch removed, RPC fallback remains |
| Global Constraints | — | held | | |

### Commit

When step DoD is met: `feat(ask-user): TUI popup — single, multi-select, freeform, batch review`

---

## 03-e2e-harness

### Goal

`npm test` proves the real product: a real `skill-pi` process in a `node-pty` PTY, a real local Ollama model, scripted keystrokes, asserted result rows — and skips cleanly (never fails) when Ollama or `node-pty` is unavailable.

### Out of scope / Non-Goals

- CI configuration beyond a clean skip
- Non-Linux PTY support
- Batch E2E is best-effort (small models may not emit a batch call); it must skip on flake, not fail

### Definition of Done

This step is done only when:

- [ ] All `### Tasks` checkboxes below are `[x]`
- [ ] All `@step-03` scenarios in `acceptance.feature` pass with Ollama up, and skip (not fail) without it
- [ ] `### Verification` Verdict is `PASS` or `PASS WITH WARNINGS`
- [ ] Depends-on step(s) already PASS / PASS WITH WARNINGS
- [ ] No Global Constraint violated

> Depends on: 01-tool-contract, 02-tui-interaction

**Files:**
- Create: `test/ask-user-e2e.test.js`
- Modify: `package.json` (only if E2E env/timeout config is needed)

**Interfaces:**
- Consumes: the real `ask_user` tool from 01/02; repo wrapper `bin/skill-pi.js`
- Produces: a repeatable E2E gate for future ask-user changes

### Tasks

- [ ] 03.1 `[RED]` Threat: harness teardown — kill child + remove temp agent dir without leaks
  - [ ] 03.1.a Write failing test: Scenario "E2E harness cleans up the child process and temp agent dir" — given the child hangs or exits early, assert no lingering `skill-pi` process and no leftover temp dir after the test
  - [ ] 03.1.b Run to confirm fail — `Run: node --test test/ask-user-e2e.test.js` — Expected: FAIL
  - [ ] 03.1.c Minimal implementation: harness scaffold (spawn via `node-pty`, temp agent dir with `models.json` pointing at Ollama, deterministic prompt, output buffer, bounded wait, `finally` kill + `rm` temp dir)
  - [ ] 03.1.d Run to confirm pass — `Run: node --test test/ask-user-e2e.test.js` — Expected: PASS
  - [ ] 03.1.e Commit — `test(ask-user): PTY E2E harness with guaranteed teardown`
- [ ] 03.2 `[RED]` Threat: Ollama unreachable → skip, never fail or hang
  - [ ] 03.2.a Write failing test: Scenario "E2E skips cleanly when Ollama is unreachable" — given `http://localhost:11434` not listening, every E2E scenario skips with a reason (same for `node-pty` load failure via dynamic import)
  - [ ] 03.2.b Run to confirm fail — `Run: node --test test/ask-user-e2e.test.js` — Expected: FAIL
  - [ ] 03.2.c Minimal implementation: preflight (`fetch` Ollama health endpoint, dynamic `import("node-pty")`) → `t.skip()`
  - [ ] 03.2.d Run to confirm pass — `Run: node --test test/ask-user-e2e.test.js` — Expected: PASS (skips)
  - [ ] 03.2.e Commit — `test(ask-user): E2E graceful skip without Ollama or node-pty`
- [ ] 03.3 `[RED]` E2E selection via PTY keys
  - [ ] 03.3.a Write failing test: Scenario "E2E selection renders the success result row" — deterministic prompt, wait for popup (option labels visible), send `↓\r`, assert `✓ 2. <label>` row
  - [ ] 03.3.b Run to confirm fail — `Run: node --test test/ask-user-e2e.test.js` — Expected: FAIL
  - [ ] 03.3.c Minimal implementation: scripted single-select flow
  - [ ] 03.3.d Run to confirm pass — `Run: node --test test/ask-user-e2e.test.js` — Expected: PASS (Ollama up)
  - [ ] 03.3.e Commit — `test(ask-user): E2E single-select flow`
- [ ] 03.4 `[RED]` E2E freeform + Esc
  - [ ] 03.4.a Write failing tests: Scenario "E2E freeform renders the custom answer row"; Scenario "E2E Esc renders the cancelled row"
  - [ ] 03.4.b Run to confirm fail — `Run: node --test test/ask-user-e2e.test.js` — Expected: FAIL
  - [ ] 03.4.c Minimal implementation: scripted freeform (navigate to "Type something…", type text, Enter) and Esc flow
  - [ ] 03.4.d Run to confirm pass — `Run: node --test test/ask-user-e2e.test.js` — Expected: PASS (Ollama up)
  - [ ] 03.4.e Commit — `test(ask-user): E2E freeform and cancel flows`
- [ ] 03.5 `[RED]` E2E batch (best-effort)
  - [ ] 03.5.a Write failing test: Scenario "E2E batch review submits index-aligned answers" — prompt the model for a 2-question batch, wait for page 1, tab to review, Enter (twice if warn), assert both answer rows render
  - [ ] 03.5.b Run to confirm fail — `Run: node --test test/ask-user-e2e.test.js` — Expected: FAIL
  - [ ] 03.5.c Minimal implementation: scripted batch flow; if the model does not emit a batch call within the timeout, `t.skip()` with reason (flake guard, not failure)
  - [ ] 03.5.d Run to confirm pass — `Run: node --test test/ask-user-e2e.test.js` — Expected: PASS or skip
  - [ ] 03.5.e Commit — `test(ask-user): E2E batch flow (best-effort)`
- [ ] 03.6 `[AFK]` Full suite green — `Run: npm test` — Expected: PASS
  - [ ] 03.6.a Verify existing tests plus new E2E all green (or cleanly skipped)
  - [ ] 03.6.b Commit if fixes needed — `fix(ask-user): E2E stability fixes`

### Verification

Verdict: `PENDING`

Evidence:

| Check | Run | Expected | Result | Notes |
|-------|-----|----------|--------|-------|
| Focused test | `node --test test/ask-user-e2e.test.js` | PASS (or skip with reason) | | |
| Acceptance `@step-03` / `@p0` | `node --test test/ask-user-e2e.test.js` (Ollama up) | PASS | | |
| Runtime harness | `npm test` | PASS | | |
| Rollback boundary | remove `test/ask-user-e2e.test.js` from test glob, `Run: npm test` | PASS | | unit suite unaffected |
| Global Constraints | — | held | | |

### Commit

When step DoD is met: `test(ask-user): PTY E2E against local Ollama with graceful skip`

---

## Archive gate checklist

- [ ] Change-level **Definition of Done** fully checked
- [ ] No unchecked `- [ ]` under any `### Tasks`
- [ ] Every step Verdict is `PASS` or `PASS WITH WARNINGS`
- [ ] No Global Constraint violated
- [ ] `## State` status is `done` and phase is `archive` (set by verify/archive)
- [ ] STATUS banner updated to `complete`
