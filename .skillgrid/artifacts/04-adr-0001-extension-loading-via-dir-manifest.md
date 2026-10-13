# Load bundled extensions via a dir-level pi manifest

---
status: "accepted"
date: 2026-10-13
supersedes: none
---

## Context and Problem Statement

`skill-pi` is a thin wrapper around `@earendil-works/pi-coding-agent`. Its hard
requirements are (1) a separate global config/auth under `~/.skill-pi/agent` and
(2) bundled extensions that load on every launch regardless of the user's stock pi
install. The second requirement is the subject of this decision.

Earlier the wrapper passed `--extension <skill-pi>/extensions` and relied on pi
auto-discovering every `*.ts` file in that directory. We changed extension loading
to follow the same mechanism as `omegon-pi`, which declares its bundled extensions in
a `pi.extensions` array in `package.json`.

Reference: `styrene-lab/omegon-pi` (package.json `pi.extensions`),
`@earendil-works/pi-coding-agent@1.2.0`.
Original change: `.skillgrid/archive/2026-10-13-extension-loading-via-dir-manifest/change.md`.

## Considered Options

- Dir-level manifest in `extensions/package.json` (`pi.extensions` array)
- Repo-root `package.json` `pi.extensions` + `PI_PACKAGE_DIR` env override
- Keep directory auto-discovery (no manifest)

## Decision Outcome

Chosen option: "dir-level manifest in `extensions/package.json`", because
pi's `resolveExtensionEntries(dir)` reads the *directory's own* `package.json`
(verified in pi 1.2.0 `dist/bundle/chunks/chunk-TJXZSVTD.js`), so a root manifest is
never consulted when the flag points at `extensions/`. Declaring the list in the
`extensions/` dir matches `omegon-pi`'s shape and gives an explicit, ordered list
instead of alphabetical auto-discovery.

The wrapper continues to pass `--extension <skill-pi>/extensions --extension
<agent-dir>/extensions`. The agent-dir argument keeps auto-discovery (no manifest),
so user-dropped `~/.skill-pi/agent/extensions/*.ts` files load without registration.

### Consequences

- Good, because extension load set is explicit and ordered; adding an extension is a
  one-line manifest edit documented in `README.md`.
- Good, because the drop-file user-extension workflow stays zero-config.
- Bad, because a new extension file that is not listed silently doesn't load
  (mitigated: documented in `README.md`; the explicit list is the feature).
- No `PI_PACKAGE_DIR` env var is set; the wrapper only sets `PI_CODING_AGENT_DIR`.
