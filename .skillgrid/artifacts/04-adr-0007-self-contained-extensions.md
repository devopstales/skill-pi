# Bundled extensions are independently packaged units

---
status: "proposed"
date: 2026-10-14
supersedes: none
---

- SDD change: `2026-10-14-permission-extension` (first to rely on this contract)
- Related: [ADR 0001](./04-adr-0001-extension-loading-via-dir-manifest.md) (how they
  load), [ADR 0004](./04-adr-0004-extensions-as-separately-published-packages.md)
  (separate *publication* — proposed, not yet executed)

## Context and Problem Statement

`skill-pi` bundles extensions under `extensions/`. The first one,
`skill-pi-banner.ts`, is a single file with no deps. The second, `file-search/`, is a
subdirectory carrying its own `package.json` (deps + dev toolchain) and `index.ts` —
its runtime imports (`effect`, `@effect/*`) actually resolve from the **root**
`node_modules`, because pi type-strips the `.ts` (Node native) and imports through the
root module graph; the extension's own `node_modules` exists only for its standalone
`tsc`/`vitest` check.

The `permission` extension is the first bundled extension with **real third-party
runtime deps** (`@pierre/diffs`, `@pierre/theme`, `web-tree-sitter`,
`tree-sitter-bash`). Where those deps live and how the extension's toolchain is
encapsulated is a packaging decision that will be repeated for every future extension,
so it is fixed here rather than re-litigated per extension.

## Considered Options

- **Self-contained subdir** — each extension is `extensions/<name>/` with its own
  `package.json` (private, not installed by the root), owning its deps *and* its
  toolchain (`typescript`, `vitest`, `@types/node`). Runtime resolution still goes
  through the root `node_modules` (pi type-strips + imports root-relative). The
  extension's `node_modules` is a dev-time convenience for its own `tsc`/`vitest`.
- **Flat root-only deps** — extension code lives under `extensions/<name>/` but has no
  `package.json`; all runtime + toolchain deps are declared in the root
  `package.json`. Simpler (single source of truth) but the extension is not an
  independently inspectable/packagable unit — its dep footprint is buried in the
  wrapper's `package.json`, and a future extraction (ADR 0004) requires re-deriving the
  per-extension dep list.
- **Full ADR 0004 monorepo now** — convert to `packages/pi-<name>` workspaces and
  publish each extension. That is a large restructure (pnpm, changesets, `dist`
  build) and was deliberately *not* executed; doing it now would couple the permission
  port to a migration that has its own open questions.

## Decision Outcome

Chosen option: **self-contained subdir** — every bundled extension is
`extensions/<name>/` with its own private `package.json` declaring (a) its runtime
deps and (b) its dev toolchain, and an `index.ts` entry point.

- **Runtime deps resolve via the root.** Because pi type-strips the extension's `.ts`
  and imports through the root module graph, an extension's runtime npm packages must
  also be present in the **root** `node_modules` to load. The extension's own
  `package.json` is authoritative for *what* it needs (documenting its dep
  footprint) and for its standalone check; the root carries the same packages so the
  runtime resolves them. This is the `file-search` precedent (its `effect` is in both).
- **The extension `package.json` is `private: true`** and is **not** installed by the
  root `npm install` — the root does not recurse into `extensions/*/node_modules`.
  Installing the extension's toolchain is a local, opt-in step for contributors
  working on that extension.
- **No wrapper change.** `collectExtensionFiles` (ADR 0001) already enumerates
  subdirectory `index.ts` entry points; a new `extensions/<name>/` is picked up with
  no edit to `bin/skill-pi.js`.

### Consequences

- Good, because each extension is an independently inspectable unit: its `package.json`
  names its exact dep footprint and toolchain, and a future split into a published
  package (ADR 0004) is a move, not a re-derivation.
- Good, because runtime + dev isolation is explicit: the wrapper's root `package.json`
  lists runtime deps for the *runtime*, and each extension's `package.json` lists the
  same for its *check*, so neither is a mystery.
- Good, because adding an extension stays a drop-in (`extensions/<name>/index.ts` +
  `package.json`), no manifest edit (ADR 0001 invariants preserved).
- Bad, because runtime deps are declared in two places (root + extension) and can drift
  if one is updated without the other; the per-extension `tsc` check is the guard that
  catches a missing root dep.
- Bad, because the `private: true` extension packages are a partial model: they look
  like standalone npm packages but are not published and not installed by the root —
  the boundary between "self-contained" and "separately published" (ADR 0004) is easy
  to blur.

### Rejected: flat root-only deps

Simpler, single source of truth, but the extension's dep footprint is not
self-describing and a future ADR 0004 extraction requires reconstructing which root
deps belonged to which extension. The permission port is small enough that the
duplication cost is low; the self-describing payoff is not.

### Rejected: execute ADR 0004 now

The monorepo/pnpm/changesets restructure is large and has unresolved open questions
(package manager, `dist` vs `.ts`). Coupling the permission port to it would block a
well-scoped feature on an unrelated migration. This ADR is the *interim* packaging
contract: it makes each extension self-contained **today**, in a shape ADR 0004 can
promote to publication without redesigning the unit.

## Invariants preserved (cross-check)

- ADR 0001: extensions still load via explicit enumeration + `--no-extensions`; no
  manifest, no wrapper change.
- ADR 0002: extension state (settings files, lock files) lands under the agent dir or
  the shim project dir; `~/.pi` and `<repo>/.pi` untouched.
- ADR 0003: the extension's `check`/`test` are `Taskfile` tasks (or `package.json`
  shims calling the runner), not ad-hoc commands.
- ADR 0006: the extension builds on pi's public surface (the `ExtensionAPI`); no pi
  source change.

## Open questions

- **Drift guard:** should the per-extension `tsc` check also assert that each runtime
  dep is present in the root `node_modules` (a small script or a CI step), or is the
  "run the extension and it loads" E2E sufficient? Owner: maintainer, at the
  permission change's QA gate.
- **Promotion trigger:** when does an extension graduate from "self-contained subdir"
  to "published package" (ADR 0004)? Candidate trigger: an extension that a user wants
  in vanilla pi, or that has its own release cadence. Owner: maintainer, before the
  ADR 0004 restructure.

## Follow-up

- First to rely on this contract: the `permission` extension
  (`2026-10-14-permission-extension`). Its `extensions/permission/package.json`
  declares `@pierre/diffs`, `@pierre/theme`, `web-tree-sitter`, `tree-sitter-bash`
  (deps) + `typescript`/`vitest`/`@types/node` (dev); the root `package.json` carries
  the four runtime deps so pi resolves them at load time.
