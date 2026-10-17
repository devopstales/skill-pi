# phase-3c-payload-split

## What was implemented

Split `extensions/pi-context-view/src/capture/payload.ts` (563L) into
`src/capture/parsers/` with one module per API, plus shared types, constants,
and helpers. `payload.ts` is now a 16-line re-export shim so no import site
(src/capture/guard.ts, tracker.ts, tools.ts; test/payload.test.ts,
hidden-tools.test.ts, dispatch-runtime.test.ts) needed a path change.

New files (all code moved verbatim from payload.ts, doc comments preserved):

- `src/capture/parsers/types.ts` (42L) — PayloadCopy, PayloadDeclaration, ParsedTools, ParsedMessages, Item
- `src/capture/parsers/constants.ts` (16L) — DEFERRED_PLACEHOLDER_NAME, CLAUDE_CODE_IDENTITY, COMPLETIONS_ROLES, ANTHROPIC_ROLES, SUPPORTED_APIS
- `src/capture/parsers/helpers.ts` (133L) — copyValue/copyPayload, hasWarmOutputLimit, addDeclaration, isDeclaration, BlockTypes, blockText, argumentsText, parsed, mismatch, messageMismatch, mismatchReason, unsupportedApiReason, isItem, isItemList, optionalItems
- `src/capture/parsers/openai-completions.ts` (104L) — isCompletionsPayload/Messages/Tool, completionsDeclarations/Units/Text, addCompletionsToolCalls
- `src/capture/parsers/openai-responses.ts` (97L) — isResponsesPayload/Input/Tool, isInlineResponsesTools, responsesDeclarations/Units/Part, RESPONSES_* tables
- `src/capture/parsers/anthropic.ts` (122L) — isAnthropicPayload/Messages, anthropicDeclarations/Units, addAnthropicBlock, applyAnthropicToolChange, ANTHROPIC_SKIPPED_BLOCKS
- `src/capture/parsers/index.ts` (101L) — dispatch: parsePayloadTools, parsePayloadMessages, PAYLOAD_SHAPE_CHECKS; re-exports all of the above
- `src/capture/parsers.ts` (17L) — facade re-export of `parsers/index.ts` (one more hop would have been a second facade; a single file with a folder of the same basename is a deliberate, documented pattern)
- `src/capture/payload.ts` (16L) — re-export shim of `parsers.ts`
- `test/parsers/split.test.ts` (36L) — verifies the API surface via `parsers.ts`, that `payload.ts` is a shim of it (identity of every export), and that the shared types resolve from `parsers/types.ts`

Docs updated: `doc/ARCHITECTURE.md` page table and `doc/architecture/payload-guard.md`
component table + message-channel section now name `src/capture/parsers.ts` /
`src/capture/parsers/`.

`test/run.ts` glob changed from `test/*.test.ts` to `test/**/*.test.ts` so
subdirectory test files run under `npm test` (RED was unrunnable with the old glob).

## Lazy (ladder verdict)

Rung: reuse. Zero new logic — every function is a verbatim move; the split
itself is the only production change. Nothing deleted or skipped; the full
version the task asked for was built (5 new modules + 2 facades + 1 shim).
No `ponytail:` ceiling comments.

## TDD Evidence

RED: `node test/run.ts test/parsers/split.test.ts` →
`SyntaxError: await isn't allowed in non-async function` (test syntax fix),
then `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
.../src/capture/parsers.ts` — expected, the module did not exist yet.
Also confirmed unrunnable under `npm test` before the run.ts glob fix
(723 tests, my 3 absent).

GREEN: after implementing the split — `npm run check` clean;
`node test/run.ts test/parsers/split.test.ts` → 3/3 pass;
`npm test` → 726/726 pass (final run), check clean.

BDD: this task carries no `SATISFIES:` scenario (refactor; no
acceptance.feature change). The scenario name is therefore the refactor's own
acceptance: existing payload behavior is unchanged, proven by the full
existing payload suite (723 tests incl. test/payload.test.ts) staying green,
plus the 3 new shim/surface tests.

## Gates

- G1 `cd extensions/pi-context-view && npm test` → exit 0, `pass 726 / fail 0` (726/726, output pristine)
- G2 `cd extensions/pi-context-view && npm run check` → exit 0, no errors

## Checkpoint

Commit 386ad51 `refactor: split payload.ts into per-API parsers`, body:

```
[skillgrid-context]
Task: phase-3c-payload-split
Decisions: keep payload.ts as re-export shim to avoid touching all import sites
Remaining: none
Tried: none
[/skillgrid-context]
```

## Refinement (4-pass)

- Pass 1: full deliverable — 9 new source/test files, 2 docs, run.ts glob, all tests green.
- Pass 2: re-read every new file as an expert — names/structure match the task's table exactly; verified the dependency graph is acyclic (constants ← helpers ← per-API ← index; facades sit above); all original doc comments preserved verbatim.
- Pass 3: defect hunt — caught one: my test used `await` in a non-async callback (fixed in RED). Verified `BlockTypes` export path (helpers, not types) after the first tsc error. Verified the undefined-as-error-channel pattern is untouched (anthropicDeclarations still returns `undefined`; dispatch in index.ts unchanged). Verified `Item`'s export (was module-private in payload.ts; now exported from types.ts, required by per-API type predicates). Confirmed the one full-suite failure (`demo-mock: --mock --local`) is pre-existing and environmental: it fails identically on the unmodified baseline (stash + run: 1 fail there too) and passes isolated; it is a 16s child-process npm test flaky under full-suite concurrency.
- Pass 4: polish — none needed (tabs, comment hygiene consistent with the codebase). Final pass 2→4 clean.

## Files changed

- A src/capture/parsers/{types,constants,helpers,openai-completions,openai-responses,anthropic,index}.ts
- A src/capture/parsers.ts
- M src/capture/payload.ts (563L → 16L shim)
- A test/parsers/split.test.ts
- M test/run.ts (glob test/*.test.ts → test/**/*.test.ts)
- M doc/ARCHITECTURE.md, doc/architecture/payload-guard.md (page/module names)

## Self-review findings / concerns

- Pre-existing flake (not caused by this change): `demo-mock --mock --local
  skips missing npm packages without installing them` fails intermittently in
  the fully concurrent suite (failed 3 of 6 full runs, including the unmodified
  baseline; always passes isolated). 16s child-process test with a fake npm
  binary; looks like a timing/environment flake under 726-way concurrency.
- `test/run.ts` glob now matches any depth under test/ — a new pattern for this
  extension's suite; worth knowing if more subdirs appear.
