# Never modify pi source — build on top, not into it

---
status: "accepted"
date: 2026-10-14
supersedes: none
---

## Context and Problem Statement

`skill-pi` is a thin wrapper around `@earendil-works/pi-coding-agent`, consumed
via npm semver (ADR 0002 pins the full separation contract; config's
`dependency_policies` says "no fork of pi; pi behavior changes come via npm
semver").

Today the wrapper reaches *into* pi's shipped source in at least one place:

- `lib/brand-hooks.mjs` installs an `node:module` load hook that intercepts
  pi's `chunk-WJUNYZC5.js` and rewrites `APP_NAME=piConfigName||"pi"` to
  `APP_NAME=piConfigName||"skill-pi"` at load time. The hook even documents
  that "the chunk filename is not part of pi's public API; if a future release
  renames it, the hook degrades gracefully."

Any such modification — a runtime patch, a post-install `patch-package` step,
a forked-and-committed copy, a build step that edits pi files — couples
skill-pi to pi's *internal* structure. pi's bundled chunks are not a stable
API: a version bump can rename a chunk, minify a token, or restructure the
module, and the modified function silently stops matching. The result is a
break that surfaces only after an upgrade, far from the change that caused it.

This ADR pins the rule so it is enforced at review, not rediscovered after a
broken release.

## Considered Options

- **Modify pi's source (runtime patch, post-install patch, or fork).** Gives
  full control over any pi behavior, but every touch-point is a coupling to an
  internal detail. A semver-compatible pi release can rename/minify the target
  and the modified function stops working; a fork makes every upstream fix a
  manual merge.
- **Build on top of pi's public surface only.** Wrap, configure, and extend via
  the stable contracts pi exposes: env vars (`PI_CODING_AGENT_DIR`), CLI flags
  (`--extension`, `--skill`, `--print`, …), settings files, and the
  `pi.extensions` manifest. Behavior we need from pi is either already
  reachable through these, or contributed upstream, or approximated from the
  outside (e.g. rebrand via a CLI alias / banner, not a source rewrite).

## Decision Outcome

Chosen option: **"Build on top of pi's public surface only — never modify pi
source."** skill-pi must not alter any file inside
`node_modules/@earendil-works/pi-coding-agent` at install time, build time, or
runtime, and must not fork it. All integration is through public contracts:
env vars, CLI flags, settings, and the `pi.extensions` manifest.

Justification: a source-level touch is a coupling to a non-API internal. pi's
chunk names and token shapes are free to change between releases; the moment
we depend on them, "update pi" = "re-validate every patch we made," which
defeats the point of consuming pi by semver. Staying on the public surface
means a pi upgrade is a behavior delta we can read from pi's changelog, not a
patch audit.

### Consequences

- Good, because a pi version bump is a semver update: no patch audit, no
  fork merge, no "which chunk did they rename?" forensics after a break.
- Good, because the wrapper's blast radius is bounded to files it owns
  (`bin/`, `lib/`, `extensions/`, `package.json`), so skill-pi reviews stay
  small and reversible.
- Bad, because behaviors pi does not expose publicly must be worked around
  from the outside or pushed upstream — e.g. the current branding hook in
  `lib/brand-hooks.mjs` must be replaced by a public-surface mechanism (CLI
  alias, banner, or an upstream `piConfig` knob) rather than kept.
- Bad, because the public surface is smaller than the full source; when pi
  lacks a knob we need, we are blocked until pi ships it (tracked as an
  upstream issue, not a local patch).

## Follow-up

- **Resolved (2026-10-14):** the branding hook was migrated to the public
  surface. pi exposes a `piConfig.name` knob in `package.json`
  (`config.js`: `APP_NAME = pkg.piConfig?.name || "pi"`); the wrapper now writes
  an overlay package.json (`{ piConfig: { name: "skill-pi" } }`) under the agent
  dir and sets `PI_PACKAGE_DIR` to it, so `APP_NAME`/`APP_TITLE` become
  "skill-pi" with no source patch. Because `ENV_AGENT_DIR`/`ENV_SESSION_DIR`
  derive from `APP_NAME.toUpperCase()`, the wrapper keeps setting the literal
  `PI_CODING_AGENT_DIR` (the old repo's launcher hit this exact trap).
  `lib/brand-preload.cjs` + `lib/brand-hooks.mjs` are removed; the chunk-name
  coupling is gone, so no acknowledged exception remains.
- Review rule: any PR that adds a reference to a pi-internal chunk filename,
  a `patch-package`/`postinstall` edit of pi, or a fork of pi is blocked until
  this ADR is superseded.
