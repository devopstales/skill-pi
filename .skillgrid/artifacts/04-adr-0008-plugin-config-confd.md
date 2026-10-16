# Plugin/extension config lives in `$AGENT_HOME/conf.d/` (and the project `conf.d/`)

---
status: "proposed"
date: 2026-10-14
supersedes: none
---

- SDD change: `2026-10-14-permission-extension` (first to consume this contract)
- Related: [ADR 0001](./04-adr-0001-extension-loading-via-dir-manifest.md) (how
  extensions load), [ADR 0002](./04-adr-0002-full-separation-from-pi.md) (no `.pi`
  read by skill-pi — this ADR preserves that invariant at both user and project
  scope), [ADR 0006](./04-adr-0006-never-modify-pi-source.md) (build
  on pi's public surface), [ADR 0007](./04-adr-0007-self-contained-extensions.md)
  (extensions are self-contained units — this ADR is the contract they share for
  config)

## Context and Problem Statement

Extensions need a place to persist their configuration. The reference
`pi-opencode-permissions-and-preview` permission extension hardcodes
`<repo-root>/.agents/permission.settings.json` (resolving repo root via
`git rev-parse --show-toplevel`). That is an **extension-owned** convention (not a
pi-sourced path), but it is (a) tied to the `git` binary and (b) not a place a stock-
pi user would look.

The skill-pi product stance is that **bundled extensions are self-contained units
that must also run in stock pi** (ADR 0007). A self-contained extension cannot assume
it is running inside skill-pi, so its config location must be **parametrized by the
host's agent home**, not hardcoded to `~/.skill-pi`. If it hardcoded `~/.skill-pi`,
the same extension loaded by stock pi would write to a directory stock pi doesn't
know about — breaking self-containment.

This ADR fixes the config-location contract that all extensions share.

## The rule

**An extension's persistent config lives under a `conf.d/` directory, one file per
extension, named `<extension>.conf`, resolved against the host's agent home:**

| Scope | Location | How the extension derives it |
|---|---|---|
| **User (global)** | `$AGENT_HOME/conf.d/<name>.conf` | `getAgentDir()` + `/../conf.d/` — i.e. the agent dir's **parent**. For stock pi `$AGENT_HOME=~/.pi`; for skill-pi `$AGENT_HOME=~/.skill-pi`. |
| **Project** | `<project-root>/<configDir>/conf.d/<name>.conf` | `<configDir>` is pi's project base dir: `.skill-pi` under skill-pi, `.pi` under stock pi (see D2 for how `<project-root>` is resolved). |

`$AGENT_HOME` is **pi's agent home** — the directory that *contains* pi's agent dir.
- Stock pi: agent dir `~/.pi/agent` ⇒ `$AGENT_HOME = ~/.pi` ⇒ `~/.pi/conf.d/`.
- skill-pi: agent dir `~/.skill-pi/agent` ⇒ `$AGENT_HOME = ~/.skill-pi` ⇒
  `~/.skill-pi/conf.d/`.

Because the rule is `f(getAgentDir())`, the **same extension code** resolves to the
right home under either host — that is what "self-contained" buys.

- One file per extension: `<name>.conf` (the reference's `permission.settings.json`
  becomes `permission.conf`). The `.conf` suffix marks it as plugin config, distinct
  from pi's own `<agent-dir>/settings.json`.
- Format: JSON (the reference already uses JSON; the extension parses it). An
  extension may use any schema it likes inside the file — the contract is the
  **location and naming**, not the body.

## Decision

### D1 — User scope: `$AGENT_HOME/conf.d/<name>.conf`, derived from `getAgentDir()`

The extension derives the user config dir as `dirname(getAgentDir()) + "/conf.d/"`.
`getAgentDir()` is pi's public export (already imported by the reference's
`project.ts`), so this is a pure function of the host: stock pi → `~/.pi/conf.d/`,
skill-pi → `~/.skill-pi/conf.d/`. The extension **never** hardcodes `~/.skill-pi` or
`~/.pi`.

- skill-pi writes to `~/.skill-pi/conf.d/` — fully separated from stock pi's
  `~/.pi/conf.d/` (ADR 0002 D1 user-scope invariant preserved).
- The extension creates `conf.d/` on first write (mkdir recursive).

### D2 — Project scope: `<project-root>/.skill-pi/conf.d/<name>.conf`

The project config lives at `<project-root>/.skill-pi/conf.d/<name>.conf`. Under
**ADR 0002's** `piConfig.configDir: ".skill-pi"`, pi's *project base dir* is
`<repo>/.skill-pi`, so project config follows that base dir directly — no `.pi`
fallback, no host-aware branching. Stock pi uses `<repo>/.pi/` as its project base
dir; skill-pi uses `<repo>/.skill-pi/`. Each host reads its own config dir, which
is the same rule as D1 applied at the project scope.

`<project-root>` is resolved as `git rev-parse --show-toplevel` of the cwd, falling
back to the cwd when not in a git repo (mirrors the reference's existing behavior, so
the port is a 1-line path change).

### D3 — One file per extension, `<name>.conf`, JSON body

- Naming: the extension's directory name (the same string the wrapper's
  `collectExtensionFiles` and ADR 0007 use to identify the extension). `permission`
  → `permission.conf`. No per-user/per-project file name variants beyond the two
  scopes.
- Body: JSON. The extension owns the schema (for permission: `defaultMode`, `always`,
  `allow`, `deny`, `ask`, `keybindings`). The contract is the location + name + JSON
  envelope, not the schema — so other extensions plug in without coordinating.
- The reference's `permission.settings.json` is renamed to `permission.conf` in both
  scopes; the lockfile for the "allow always" write is `<name>.conf.lock` (the
  reference's lock/atomic-write logic carries over verbatim, path changed).

### D4 — Merge + precedence

On read, the extension merges project over user (later wins, array fields concatenated
as the reference already does for `always`/`allow`/`deny`/`ask`). Precedence:
**project-`conf.d` > user-`conf.d`**. Within a scope, a
single `<name>.conf` file is authoritative (no glob-merge of multiple files — that is
`conf.d`'s *directory* semantics, but for a single extension's config one file suffices;
the directory exists so *different* extensions' `<name>.conf` files coexist without
collision).

## Considered Options

- **Hardcode `~/.skill-pi/conf.d/`** — simplest, but the extension would stop working
  in stock pi (it would write to a dir stock pi doesn't manage). Violates
  self-containment (ADR 0007). Rejected.
- **Keep the reference's `.agents/permission.settings.json`** — works in both hosts
  (it's git-root-relative, host-agnostic) but (a) couples to `git` and (b) is not a
  discoverable "plugin config" location; a stock-pi user wouldn't expect their
  permission rules under `.agents/`. Rejected in favor of the `conf.d/` convention.
- **Use pi's own `<agent-dir>/settings.json`** — host-agnostic, but that file is pi's
  (models, packages, trust); overloading it with per-extension config mixes pi's
  schema with the extension's and risks pi rewriting it on its own. The dedicated
  `conf.d/<name>.conf` keeps concerns separate. Rejected.
- **Env override `SKILL_PI_CONF_DIR`** — an explicit knob would help tests, but the
  `f(getAgentDir())` rule is already testable by pointing `PI_CODING_AGENT_DIR` at a
  temp dir (which moves the whole `$AGENT_HOME/conf.d/` subtree). Rejected as YAGNI;
  add only if a use case appears.

## Consequences

- Good, because the rule is `f(getAgentDir())`, so one extension works in stock pi
  **and** skill-pi with no host-specific branch — the self-containment goal.
- Good, because config is co-located with the host that owns it (`~/.skill-pi/conf.d/`
  moves with the skill-pi agent dir; `~/.pi/conf.d/` with stock pi) — isolation
  (ADR 0002 user scope) is preserved.
- Good, because `conf.d/` is an obvious, grep-able, convention-driven location: every
  plugin's config is a `<name>.conf` file the user can find and edit by hand.
- Bad, because the extension now depends on `getAgentDir()` being stable across pi
  versions (it is a public export today); a pi rename would break the derivation.
  Mitigated by ADR 0006 (build on the public surface, no fork) — a rename is a
  semver-bump we track.
- Bad, because two scopes × two hosts = four possible on-disk locations
  (`~/.pi/conf.d/`, `~/.skill-pi/conf.d/`, `<repo>/.pi/conf.d/`,
  `<repo>/.skill-pi/conf.d/`); each host reads only its own locations, but the
  resolver must still be careful.

## Invariants preserved (cross-check)

- ADR 0002 separation: skill-pi reads/writes only `~/.skill-pi/conf.d/` and
  `<repo>/.skill-pi/conf.d/`; stock pi reads/writes only `~/.pi/conf.d/` and
  `<repo>/.pi/conf.d/`. No cross-host reads at either scope.
- ADR 0006: config derivation uses only pi's public `getAgentDir()`; no pi source
  change.
- ADR 0007: the extension stays a self-contained unit; its config path is a pure
  function of the host, not a skill-pi assumption.
- ADR 0001: unaffected — this is a config location, not an extension-load path.

## Open questions

- **`$AGENT_HOME` definition edge:** for a *relocated* skill-pi agent dir
  (`--agent-dir ~/other-agent`), is `$AGENT_HOME = ~/other-agent` (the parent of the
  agent dir) or a fixed `~/.skill-pi`? Recommendation: the parent of the *actual*
  agent dir (`dirname(getAgentDir())`), so a relocated install carries its conf.d with
  it. Confirm at the permission change.
- **Project `<project-root>` without git:** the fallback-to-cwd behavior (inherited
  from the reference) means a non-git dir writes `conf.d/` in the cwd. Acceptable?
  Owner: maintainer.
- **Migration:** existing users of the reference's
  `<repo>/.agents/permission.settings.json` — do we read it as a third fallback for
  one release, or require a manual move? Recommendation: no auto-migration (the
  extension is new to skill-pi; no existing skill-pi users), note it in the README.

## Follow-up

- First consumer: the `permission` extension (`2026-10-14-permission-extension`). Its
  `project.ts` path resolution changes from
  `<repo-root>/.agents/permission.settings.json` to the D1/D2/D3 contract; the rest of
  the reference (rule engine, review UI, lock/atomic write) is unchanged.
- The ADR 0002 project-separation change (configDir `.skill-pi`) must land **before or
  with** a project-scope conf.d that writes to `.skill-pi/conf.d`. Track the
  dependency.
