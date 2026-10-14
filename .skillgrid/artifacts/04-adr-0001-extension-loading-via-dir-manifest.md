# Load bundled extensions via explicit enumeration + --no-extensions

---
status: "accepted"
date: 2026-10-13
supersedes: none
updated: 2026-10-14
---

## Context and Problem Statement

`skill-pi` is a thin wrapper around `@earendil-works/pi-coding-agent`. Its hard
requirements are (1) a separate global config/auth under `~/.skill-pi/agent` and
(2) bundled extensions that load on every launch regardless of the user's stock pi
install. The second requirement is the subject of this decision.

An earlier revision of this ADR chose a dir-level `pi.extensions` manifest in
`extensions/package.json` (the `omegon-pi` shape), on the assumption that pi's
`resolveExtensionEntries(dir)` needed a manifest to resolve the `extensions/`
directory. That assumption was wrong: traced against pi 1.2.0
(`dist/bundle/chunks/chunk-TJXZSVTD.js`), `resolveExtensionEntries` reads a manifest
*only if one is present* — otherwise it falls back to `index.ts`/`index.js`, and
`collectAutoExtensionEntries` does full directory auto-discovery (top-level
`*.ts`/`*.js` plus subdirectory index entry points). So the manifest was not load-
bearing; it was an extra registration surface that had to be kept in sync by hand.

We also verified that `--no-extensions` does **not** suppress CLI `--extension`
flags — it suppresses the *package-scope* discovery (settings packages and
auto-discovered agent/project dirs), which is exactly the isolation we want.

## Considered Options

- Dir-level `pi.extensions` manifest in `extensions/package.json` (the prior decision)
- Wrapper enumerates extension files explicitly (`collectExtensionFiles`) + `--no-extensions`
- Keep pi's directory auto-discovery (no flag, no manifest)

## Decision Outcome

Chosen option: **wrapper enumerates extension files explicitly and passes each as an
`--extension` flag, with `--no-extensions` to suppress pi's package-scope discovery.**

The wrapper (`bin/skill-pi.js`) scans two source directories with
`collectExtensionFiles`:

- `<skill-pi>/extensions` (bundled, always loaded)
- `<agent-dir>/extensions` (user-dropped, zero-config)

`collectExtensionFiles` picks up top-level `*.ts`/`*.js` files (alphabetical) and
subdirectories carrying an `index.ts`/`index.js` entry point. Each resolved file is
passed as an explicit `--extension` flag. The wrapper then appends `--no-extensions`,
which suppresses pi's package-scope discovery (settings `packages` + auto-discovered
agent/project dirs) while leaving the CLI flags above intact.

### Consequences

- Good, because adding a bundled extension is now: drop the file in `extensions/` (or a
  subdirectory with an `index.ts`) — no manifest edit, no `package.json` churn.
- Good, because `--no-extensions` makes isolation explicit and robust: a user-installed
  pi package in `<agent-dir>/settings.json` can no longer auto-load into skill-pi.
- Good, because the load set is deterministic and visible in the wrapper, not spread
  across a manifest file plus pi's internal resolver.
- Bad, because the enumeration logic (symlink resolution, index entry points) is now
  wrapper-owned; if pi's entry-point conventions change we must follow them in
  `collectExtensionFiles` rather than inherit them for free.
- Note: `--no-extensions` suppresses all package-scope provider packages, so
  `lib/config.js` seeds **no** default packages (a seeded package would be
  loaded-then-suppressed — dead weight). Cloud providers arrive via the
  unified-providers extension (2026-10-14-unified-providers); local providers
  (e.g. Ollama) are user-dropped into `<agent-dir>/extensions/` or declared in
  `<agent-dir>/models.json`, and load via the explicit enumeration above.

### Rejected: dir-level manifest (prior revision)

The `extensions/package.json` `pi.extensions` array was the prior decision. It was
correct that it *worked* (pi reads the dir's own `package.json`), but it was not
required — pi would have auto-discovered the same files. Keeping it meant a second
source of truth for "which bundled extensions load," which drifted from reality the
moment a file was added without a manifest edit. Removed.
