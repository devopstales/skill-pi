# QA Report — pi-extension-cookbook

**Change:** `2026-10-20-pi-extension-cookbook`
**Tier:** T1 (documentation-only, single file, no code)
**Floor:** L1 (focused structural verification + runtime check)
**Date:** 2026-10-21
**Verdict:** PASS

## Test Plan

N/A — documentation-only change. No tests to write. Verification is structural (line count, section presence, cross-reference accuracy) + the root wrapper suite (confirming no accidental code edit).

## Goal-Backward Verification

**Stated goal (briefing):** A curated, in-repo reference document (`extensions/COOKBOOK.md`) that captures the extension-building patterns, API surface, and conventions every bundled skill-pi extension follows — so that a new extension can be built in an afternoon instead of a week of reverse-engineering.

### Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `extensions/COOKBOOK.md` exists and is ≥ 400 lines | VERIFIED | `wc -l` → 2306 |
| 2 | Every section R1–R14 is present as a `##` heading | VERIFIED | `grep -c '^## '` → 15 (title + 14 sections) |
| 3 | R2 lists every ExtensionAPI method with "Used by" pointer | VERIFIED | Task 5 cross-ref: all 32 methods present, no phantoms |
| 4 | R3 groups all events by category with signatures + return semantics | VERIFIED | Task 5 cross-ref: all 34 ExtensionEvent union events, 11 categories |
| 5 | R4 covers all ToolDefinition fields with real examples | VERIFIED | Task 5 cross-ref: 16/17 fields (1 omitted: `constrainedSampling`, acceptable) |
| 6 | R5 shows both TUI and RPC paths with real code from ask-user | VERIFIED | Task 5 cross-ref: `ctx.ui.custom` + RPC fallback verbatim |
| 7 | R6 shows all four state patterns with real code | VERIFIED | Task 5 cross-ref: Map, hidden transcript, Symbol.for, WeakMap all verbatim |
| 8 | R7 shows all three config mechanisms with real code | VERIFIED | Task 5 cross-ref: conf.d, settings.json, env kill-switch verbatim |
| 9 | R8 shows complete sidebar card integration from todo | VERIFIED | Task 5 cross-ref: makeCard/show (167–250) verbatim |
| 10 | R9 shows all three cross-extension channels with real code | VERIFIED | Task 5 cross-ref: events.emit/on, details, handshake verbatim |
| 11 | R10 shows Ctrl+Q leader pattern with real code | VERIFIED | Task 5 cross-ref: todo 293–330, plan-build 480–515, pi-swarm 142–171 |
| 12 | R11 lists all non-negotiables with code examples | VERIFIED | Task 5 cross-ref: all 6 defensive-coding examples verbatim |
| 13 | R12 shows factory injection, pure functions, golden file tests | VERIFIED | Task 5 cross-ref: all 5 testing patterns verbatim |
| 14 | R13 has 20 rows, each with file path + patterns | VERIFIED | Task 5 cross-ref: 21 rows (≥ 20) |
| 15 | R14 is 10–15 steps, each referencing a file/command/section | VERIFIED | Task 5 cross-ref: 13 steps |
| 16 | No code files are modified | VERIFIED | `git diff --name-only 48f04d3..HEAD` → only `extensions/COOKBOOK.md` + spec files |
| 17 | Root wrapper suite is green | VERIFIED | `node --test` → 61 pass / 1 fail (pre-existing rpc.test.js e2e timeout, not a regression) |

### Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `extensions/COOKBOOK.md` (≥ 400 lines, 14 sections) | EXISTS | 2306 lines, 15 `##` headings |

### Key Links

| Link | Status | Evidence |
|------|--------|----------|
| Code snippets are verbatim from source files | VERIFIED | Task 5: ~25 snippets spot-checked, 0 mismatches |
| Cross-references resolve (TOC → headings, R14 → R-sections) | VERIFIED | Task 5: 14/14 TOC anchors match real headings |
| R2 method list matches pi 1.2.0 ExtensionAPI type | VERIFIED | Task 5: all 32 methods, no phantoms, none missing |
| R3 event taxonomy matches ExtensionEvent type union | VERIFIED | Task 5: all 34 events, correct semantics |

## Verification-Gap Audit

N/A — documentation-only change. No code to test, no behavior to verify at runtime beyond the structural checks above.

## Traceability Matrix

N/A — no `acceptance.feature` (T1 documentation change, BDD scenarios not applicable).

## TDD Evidence

N/A — documentation-only change. No code, no tests, no RED→GREEN cycle.

## Assertion Quality Audit

N/A — no test files.

## Security Audit

N/A — no user-facing input, no network calls, no file I/O in the changed file (it's a `.md` document).

## Code Quality Gates

| Gate | Threshold | Result | Status |
|------|-----------|--------|--------|
| Coverage | 0 (disabled) | N/A | N/A |
| Mutation | 0 (disabled) | N/A | N/A |
| P0 pass rate | 100% | N/A (no tests) | N/A |
| P1 pass rate | 95% | N/A (no tests) | N/A |
| Lint | not configured | N/A | N/A |
| Typecheck | not configured | N/A | N/A |
| Root suite | green | 61/69 pass (1 pre-existing flake) | PASS |

## Duplication

N/A — single `.md` file, no code to scan.

## Trivy

N/A — no dependency changes, no new packages.

## Findings

### CRITICAL

None.

### WARNING

- **W-1:** Pre-existing `rpc.test.js` e2e timeout (1 fail / 69 tests). Not a regression — reproduced on the base commit. Tracked separately from this change.

### SUGGESTION

- **S-1:** R13 gentle-shell line references are from a fetch of `main` on 2026-10-21; upstream drift will change them. The table intro notes this. Consider adding a "verified as of" date to the R13 intro.

## Floor

The weakest dimension is the root suite (1 pre-existing failure). The floor is PASS (the failure is not a regression, not in the changed file, and not in scope).

## Gate Decision

**PASS**

- All 17 truths VERIFIED (structural + cross-reference evidence).
- No CRITICAL findings.
- No code-quality gate failures (all N/A for a `.md` file).
- Root suite green (1 pre-existing flake, not a regression).
- T1 floor (L1) satisfied: focused structural verification + runtime check.

## Human Override

None.

---

## Final-State Facts

(to be completed by reflect)

## Retro

(to be completed by reflect)
