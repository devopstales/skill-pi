# skill-pi update — Design Briefing

> **STATUS:** `accepted` (2026-10-16) — plan agreed with user in-session (plan mode).

## Problem / Intent

pi's interactive TUI shows an "Update Available — Run `skill-pi update`" banner
when a newer `@earendil-works/pi-coding-agent` release exists. The banner is pi's
*own* version check (`checkForNewPiVersion` → `https://pi.dev/api/latest-version`),
branded to skill-pi via the overlay `piConfig.name` — but the command it tells the
user to run is **wrong for skill-pi**: `skill-pi update` currently passes through
to pi's `package` command, which resolves `PACKAGE_NAME` from the overlay
(re-exported pi `package.json`, name = `@earendil-works/pi-coding-agent`) and runs
`npm install -g @earendil-works/pi-coding-agent@…` — i.e. it updates **stock pi**,
not skill-pi. If no global pi install is managed, pi falls back to a generic
"update it with the package manager, wrapper, or source checkout" hint.

The banner's command must be **true**: `skill-pi update` must update skill-pi
itself (wrapper + bundled pi), because skill-pi is a source install
(`task install` = `npm install` + `npm link --force`, per ADR-0003).

## Purpose & Success Criteria

- `skill-pi update` is intercepted by the wrapper **before** the pi passthrough:
  it never reaches pi's `package` command and never touches stock pi.
- It runs `npm install` then `npm link --force` in the skill-pi package root
  (the exact `task install` step order, minus the first bare `npm ci` which is
  redundant after `npm install` for an update).
- On success it prints the real version transition — `skill-pi X (wraps
  pi-coding-agent A → B)` — plus the `https://pi.dev/changelog` URL.
- On npm failure it exits non-zero with an actionable hint (run the steps
  manually in the skill-pi checkout).
- Pi's in-TUI "Update Available" banner is unchanged (it stays as the passive
  heads-up; its command is now correct).
- `--help` documents the new subcommand.
- Root suite `node --test "test/**/*.test.js"` is green.

## Constraints

- Never modify pi source (ADR-0006): interception happens in wrapper-owned files
  (`bin/skill-pi.js`, new `lib/update.js`); pi is consumed unchanged via npm
  semver (`^1.2.0`).
- Thin wrapper (per ASSUMPTIONS.md § VERIFIED): no fork of pi; the update is an
  npm semver bump of the dependency the wrapper already declares.
- `Taskfile.yml` remains the canonical automation surface (ADR-0003): `task
  install` keeps its current shape for fresh installs; `skill-pi update` is the
  user-facing path for updates and does not add a Taskfile task.
- No comments in code unless asked. Minimal scoped changes.
- Isolation is the product: update must never read or write `~/.pi/agent`.

## Out of Scope

- Updating bundled extensions (ADR-0004/0005: they are separately published,
  independently versioned `@devopstales/pi-*` packages with their own lifecycle).
- A separate `skill-pi update --extensions` subcommand (backlog).
- `PI_SKIP_VERSION_CHECK` / suppressing pi's banner (the banner is now truthful;
  no need to replace it).
- Detecting git-checkout vs published install and switching strategies — one
  path: `npm install` + `npm link --force` works for both.

## Tier

T2 — new user-facing CLI surface + subprocesses (threat matrix applies). Not
risky: no migration, no trust-boundary change, no pi source coupling.
