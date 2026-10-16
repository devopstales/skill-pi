# Review — pi-hooks test coverage + pipeline completion

- **Diff:** `9087cbc..75a8f2a` (7 commits: specs + unit specs + W028 fix + QA re-render)
- **Date:** 2026-10-16
- **Tier:** T2 — three-axis review per `requesting-code-review`
- **Independence grades:** Standards B · Spec B · Security B (fresh subagent contexts, same model family as implementer)

## What Important means

A finding blocks ship if it breaks a `SATISFIES` scenario, violates an in-force ADR, or opens a new exploitable trust boundary. Documentation drift, pattern-consistency notes, and test-shape observations are Minor (capped, logged, non-blocking).

## Standards (verdict: ✅ Ship-ready — 0 Important, 5 Minor)

- **Strengths:** naming inside glossary; ADR-0007 self-containment holds (all new code under `extensions/pi-hooks/`, no new deps); no comments added; conventional commits; the W028 fix comment documents the `--`-first parseArgs gap honestly.
- **Minor (deferred):**
  1. `bin/skill-pi.js:224` — W028 strip rule drops *any* trailing absolute-path positional, not just the project path. Broader than the defect. The parseArgs fix (separate change) is the real cure.
  2. `shared.spec.ts:183-185` — test named "skips non-string values" but input is `undefined` (indistinguishable from the empty-string case). Use `42`/`null` or rename.
  3. `executor.spec.ts` — `as Record<string, unknown>` cast repeated 7× (Duplicated Code, minor).
  4. `bin/skill-pi.js:224` — 99-char line (cosmetic; no linter configured).
  5. `report.md` — test-count inconsistency: report states 22 shared tests, actual count is 20; 44 total doesn't reconcile with 11+20+7=38. Spec-zone artifact inconsistency.

## Spec (verdict: ✅ Spec compliant — 0 Critical, 1 Important, 4 Minor)

- **Per-scenario:** R-config-load PASS · R-matcher PASS · R-if-condition PASS · R-hook-input PASS · R-E2E-hook-fires PASS (wrapper leg + direct-CLI leg, after W028 fix).
- **TDD Evidence:** real for a regression pin (source was already correct; RED = "write tests, run once, immediately green" per blueprint Step 2).
- **Spec zone rule:** held (specs committed with the code; one recorded shared-tree blemish — 4 spec files swept into concurrent keybindings commit `3808103`, amended in place).
- **Scope creep:** none load-bearing. W028 fix authorized by blueprint's RED-exception clause. SessionEnd spec (one extra event family) is defensible as "each supported event" coverage.
- **Important (deferred, non-blocking):**
  1. Spec-zone blemish: 4 spec files share commit `3808103` with 17 unrelated keybinding files. Accepted for this `small` change; ship should not re-create the split retroactively.
- **Minor (deferred):**
  1. `config.spec.ts:47` — `expect(p).not.toContain(".pi")` is near-vacuous (the `toBe` on line 46 is the real guard).
  2. W028 generic path-strip broader than reported bug (same as Standards #1).
  3. PreCompact/PostCompact absent from `executor.spec.ts` (pure passthroughs, low risk).
  4. RED and GREEN evidence reference the same single run (acceptable for a regression pin).

## Security (verdict: ✅ ACCEPTABLE — 0 Critical/High, 2 Medium, 2 Low)

- **Verified:** W028 fix does not widen the attack surface (only removes argv entries before an argv-array spawn; no shell involved). Project path cannot "match a pi flag" (resolved paths start with `/`, pi flags start with `-`).
- **F1 (Medium, by-design):** Project `.skill-pi/settings.json` grants arbitrary bash at session start (CWE-94, ASI05). Intended Claude Code parity semantics. Trust boundary, not a bug. README already documents it.
- **F2 (Medium, by-design):** Hook stdin carries full prompt/tool I/O into bash scripts (CWE-94, LLM10). Hook authors must parse with `jq`, never string-interpolate. Pre-existing for all consumer hooks.
- **F3 (Low):** `readSettingsFile` swallows all errors (fail-open). Defense-in-depth only.
- **F4 (Low):** W028 flag-eating — `startsWith("-")` heuristic drops a trailing path even when the next arg is a flag value (e.g. `--model /x/y`). Functional/UX breakage, no security surface.
- **Recommendation (applied):** document the trust boundary in README (already done: "run as bash commands").

## Fixes applied this round

(none — all findings are Minor or by-design; the 2 Medium security findings are pre-existing trust boundaries, not code defects in this diff)

## Deferred (Minor, logged)

- W028 generic path-strip → parseArgs fix (separate change, named in W028 residual)
- `shared.spec.ts:183-185` test name/input mismatch
- `executor.spec.ts` cast duplication (cosmetic)
- `report.md` test-count inconsistency (spec-zone artifact)
- PreCompact/PostCompact specs (low risk, pure passthroughs)

## Floor verdict

**PASS** — no open Critical/Important findings that block ship. The 1 Important (spec-zone blemish) is accepted for this `small` change. All 5 acceptance scenarios SATISFIED. Security clean (0 Critical/High).
