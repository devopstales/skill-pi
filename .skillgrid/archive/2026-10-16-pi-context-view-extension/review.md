# Review — pi-context-view homogenization

> Change: `.skillgrid/specs/2026-10-16-pi-context-view-extension/` (moves to `.skillgrid/archive/` at ship)
> Generated: 2026-10-16T15:00:00Z (requesting-code-review)
> Diff range: `0695fea72e227009f26ff9d95b348fdd9131985f..4a683487301cf0e396c17dbe62da0852cbc5485e`
> Rigor tier: T2 (Beta) — three-axis review
> Independence: Grade A per axis (fresh subagent contexts, no shared history) — see `## Independence`
>
> Review of the **homogenization delta** of a vendored extension (`dimk90/pi-context-view`, MIT →
> `extensions/pi-context-view/`). The 30k inherited upstream lines are out of scope; the review
> surface is the files the fork author changed to conform to skill-pi conventions.
>
> Note: the root `README.md` bundled-entry was already present at the base commit (a parallel
> session committed it to HEAD); it is correct and was not part of this commit's diff.

## What Important means

- **Critical** — must fix before merge. Security, data loss, broken functionality, a
  `SATISFIES` scenario whose RED evidence is missing or whose code path does not match. Blocks `ship`.
- **Important** — should fix before merge. Architecture drift from a term or an in-force ADR, a hard
  standard breach, a missing or partial requirement, behavior the spec never asked for (scope creep).
- **Minor** — nice to have. Baseline smells, style, optimization, doc polish. Capped to 5 listed.

## Cap the nits

- Max 5 Minor findings listed per axis; beyond that, collapsed to a count.

## Passes

### Standards

- **Worst issue (within this axis):** two `scripts/*.rec.sh` recording scripts still target the old pre-ADR 0008 config path (Shotgun Surgery of the config move) — **FIXED** in this review pass
- **Findings:** 0 Critical / 2 Important (both fixed) / 5 Minor
- **Verdict:** met (with fixes applied)

### Spec

- **Worst issue (within this axis):** conf.d migration left incomplete in the `scripts/*.rec.sh` pair + `src/config.ts` header claimed a project-scope merge the code doesn't implement — **FIXED** in this review pass
- **Findings:** 0 Critical / 3 Important (all fixed; 1 was a false-positive on mirror semantics, ruled below) / 3 Minor
- **Verdict:** met (with fixes applied)

### Security

- **Worst issue (within this axis):** none exploitable (local single-user extension)
- **Findings:** 0 Critical / 0 High / 0 Medium / 1 Low / 0 Info
- **Verdict:** secure

## Findings

### Critical

- none

### Important (all FIXED in this review pass)

- [standards+spec] `scripts/palette.rec.sh:67-76` + `scripts/map-size.rec.sh:58-83` — still mirrored the
  agent dir to `<agent-dir>/extensions/` and wrote `pi-context-view.json`, a path the extension no longer
  reads. **Fixed:** both now mirror `! -name 'conf.d'`, `mkdir -p "$AGENT_DIR/conf.d"`, and write
  `conf.d/pi-context-view.conf` (matches the `doc/images/*.rec.sh` treatment).
- [spec] `src/config.ts:10-15` — module header claimed a project-local conf.d merge over the global file
  that `getConfigFilePath()`/`ConfigStore` (single-file, override-only) never implement. **Fixed:** header
  now states project-local configuration is intentionally unsupported (matches upstream design + ADR 0008
  single-file contract).
- [standards] `CHANGELOG.md` started at `v0.7.1` while `package.json` was `0.1.0` — the repo's own
  `doc/RELEASE.md` treats these as coupled (version bump + changelog entry). **Fixed:** added a
  `[v0.1.0]` fork-anchoring entry ("forked at upstream v0.7.1, repackaged as @devopstales/pi-context-view").

### Minor

- [standards] `doc/RELEASE.md:4-5` describes the dropped GitHub release workflow (nested `.github/`
  removed) and pins `pi-agent-core` (not a dep). **Deferred:** inherited upstream release tooling;
  `scripts/release.sh` + `doc/RELEASE.md` stay upstream-shaped (they reference `dimk90/pi-context-view` +
  pnpm). The skill-pi publish path is the wrapper's root Taskfile per ADR 0003, not this script.
- [standards] `README.md:131` License link + top badges still point at the upstream package. **Ruling:**
  badges/links kept as upstream attribution (siblings keep fork attribution); the config-reference link at
  `README.md:97` was **fixed** to point at the local `doc/CONFIG.md` (the wrong-path one).
- [spec] stray `pnpm` mentions in `test/run.ts:2` + `scripts/demo-injections.md:14`. **Fixed** → `npm test` /
  `npm run check`.
- [spec] (false-positive ruled out) `doc/images/palettes.rec.sh:58-60` / `map-sizes.rec.sh:50-52` mirror
  semantics — the reviewer read `! -name 'conf.d'` as "drops the config the recording should own". Ruled
  correct: it symlinks everything else, creates an empty `conf.d/`, and `apply_palette`/`apply_map_size`
  write the variant file there — the recording owns exactly one config file at the new path, mirroring the
  upstream structure. No change.
- [security] `test/harness/settings.ts:19-21` replaces the `SettingsManager.create` static process-wide,
  against the extension's own "no shared-static mocks" contract. **Ruling:** defense-in-depth, local-only,
  maintainer-written test code, fail-closed fallback. Not a vulnerability; noted for the harness contract.

## Independence

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | A | fresh `general` subagent, diff + standards sources only, no session narrative |
| Spec | A | fresh `general` subagent, diff + intent only, no session narrative |
| Security | A | fresh `general` subagent, diff + OWASP skill only, no session narrative |

## Verdict

- **Standards:** met (with fixes)
- **Spec:** met (with fixes)
- **Security:** secure
- **Floor (decides):** met
- **Worst issue (across all three axes):** two `scripts/*.rec.sh` recording scripts on the old config path (homogenization-completeness gap) — fixed
- **Unfixed Important count (must be 0 to proceed):** 0

## Fixes applied in this review pass (commit as a follow-up)

- `src/config.ts` — header now states project-local config is unsupported (no claimed merge)
- `scripts/palette.rec.sh`, `scripts/map-size.rec.sh` — conf.d path + mirror logic
- `CHANGELOG.md` — `[v0.1.0]` fork-anchoring entry
- `README.md:97` — config reference → local `doc/CONFIG.md`
- `test/run.ts:2`, `scripts/demo-injections.md:14` — `pnpm` → `npm`

Verified after fixes: `npm run check` (tsc) clean; `npm test` 708 pass / 0 fail.
