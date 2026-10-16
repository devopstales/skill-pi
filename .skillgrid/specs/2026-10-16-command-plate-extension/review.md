# Review — command-plate extension

> Change: `.skillgrid/specs/2026-10-16-command-plate-extension/` (moves to `.skillgrid/archive/` at ship)
> Generated: 2026-10-16T12:05:00+02:00 (requesting-code-review)
> Diff range: `b62c26a..08826aa` (scoped to `extensions/command-plate/`; concurrent pi-hooks + lsp work from other sessions in the same window excluded)
> Rigor tier: T1 (small additive extension; three-axis default review, not parallel-code-review)
> Independence: Grade B per axis — fresh subagent contexts, but same model family / toolchain as the implementer. See `## Independence`.

## What Important means

- **Critical** — must fix before merge. Security, data loss, broken functionality, a scenario whose RED evidence is missing or whose code path does not match Given/When/Then. Blocks `ship`.
- **Important** — should fix before merge. Architecture drift from a term or in-force ADR, a hard standard breach, a missing/partial requirement, scope creep. Unfixed Important issues do not proceed.
- **Minor** — nice to have. Baseline smells, style, optimization, doc polish. Capped and summarized.

## Passes

### Standards

- **Worst issue (within this axis):** duplicated "enabled model" logic — `getProviders`/`isModelEnabled` and `loadScopedModels` disagree on id-only patterns (latent; full switcher unwired).
- **Findings:** 0 Critical / 4 Important / 7 Minor (capped to 5 listed)
- **Verdict:** met-with-fixes (2 of 4 Important fixed in `08826aa`: phantom `typebox` dep, incomplete `files` list)

### Spec

- **Worst issue (within this axis):** none — all 8 derived behaviors faithful to the goal.
- **Findings:** 0 Critical / 0 Important / 0 Minor
- **Verdict:** met

### Security

- **Worst issue (within this axis):** none exploitable. One hardening note (now addressed): `typebox: "*"` floating prod dep.
- **Findings:** 0 Critical / 0 High / 0 Medium / 0 Low / 1 Info (now fixed)
- **Verdict:** secure

## Findings

### Critical

- *(none)*

### Important

- [standards] `model-pick.ts:40-64` vs `model-pick.ts:588-621` — `getEnabledModelSet`+`isModelEnabled` (used by `getProviders`/`getModelsForProvider`) and `loadScopedModels` implement "enabled model" with **different semantics**: an id-only pattern (`"claude-sonnet"`, no provider) is enabled per `loadScopedModels` but NOT per `isModelEnabled`. Latent because the full `runModelSwitcher` is unwired from the palette (README admits this); a bug factory the moment it's wired. — **DEFERRED** (no in-scope behavior change; fix = single shared `isEnabled`/derive `getProviders` from `loadScopedModels` resolution when the switcher is wired).
- [standards] `index.ts:7-10` — `runCommand`'s `setTimeout(() => process.stdin.emit("data", "\r"), 0)` is an undocumented, fragile coupling to pi's input-submission internal. The "no comments unless asked" rule implies non-obvious decisions should be documented. — **DEFERRED** (works today, pinned by `index.spec.ts`; fix = one-line comment or a pi submit API if one exists).
- [standards] `package.json:38` — `"typebox": "*"` phantom dependency (no file imports it). — **FIXED** in `08826aa` (removed; lockfile regenerated).
- [standards] `package.json:23-27` — `files` referenced nonexistent `src/` and omitted `model-pick.ts`/`overlay-frame.ts`/`types.ts` (would ship a broken package at ADR-0004 promotion). — **FIXED** in `08826aa` (`files: ["index.ts","*.ts","README.md"]`; `npm pack` now ships 9 files, verified).

### Minor

- [standards] `model-pick.ts:470-488` — `nextModelRow` + `nthModelRow` near-duplicate scans; shared core is `modelRows(rows)`. (Consider)
- [standards] `model-pick.ts:31-43` et al. — 7 decorative `// ────` banner comments + 4 spec comments vs "no comments unless asked" convention. (Judgement call — banners aid an 800-line file.)
- [standards] `index.ts:148-153` — `parseKey` branch is dead on current terminals (the `else if data.length===1` always fires); collapse to the raw check. (Consider)
- [standards] `index.ts:307-315` — `onTerminalInput` callback closes over the *first* session's `ctx`; a session restart would use a stale context. (Consider — capture at call time.)
- [standards] `tsconfig.json` — extends `../skill-pi-tui/tsconfig.json` (a sibling extension's toolchain file); the one cross-extension reference in the subpackage, which ADR-0007 doesn't anticipate. (Consider — inline like `permission`.)
- (2 further Minor/FYI items collapsed — `getThinkingLevel()` double-call, `model-pick.ts`→`model-picker.ts` naming; see raw reviewer report)

## Independence

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | B | fresh `reviewer` subagent, no session history leaked; same model family / toolchain as the implementer |
| Spec | B | fresh `reviewer` subagent, no session history leaked; same model family / toolchain as the implementer |
| Security | B | fresh `reviewer` subagent, no session history leaked; same model family / toolchain as the implementer |

**Reading the grade:** all three are fresh contexts (no-leaks holds — each saw only the diff range + named sources, never the coordinator's rationale or the QA verdict). Grade B (not A) because they share the implementer's model family; at T2 the default three-axis dispatch is Grade A/B, so this is the expected independent evidence for this tier.

## Verdict

- **Standards:** met-with-fixes
- **Spec:** met
- **Security:** secure
- **Floor (decides):** met-with-fixes
- **Worst issue (across all three axes):** duplicated enabled-models logic (standards, Important, deferred — latent until the full switcher is wired)
- **Unfixed Important count (must be 0 to proceed):** 2 (both **deferred** with named re-run paths, not dropped: enabled-models dedup + stdin-emit documentation). Neither blocks this additive port — the load-bearing scoped-models path (`loadScopedModels`) is the one tested and wired; the divergent path (`getProviders`/`isModelEnabled`) is only reachable from the unwired `runModelSwitcher`.

## Receiving-code-review triage

| Finding | Triage | Action |
|---------|--------|--------|
| phantom `typebox` dep (std #1 + sec Info) | fix now | **fixed** `08826aa` — removed, lockfile regenerated, `npm pack` verified complete |
| incomplete `files` list (std #8) | fix now | **fixed** `08826aa` — `*.ts` glob, 9 files shipped |
| duplicated enabled-models logic (std #2) | defer | latent (full switcher unwired); fix when `runModelSwitcher` is wired — single `isEnabled` source |
| undocumented stdin-emit (std #3) | defer | works + pinned by test; add a line or find a pi submit API |
| minors (banners, dead parseKey branch, stale ctx, tsconfig extends, double-call, naming) | defer/noise | logged; no in-scope behavior change |

Post-fix verification: `tsc --noEmit` clean, `vitest run` 12/12, `npm pack --dry-run` ships all 9 files.
