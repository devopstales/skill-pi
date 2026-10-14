# Briefing — unified providers extension

**Change:** `2026-10-14-unified-providers`
**Status:** spec
**Date:** 2026-10-14

## One-liner

Bundle **one** pi extension that registers the union of the three upstream
provider plugins — `pi-free`, `opencode-zen-oauth`, and `pi-agy` — so a single
`skill-pi` install exposes free-model providers, OpenCode Zen (OAuth), and
Antigravity / Cloud Code Assist (OAuth, multi-account) without the user having
to install or wire three separate packages.

## Intent (the why)

`skill-pi` is a curated, isolated distribution of pi. Its value is "one binary,
everything you need, nothing to configure." Today a user who wants free models,
Zen, or Antigravity must `pi install` each plugin separately, manage three
auth flows, and accept three independent release cycles. This change folds those
three into one bundled extension so the distribution stays self-contained.

## Scope

**In:**
- A new bundled extension `extensions/providers/` that, on load, registers:
  - the **pi-free base as-is**: its 26 unique providers, the free/paid model
    filter + `/toggle-free` + per-provider toggles, telemetry, auto-fallback,
    quota monitoring, built-in-provider re-registration, and its diagnostic
    commands (`/pi-free-health`, `/free-startup`, `/free-telemetry`, …).
  - the **`opencode-zen` provider** (device-flow OAuth + workspace selection +
    free-tier request shaping) from `opencode-zen-oauth`.
  - the **`antigravity` provider** (Google OAuth callback-server, multi-account
    quota failover, custom `streamSimple`, `/antigravity*` commands) from
    `pi-agy`.
- One composition entry that loads the pi-free base, then adds the two OAuth
  providers into the same pi runtime, with a seam for per-provider enable/disable.
- Dependency wiring so the vendored code resolves under skill-pi's jiti-based
  raw-TS extension loading (deps land on `extensions/package.json`, the
  `--extension` dir, per ADR-0001).
- README + Taskfile documentation.

**Out:**
- Forcing the three OAuth providers through pi-free's global free-only filter
  (they are OAuth/paid-first providers, not free-gated). They coexist with the
  filter but are not re-registered by it.
- Changing pi's source or the wrapper's launch path (ADR-0006).
- The ADR-0004 monorepo restructure (separate change; this stays in-tree).
- Windows PTY E2E (existing product-level limit).

## Source of record

The three upstream tarballs, pinned:
- `pi-free@2.8.4` — `github.com/apmantza/pi-free`
- `opencode-zen-oauth@1.2.6` — `github.com/Naab2k3/pi-opencode-zen`
- `pi-agy@0.6.1` — `github.com/shakthi-sagar/pi-extensions`

## Success looks like

`skill-pi` launches; `/login opencode-zen`, `/login antigravity`, and the pi-free
provider logins all appear in one extension; `/toggle-free` still filters the
free providers; `/antigravity.usage` and the Zen free-tier gate still work; the
stock `pi` install is untouched (ADR-0002).

## Back-links

- Product: `.skillgrid/artifacts/00-prd.md`
- ADRs: see `adr.md` (this folder) for the in-force set
- Blueprint: `blueprint.md` (this folder)
