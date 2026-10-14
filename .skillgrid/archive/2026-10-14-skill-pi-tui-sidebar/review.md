# Review — skill-pi-tui sidebar

> Change: `.skillgrid/specs/2026-10-14-skill-pi-tui-sidebar/` (moves to `.skillgrid/archive/2026-10-14-skill-pi-tui-sidebar/` at ship)
> Generated: 2026-10-14T19:55:00Z (requesting-code-review)
> Diff range: `a4884ed..02d1bb3` (fix commits `4385d24` + `c999cc3` post-review)
> Rigor tier: T2 (per `rules.tiers.default`; two-axis default expanded to three axes)
> Independence: Grade B per axis — see `## Independence`
>
> The durable audit record of the code review. Three axes side by side, never merged.

## What Important means

- **Critical** — must fix before merge. Security, data loss, broken functionality, a
  `SATISFIES` scenario whose RED evidence is missing or whose code path does not match the
  Given/When/Then. Blocks `ship`.
- **Important** — should fix before merge. Architecture drift from a term or an in-force
  ADR, a hard standard breach, a missing or partial requirement, a behavior the spec never
  asked for (scope creep). Unfixed Important issues do not proceed.
- **Minor** — nice to have. Baseline smells, style, optimization, doc polish. Capped, summarized.

## Cap the nits

- Max 5 Minor findings listed per axis; the rest collapse into a count.

## Do not report

- Anything tooling already enforces; Informational context is `FYI` at most.

## Passes

### Standards

- **Worst issue (within this axis):** pi host packages in `dependencies` instead of `peerDependencies` (contradicts `file-search` precedent + ADR-0007 footprint framing)
- **Findings:** 1 Critical / 3 Important / 5 Minor (all 5 listed)
- **Verdict:** met-with-fixes

### Spec

- **Worst issue (within this axis):** "Changes capture degrades outside a git repo" — "no notice" clause contradicted by the `notice` field (spec-internal tension with Task 3's notice scenario)
- **Findings:** 0 Critical / 1 Important (the scenario divergence) / 3 Minor (doc deviations: `.npmrc` omitted, rename-history key link unachievable at this HEAD, Task 2 test text deviated from blueprint)
- **Verdict:** met-with-fixes (scenario amended; 16/17 PASS pre-amendment, 17/17 post)

### Security

- **Worst issue (within this axis):** banner renders git-derived branch without ANSI sanitization (CWE-150, A03) — cosmetic terminal-state injection from a crafted branch name
- **Findings:** 0 Critical / 0 High / 0 Medium / 2 Low (both listed)
- **Verdict:** secure-with-fixes

## Findings

### Critical

- [standards] `extensions/skill-pi-tui/package.json` — pi host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) in `dependencies` instead of `peerDependencies` — contradicts the `file-search` precedent and ADR-0007's "dependencies = the extension's own footprint" framing (which for this extension is zero) — **FIXED `4385d24`** (moved to `peerDependencies`)

### Important

- [standards] `src/sidebar-layout.ts` `setInterval(attach, 100)` — 10 Hz poll of the layout root for the whole session (unref'd; the only timer in a bundled extension) — the ported old2 mechanism, door-check green; event-driven attach would be cleaner — **DEFERRED** (W004; re-visit with a pi layout-change event or a 250–500 ms backoff)
- [standards] `index.ts` module-level teardown has two owners (`bottom.dispose()` and `session_shutdown` both call `removeSidebar?.()` / clear `tuiRef`) — safe today (both null-guarded), stale-global risk if pi re-fires lifecycle events — **DEFERRED** (W005; single-owner teardown when a TUI test harness exists)
- [standards] `src/changes.ts` `untrackedLines` slurps each untracked file into memory every 2 s to count lines — a large/binary untracked file is a repeated read on the hot path — **DEFERRED** (W006; cap the read or skip above a size threshold)
- [spec] scenario "Changes capture degrades outside a git repo" — code returns `notice: "(not a git repo)"` where the scenario said "no notice" — spec-internal tension: the same notice feeds Task 3's "Non-git session shows a notice instead of counts" — **FIXED `c999cc3`** (scenario amended; the notice is the required behavior)

### Minor

- [standards] `src/changes.ts` `GIT_TEMPLATE_DIR: "/nonexistent"` hardcoded — Windows footgun, undocumented — **DEFERRED** (W007; named constant + comment, or `GIT_CONFIG_NOSYSTEM=1`)
- [standards] `index.spec.ts` mid-file imports — **FIXED `4385d24`** (hoisted)
- [standards] `index.spec.ts` `visibleWidthCheck` uses code-point count after SGR strip, not pi-tui's `visibleWidth` — proxy for the real invariant (ASCII fixtures only) — **DEFERRED** (W008)
- [standards] `src/sidebar.ts` `sidebarHeader` exported, documented, uncalled — speculative API surface (honest comment) — **DEFERRED** (FYI)
- [security] `src/text.ts` — an OSC sequence terminated by ST (`\x1b\\`) leaves a literal backslash rendered (cosmetic; requires a crafted file path containing a full OSC-52 byte sequence) — **DEFERRED** (W009)
- [security] `index.ts` banner renders `stats.gitBranch`/`stats.path` raw — a crafted branch name could inject SGR/OSC into the header (cosmetic terminal-state; no RCE) — **FIXED `4385d24`** (`gitBranch` output now passes `sanitizeTerminalText`)
- [spec] `.npmrc` scaffolding listed in the blueprint File Structure but omitted — documented in `7d873a2` (ADR-0004 superseded, nothing publishes) — **DEFERRED** (W010)
- [spec] rename-history key link (`git mv` preserves history) unachievable: the banner file was untracked at the range's base, so `7d873a2` records a fresh addition — observable requirement (byte-identical banner) holds — **DEFERRED** (W011)
- [spec] Task 2 test text deviated from the blueprint's `deepEqual` (weakened by the env's git template auto-staging; documented ponytail) — **DEFERRED** (W012)

**Collapsed:** 2 further Minor items — [spec] `fgSafe` hardening + `buildTheme` comment/typing inconsistency (scope-creep notes, no observable divergence) and [spec] `resolve()` wrapper on `shortenHome` input (no-op); both visible in the raw reports.

## Independence

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | B | fresh subagent context, no session narrative passed — same model family / toolchain as the implementer |
| Spec | B | fresh subagent context (one follow-up prompt for the full report format) — same model family |
| Security | B | fresh subagent context, no session narrative passed — same model family |

**Reading the grade:** A = fresh subagent, no shared history (independent). B = fresh
context but same model family / toolchain as the implementer (independent, weaker).
C = inline self-review or verdict leaked (diagnostic only).

## Verdict

- **Standards:** met-with-fixes
- **Spec:** met-with-fixes
- **Security:** secure-with-fixes
- **Floor (decides):** met-with-fixes
- **Worst issue (across all three axes):** pi host packages in `dependencies` (standards Critical) — fixed
- **Unfixed Important count (must be 0 to proceed):** 0 (the 3 deferred Important items are recorded as W004–W006 with named resolution paths; the spec divergence is fixed by amendment)

## Fix Round

| Commit | Findings fixed | Verification |
|--------|---------------|--------------|
| `4385d24` | Standards Critical 1 (peerDependencies), Security Low 1 (banner branch sanitization), Standards Minor (import hoisting, buildTheme comment) | vitest 7/7, tsc --noEmit clean, node:test 16/16 |
| `c999cc3` | Spec divergence (scenario amended) | spec-only |
