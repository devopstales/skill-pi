# ADR 0001: Load bundled extensions via a dir-level pi manifest

- Status: accepted
- Date: 2026-10-13
- Reference: `styrene-lab/omegon-pi` (package.json `pi.extensions`), `@earendil-works/pi-coding-agent@1.2.0`
- SDD change: [`docs/skillgrid/archive/001-extension-loading-via-dir-manifest/change.md`](../skillgrid/archive/001-extension-loading-via-dir-manifest/change.md) (promoted from that change's Architecture decisions)

## Context

`skill-pi` is a thin wrapper around `@earendil-works/pi-coding-agent`. Its hard
requirements are (1) a separate global config/auth under `~/.skill-pi/agent` and
(2) bundled extensions that load on every launch regardless of the user's stock pi
install. The second requirement is the subject of this decision.

Earlier the wrapper passed `--extension <skill-pi>/extensions` and relied on pi
auto-discovering every `*.ts` file in that directory. We changed extension loading
to follow the same mechanism as `omegon-pi`, which declares its bundled extensions in
a `pi.extensions` array in `package.json`.

## Decision

Declare the bundled extensions in a manifest at `extensions/package.json`:

```json
{
  "pi": {
    "extensions": [ "./skill-pi-banner.ts" ]
  }
}
```

The wrapper continues to pass `--extension <skill-pi>/extensions --extension
<agent-dir>/extensions`. pi's extension loader resolves each directory argument via
`resolveExtensionEntries(dir)`, which reads `dir/package.json`'s `pi.extensions` and
loads exactly the listed files. The agent-dir extension argument still uses
auto-discovery (no manifest), so user-dropped `~/.skill-pi/agent/extensions/*.ts`
files load without registration.

## Rationale

pi's `resolveExtensionEntries` (verified in
`dist/bundle/chunks/chunk-TJXZSVTD.js`) reads the *directory's own* `package.json`,
not a parent's. A manifest at the repo root is therefore ignored when the argument is
the `extensions/` dir — the manifest must sit in that dir. Placing it in `extensions/`
matches `omegon-pi`'s shape (its `pi.extensions` arrays are resolved per-dir the same
way) and gives an explicit, ordered list instead of relying on alphabetical
auto-discovery.

## Consequences

- Adding a bundled extension requires listing it in `extensions/package.json`
  (no longer just dropping a file). Documented in `README.md`.
- The agent-dir extension arg keeps auto-discovery, so user extensions need no
  manifest.
- No `PI_PACKAGE_DIR` env var is set; the wrapper only sets `PI_CODING_AGENT_DIR`.
