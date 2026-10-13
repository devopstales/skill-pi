# Tasks: 001-extension-loading-via-dir-manifest

> **STATUS:** `complete` (2026-10-13) — 2/2 steps PASS (retrofit: work completed before Skillgrid onboarding; evidence recorded from the actual implementation session)
>
> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (or simple-execution) to implement step-by-step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bundled pi extensions load on every skill-pi launch via an explicit `pi.extensions` manifest, matching the mechanism used by `omegon-pi`.

**Architecture:** Dir-level `pi` manifest in `extensions/package.json`; pi's `resolveExtensionEntries` (unchanged, pinned to pi 1.2.0) resolves `--extension <pkg>/extensions` against it. See change.md Architecture decisions.

**Tech Stack:** Node.js 22 ESM, `@earendil-works/pi-coding-agent@1.2.0`

**Spec:** `.skillgrid/archive/2026-10-13-extension-loading-via-dir-manifest/change.md`

**Acceptance:** `.skillgrid/archive/2026-10-13-extension-loading-via-dir-manifest/acceptance.feature` (`@step-NN`)

---

## Goal

Every `skill-pi` invocation loads exactly the bundled extensions listed in `extensions/package.json`'s `pi.extensions`, with no reliance on alphabetical auto-discovery.

## Out of scope / Non-Goals

- User extensions in `~/.skill-pi/agent/extensions/` (auto-discovered, unchanged)
- Skills / prompts / themes manifests
- pi upstream changes; pre-existing `ensureAgentDir`/`--extension` test failures (separate change)

## Definition of Done

Change is done only when **all** of the following are true:

- [x] Every success criterion / DoD checkbox in `change.md` is met
- [x] Every `@step-NN` Feature in `acceptance.feature` has passing scenarios (manual trace + test evidence below)
- [x] Every step below has Verdict `PASS` or `PASS WITH WARNINGS`
- [x] No unchecked `- [ ]` under any `### Tasks`
- [x] No **Global Constraint** violated
- [x] Rollback path in `change.md` is still valid (delete `extensions/package.json` → auto-discovery fallback)
- [x] `## State` status is `done`

## Global Constraints

- Thin wrapper only — no fork of pi; no pi source changes
- Never touch the stock `~/.pi/agent` (isolation invariant)
- Missing manifest or missing listed file → pi warns and continues (never hard-fails the launch)
- Node.js >= 22.19.0; ESM

---

## State

```yaml
phase: archive          # spec | apply | verify | archive
current_step: 02-docs
status: done            # in_progress | blocked | done
updated: 2026-10-13
```

## Step map

| NN | Step | Tag | Blocked by | Acceptance |
|----|------|-----|------------|------------|
| 01 | `manifest-dir` | `@step-01` | — | Feature tagged `@step-01` |
| 02 | `docs` | `@step-02` | 01 | Feature tagged `@step-02` |

## Review workload (change-level)

| Field | Value |
|-------|-------|
| Estimated changed lines (change) | ~40 (10 manifest + 12 README) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

---

## 01-manifest-dir

### Goal

`--extension <pkg>/extensions` resolves (via pi's `resolveExtensionEntries`) to exactly the files listed in `extensions/package.json` `pi.extensions`.

### Out of scope / Non-Goals

- Agent-dir extension discovery
- skills/prompts/themes manifest entries

### Definition of Done

This step is done only when:

- [x] All `### Tasks` checkboxes below are `[x]`
- [x] All `@step-01` scenarios in `acceptance.feature` pass (evidence below)
- [x] `### Verification` Verdict is `PASS` or `PASS WITH WARNINGS`
- [x] No Global Constraint violated

> Depends on: none

**Files:**
- Create: `extensions/package.json`
- Test: (manual trace against pi 1.2.0 loader; `npm test` for regression)

**Interfaces:**
- Consumes: pi `resolveExtensionEntries(dir)` contract (reads `dir/package.json` `pi.extensions`)
- Produces: explicit bundled-extension list; `bin/skill-pi.js` `--extension <pkg>/extensions` flag (unchanged)

### Tasks

- [x] 01.1 `[RED]` Manifest absent → pi falls back to auto-discovery (pre-change behavior)
  - [x] 01.1.a Write failing test — manual trace: remove `extensions/package.json`, re-run `npm test`; recorded 8 pass / 3 fail
  - [x] 01.1.b Run to confirm fail — `Run: npm test` — Expected: same 3 pre-existing failures, bundled extension still loads via auto-discovery
  - [x] 01.1.c Minimal implementation — create `extensions/package.json` with `pi.extensions: ["./skill-pi-banner.ts"]`
  - [x] 01.1.d Run to confirm pass — `Run: npm test` — Expected: identical 8 pass / 3 fail (change is behavior-preserving for the suite)
  - [x] 01.1.e Commit — `feat(extensions): declare bundled extensions in dir-level pi manifest` (pre-structure work; single commit at first repo commit)
- [x] 01.2 `[AFK]` Threat row: loader reads the *dir's own* package.json, not the repo root — `Run: node --input-type=module -e "<trace resolveExtensionEntries on <pkg>/extensions>"` — Expected: resolves to `extensions/skill-pi-banner.ts` only (verified; a root-level `pi.extensions` would be ignored)
- [x] 01.3 `[AFK]` Threat row: manifest lists a missing file → pi skips it, others load — `Run: trace with non-existent entry` — Expected: entry skipped, no hard failure (pi loader: `existsSync(resolvedExtPath)&&entries.push(...)`)

### Verification

Verdict: `PASS WITH WARNINGS`

Evidence:

| Check | Run | Expected | Result | Notes |
|-------|-----|----------|--------|-------|
| Focused test | `node --test test/config.test.js` | PASS | PASS | agent dir seeding + importAuth green |
| Acceptance `@step-01` / `@p0` | manual trace of `resolveExtensionEntries('<pkg>/extensions')` against pi 1.2.0 loader source | resolves to manifest list exactly | PASS | `skill-pi-banner.ts` is the only resolved entry |
| Runtime harness | `npm test` | 8 pass / 3 pre-existing fail | PASS | failure set unchanged with or without the manifest (verified by removing it and re-running) |
| Rollback boundary | delete `extensions/package.json`, re-trace | auto-discovery fallback | PASS | prior behavior restored |
| Global Constraints | — | held | held | wrapper-only; `~/.pi/agent` untouched; no env trickery (`PI_PACKAGE_DIR` not set) |

Warning: 3 pre-existing suite failures (`--version`, `--print`, `rpc`) stem from `ensureAgentDir` + pi 1.2.0 `--extension <dir>` handling — tracked as a separate change, not caused by this one.

### Commit

When step DoD is met: `feat(extensions): declare bundled extensions in dir-level pi manifest`

---

## 02-docs

### Goal

A maintainer can add a bundled extension by reading the README.

### Out of scope / Non-Goals

- Other README sections
- CHANGELOG (none in repo yet)

### Definition of Done

This step is done only when:

- [x] All `### Tasks` checkboxes below are `[x]`
- [x] All `@step-02` scenarios in `acceptance.feature` pass
- [x] `### Verification` Verdict is `PASS` or `PASS WITH WARNINGS`
- [x] Depends-on step(s) already PASS / PASS WITH WARNINGS
- [x] No Global Constraint violated

> Depends on: 01-manifest-dir

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: manifest contract from 01
- Produces: none

### Tasks

- [x] 02.1 `[AFK]` "Bundled extensions always load" section names `extensions/package.json` as the source of the extension list — `Run: grep -n "extensions/package.json" README.md` — Expected: match in section 3
- [x] 02.2 `[AFK]` "Adding your own extensions" documents the add-recipe (file into `extensions/` + list in `pi.extensions`) — `Run: grep -n "pi.extensions" README.md` — Expected: match in the section
- [x] 02.3 `[AFK]` Commit — `docs(readme): document dir-level pi manifest for bundled extensions`

### Verification

Verdict: `PASS`

Evidence:

| Check | Run | Expected | Result | Notes |
|-------|-----|----------|--------|-------|
| Focused test | `grep -n "extensions/package.json" README.md` | match | PASS | section 3 names the manifest |
| Acceptance `@step-02` / `@p0` | `grep -n "pi.extensions" README.md` | match | PASS | add-recipe documented |
| Runtime harness | `npm test` | unchanged 8/3 | PASS | docs-only change; suite unaffected |
| Rollback boundary | revert README edits | PASS | PASS | docs-only, trivially reversible |
| Global Constraints | — | held | held | — |

### Commit

When step DoD is met: `docs(readme): document dir-level pi manifest for bundled extensions`

---

## Archive gate checklist

- [x] Change-level **Definition of Done** fully checked
- [x] No unchecked `- [ ]` under any `### Tasks`
- [x] Every step Verdict is `PASS` or `PASS WITH WARNINGS`
- [x] No Global Constraint violated
- [x] `## State` status is `done` and phase is `archive`
- [x] STATUS banner updated to `complete`

## QA plan

- Human QA: run `skill-pi` in a real project; confirm the banner extension notification appears and no stock-pi side effects (e.g. `~/.pi/agent` mtimes unchanged).
- Add-extension drill: drop a new `extensions/foo.ts`, list it in the manifest, launch, confirm load; remove from manifest, confirm it no longer loads.
