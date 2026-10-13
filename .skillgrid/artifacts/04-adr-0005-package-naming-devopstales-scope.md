# Package naming: `@devopstales/skill-pi` wrapper + `@devopstales/pi-<name>` extensions

---
status: "accepted"
date: 2026-10-13
supersedes: ADR-0004
---

- SDD change: none (standalone naming decision; refines the in-flight publishing direction)
- Related: [ADR 0004](./04-adr-0004-extensions-as-separately-published-packages.md) (superseded for scope), [ADR 0001](./04-adr-0001-extension-loading-via-dir-manifest.md), [ADR 0003](./04-adr-0003-taskfile-as-automation-standard.md) (publish pipeline)

## Context

ADR 0004 adopted the model of publishing each bundled extension as its own
independently versioned, `pi install`-able npm package, and pinned the npm scope to
`@skill-pi` (wrapper `@skill-pi/skill-pi`, extensions `@skill-pi/pi-*`). That scope
decision has now changed.

The project's public identity and npm ownership is the **`devopstales`** account
(the repo is `devopstales/skill-pi`; the `@devopstales` npm scope is the claimable,
durable namespace under the maintainer's control). Using `@skill-pi` for the published
artifacts would split the public name (repo/brand `devopstales`) from the package
name (`skill-pi`) across two namespaces, and the `@skill-pi` scope is not owned by the
project. This ADR re-pins the scope to `@devopstales` and fixes the resulting package
names.

ADR 0004 is still *proposed* (the monorepo restructure it describes has not landed), so
this is a pre-implementation correction of its naming: the model it established is kept
intact; only the scope and the exact package names change.

## Decision

### D1 — Wrapper package name

The published wrapper/CLI is **`@devopstales/skill-pi`** (the current `skill-pi`
package, renamed at publish time). Its `repository.url` is
`git+https://github.com/devopstales/skill-pi.git`. The `skill-pi` and
`skill-pi-version` bin names are unchanged; only the package identity moves under the
`@devopstales` scope.

### D2 — Extension package naming

Each bundled extension is a separately published, independently versioned pi package
named **`@devopstales/pi-<name>`**, where `<name>` is the extension's kebab-case name:

- `extensions/file-search` → **`@devopstales/pi-file-search`**
- a future `skill-pi-banner` split → **`@devopstales/pi-banner`**

This generalizes ADR 0004's `@skill-pi/pi-*` pattern to the `@devopstales` scope. The
`pi-` prefix is retained so every published extension is grep-able in one namespace
prefix and is not confused with the wrapper package. Extension packages carry
`keywords: ["pi-package"]`, a `pi.extensions` manifest, and `peerDependencies` on
`@earendil-works/pi-coding-agent` (the pi runtime) per ADR 0004.

### D3 — Scope is authoritative for all published artifacts

Every npm package this project publishes — the wrapper and every extension (and any
future shared-support package) — lives under `@devopstales`. No package may be published
under a different scope. This is the single rule a future maintainer needs to pick the
right name; the per-package `name` is `@devopstales/<wrapper|pi-<name>>`.

## Alternatives considered

- **Keep `@skill-pi` scope (ADR 0004 status quo)** — matches the earlier proposal, but
  splits the public name from npm ownership and uses a scope the project does not own;
  rejected.
- **Keep the wrapper unscoped (`skill-pi`) and scope only extensions** — the wrapper name
  is short and memorable, but it would collide with the `skill-pi` name on the npm
  root namespace and break the one-namespace rule; rejected.
- **One scope, one prefix for everything (`@devopstales/skill-pi-*`)** — unified prefix,
  but the wrapper is not an extension and the `skill-pi-` prefix is redundant with the
  scope; the `pi-<name>` extension pattern reads better and matches the reference model;
  rejected.

## Consequences

- **ADR 0004 is superseded** for the scope/naming decision; its model (separately
  published, independently versioned extension packages, monorepo shape, changesets
  release, pi-native install semantics) remains in force and is the implementation
  vehicle for this ADR's naming. ADR 0004 stays on disk as frozen history.
- **Renaming is required before first publish** — the root `package.json` `name` must
  become `@devopstales/skill-pi`, and each extension package must be named
  `@devopstales/pi-<name>`. Until then the packages are `private` and unscoped; the
  rename is a publish-time step, not a code change.
- **npm scope claim** — the `@devopstales` scope must exist on npm (or be claimed)
  before the first `npm publish`; this is an account/CI prerequisite, not a code
  decision.
- **README / package-map** — the install table and `docs/package-map.md` reference
  `@devopstales/pi-*` install targets (e.g. `pi install npm:@devopstales/pi-file-search`).
- **Install semantics unchanged** — extensions are still `pi install`-able into both
  skill-pi (agent dir `~/.skill-pi/agent`) and vanilla pi, per ADR 0004's D2.

## Invariants preserved (cross-check)

- ADR 0002 separation: publishing changes package names, not config location; package
  state still lands in `~/.skill-pi/agent` (global) or the shim (project).
- ADR 0003 automation: the publish pipeline (build → changesets → `npm publish`) remains
  a `Taskfile` surface; this ADR adds no new non-Taskfile lifecycle ops.

## Open questions

- **npm `@devopstales` scope ownership / publishing auth** — confirm the scope exists
  and the CI token has publish rights (npm org or scoped publishConfig). Owner:
  maintainer, before first publish.
- **Wrapper rename timing** — rename the root `package.json` to
  `@devopstales/skill-pi` now, or only at the ADR 0004 monorepo restructure? This ADR
  fixes the *name*; the *timing* of the rename is a tactical detail owned by the
  restructuring change.

## Follow-up

- When the ADR 0004 monorepo restructure lands, the wrapper package is
  `@devopstales/skill-pi` and the first split extension is
  `@devopstales/pi-banner` (or `@devopstales/pi-file-search`, whichever is split first).
  All `@skill-pi/*` references in ADR 0004 are read as `@devopstales/*` per this ADR.
