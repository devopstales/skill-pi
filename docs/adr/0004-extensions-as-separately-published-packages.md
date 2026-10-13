# ADR 0004: Extensions are separately published, installable pi packages

- Status: proposed
- Date: 2026-10-13
- SDD change: none yet (pre-propose decision; candidate change `004-…`)
- Reference: [`spences10/my-pi`](https://github.com/spences10/my-pi) (pnpm monorepo of `@spences10/pi-*` packages), `@earendil-works/pi-coding-agent@1.2.0` package-manager loader
- Related: [ADR 0001](./0001-extension-loading-via-dir-manifest.md) (superseded in part), [ADR 0003](./0003-taskfile-as-automation-standard.md) (publish pipeline)

## Context

skill-pi currently bundles one extension (`skill-pi-banner.ts`) inside the wrapper
package, listed in a dir-level `pi.extensions` manifest (ADR 0001). That couples
extension release cycles to the wrapper, forces every skill-pi user to take every
extension, and prevents a user from installing a single extension into their own pi or
skill-pi setup. `my-pi` solves this by publishing each extension as its own npm
package installable via `pi install`. This ADR adopts that model.

## The reference model (verified from `spences10/my-pi`)

A pnpm monorepo where each `packages/pi-<name>/` is an independently versioned and
published npm package:

- **Per-package `package.json`:**
  - name `@<scope>/pi-<name>`, `keywords` includes `"pi-package"`,
    `repository.directory` points at the subfolder, `files: ["dist", "README.md"]`.
  - `pi.extensions: ["./dist/index.js"]` — the package *is* a pi manifest (ADR 0001's
    manifest, one package deep).
  - `peerDependencies` on `@earendil-works/pi-coding-agent` (the pi runtime) so pi
    provides the host; `dependencies`/`devDependencies` for the extension's own needs.
  - `publishConfig.access: public`.
- **Workspace wiring:** `pnpm-workspace.yaml` (`packages/*`) + a `catalog:` for shared
  versions; cross-extension reuse goes through **shared support packages**
  (`pi-settings`, `pi-footer`, …) that are *published as dependencies but not
  `pi install`ed* (classified in `docs/package-map.md`).
- **Two consumption paths:**
  1. The full distribution (root `my-pi` CLI, `pnpx my-pi`) — prewires everything.
  2. Individual packages: `pi install npm:@scope/pi-<name>` (global) or
     `pi install -l npm:@scope/pi-<name>` (project-local). pi's package manager reads
     the installed package's `pi.extensions` and loads it.
- **Release:** changesets (`changeset publish`), root `release` script; each package
  versions independently.

## Decision

### D1 — Repo shape: npm workspaces of `packages/pi-<name>`

Convert skill-pi to a monorepo:

```
skill-pi/
├── package.json                 # workspace root (private, no bin)
├── pnpm-workspace.yaml          # packages: ["packages/*", "apps/*"]
├── packages/
│   ├── skill-pi/                # the CLI wrapper (today's repo content moves here)
│   └── pi-<name>/               # one npm package per extension
│       ├── package.json         # pi manifest + peerDeps on pi-coding-agent
│       ├── README.md
│       └── src/index.ts         # (or .js — see Open questions)
└── docs/package-map.md          # installable vs shared-support classification
```

Each `pi-<name>` is a **separately published, independently versioned** npm package
under the `@skill-pi` scope, `keywords: ["pi-package"]`, `pi.extensions` pointing at
its entry. The wrapper (`packages/skill-pi`) no longer bundles extension *source*; it
depends on the extension packages it ships by default (workspace `*`), mirroring
`my-pi`'s root using `workspace:*` deps.

### D2 — Install semantics: pi-native, agent-dir-aware

- skill-pi users install/enable extensions with the pi package manager, scoped to the
  skill-pi agent dir: `skill-pi -- install npm:@skill-pi/pi-<name>` (global) /
  `skill-pi -- install -l npm:@skill-pi/pi-<name>` (project). Because
  `PI_CODING_AGENT_DIR=~/.skill-pi/agent`, pi records the package in
  `~/.skill-pi/agent/settings.json` (`packages` array) and loads it from there —
  stock `pi` is unaffected (ADR 0002 invariants preserved).
- The same packages are installable into **vanilla pi** (`pi install
  npm:@skill-pi/pi-<name>`) — the whole point of separate publication.
- Project-local installs write to the shim `.pi/settings.json` (ADR 0002 mirror) and
  resolve against `<repo>/.skill-pi` — keeping project config in the skill-pi namespaced
  dir, not `.pi`.

### D3 — Wrapper default set: declared deps, not bundled source

The `skill-pi` package declares its default-on extensions as workspace dependencies
(e.g. `@skill-pi/pi-banner: workspace:*`). On launch the wrapper's default behavior is
the union of (a) pi's package-manager-resolved packages from the agent dir and (b) the
extension packages it depends on. ADR 0001's dir manifest in `extensions/` is
**superseded** for published extensions; a thin `extensions/` (or none) may remain only
for wrapper-internal, never-published glue.

### D4 — Shared code via support packages, not duplication

Cross-extension helpers (settings access, TUI widgets, footer) are extracted into
`@skill-pi/pi-<shared>` packages that are published as **dependencies** of the
extension packages but are not advertised as `pi install` targets. `docs/package-map.md`
is the SoT for installable vs shared classification (mirrors `my-pi`).

### D5 — Release: changesets + Taskfile

- `@changesets/cli` for per-package independent versioning/changelogs.
- The `Taskfile.yml` (ADR 0003) gains: `build` (build all workspace packages),
  `changeset`, `release` (build → `changeset publish`), and per-package `test`.
- Root `release` requires a clean tree (like `my-pi`).

## Alternatives considered

- **Keep bundled dir-manifest extensions (ADR 0001 status quo)** — simplest, but one
  release cycle for all extensions and no selective install; rejected.
- **One `@skill-pi/extensions` meta-package bundling all** — single install, but users
  still can't pick one extension and versioning stays coupled; rejected (the meta
  distribution is the `skill-pi` wrapper itself, per D3).
- **Publish extensions but keep them in the wrapper's `files` (npm pack the monorepo
  subpaths)** — npm `files` cannot cleanly publish independent versions from one
  package; rejected.
- **pnpm vs npm workspaces** — the reference uses pnpm (catalog, `workspace:*`,
  `minimumReleaseAge`). The `workspace:*` protocol is **not** supported by npm (it is
  a pnpm/yarn feature), so staying on npm would require replacing `workspace:*` with
  `*`/file refs and losing the catalog. See Open questions; the *decision* (separate
  packages) is package-manager-agnostic, but matching the reference means moving to
  pnpm.

## Consequences

- **Repo restructure** (large): move current content into `packages/skill-pi`, add
  `pnpm-workspace.yaml`, `.npmrc`, changesets config, `docs/package-map.md`.
- **ADR 0001 superseded in part**: the dir-level `extensions/package.json` manifest is
  replaced by per-package `pi.extensions` manifests; the `--extension` flag in
  `bin/skill-pi.js` is dropped in favor of pi's package-manager resolution.
- **Publishing cost**: N extensions → N npm packages to maintain; changesets make this
  tractable and matches the reference.
- **First extension to split**: `skill-pi-banner` → `@skill-pi/pi-banner` (proves the
  pipeline end-to-end before splitting the rest).
- **README**: "Adding your own extensions" becomes "install `@skill-pi/pi-*` packages"
  plus a package table (mirrors `my-pi` README table + `package-map.md`).

## Invariants preserved (cross-check)

- ADR 0002 separation: package state lands in `~/.skill-pi/agent` (global) or the shim
  `.pi` (project); `~/.pi` and `<repo>/.pi` untouched.
- ADR 0003 automation: all new lifecycle ops are `Taskfile` tasks.

## Open questions

- **Package manager:** the reference's `workspace:*` + `catalog:` require pnpm (npm
  does not support the `workspace:` protocol). Adopt pnpm (swap `package-lock.json` →
  `pnpm-lock.yaml`, add `.npmrc`/`pnpm-workspace.yaml`) or stay npm and give up the
  catalog/workspace protocol? Owner: maintainer, before `004` spec.
- **Language of extension source:** the reference compiles TS→`dist` per package;
  skill-pi extensions are currently plain `.ts` loaded via pi's jiti. Do extension
  packages ship `dist` (build step) or raw `.ts` (no build, simpler)? Recommend
  matching the reference (build to `dist`) for clean `files` and versioning.
- **npm scope ownership:** `@skill-pi` scope must exist/be claimable on npm.
- **Default-on vs opt-in** for the wrapper's bundled set — which extensions load by
  default in `skill-pi` vs require explicit `install`?

## Follow-up

- Candidate SDD change `004-extensions-as-packages`: monorepo restructure + split
  `skill-pi-banner` into `@skill-pi/pi-banner` + Taskfile build/release + README/package-map.
  This is a large change — likely chained PRs (restructure, then first split, then
  pipeline).
