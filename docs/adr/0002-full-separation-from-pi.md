# ADR 0002: Full separation from pi (agent dir + project dir + skill sources)

- Status: proposed
- Date: 2026-10-13
- SDD change: none yet (pre-propose decision; will become change `002-…`)
- Related: [ADR 0001](./0001-extension-loading-via-dir-manifest.md)
- Reference: `@earendil-works/pi-coding-agent@1.2.0` loader (traced from `dist/bundle/chunks/`)

## Context

`skill-pi` must be separable from stock `pi`: both run side by side with different
configs and never interfere. Today the wrapper already separates the *user* scope
(`PI_CODING_AGENT_DIR=~/.skill-pi/agent`), but project-level config still shares
pi's `.pi` directory (the shim owns an *empty* `.pi/` so the real project's `.pi/` is
unused but not read either). This ADR pins the complete separation contract.

## pi's resource resolution (verified facts, pi 1.2.0)

| Concern | pi source (traced) | Notes |
|---|---|---|
| Agent dir | `getAgentDir()` = `$PI_CODING_AGENT_DIR \|\| ~/.pi/agent` | All user paths derive: `settings.json`, `auth.json`, `sessions/`, `bin/`, `themes/` |
| Extensions (auto) | `<cwd>/.pi/extensions`, `<agentDir>/extensions` | gated by project trust |
| Skills (auto) | `<cwd>/.pi/skills`, `<agentDir>/skills`, `~/.agents/skills`, `<dir>/.agents/skills` for every ancestor up to the git repo root | the last two are **hardcoded** in pi; the ancestor walk stops at the git repo root; all gated by project trust |
| Prompts / themes (auto) | `<cwd>/.pi/prompts\|themes`, `<agentDir>/prompts\|themes` | gated by project trust |
| Project settings | `<cwd>/.pi/settings.json` | the *only* project-scope file pi reads/writes itself |
| Explicit paths | `--extension` / `--skill` args, `skills:`/`extensions:`/`prompts:`/`themes:` arrays in settings, package manifests | not gated by project trust |
| Env overrides | `PI_CODING_AGENT_DIR` (agent dir), `PI_PACKAGE_DIR` (package dir), `PI_MANAGED_INSTALL_ROOT`, `PI_INSTALLER_API_BASE`, `PI_CODING_AGENT_SESSION_DIR` | no `PI_CODING_AGENT_PROJECT_DIR` exists in pi 1.2.0 |

## Decision

### D1 — User scope (already implemented)

`PI_CODING_AGENT_DIR=~/.skill-pi/agent` is the only pi env the wrapper sets for scope.
Settings, auth, models, sessions, user extensions/skills/prompts/themes, and the trust
store all live under it. Override: `SKILL_PI_AGENT_DIR` / `--agent-dir`.
`~/.pi/agent` is never read or written by skill-pi.

### D2 — Project scope: pi reads `<cwd>/.skill-pi`, so no `.pi` is ever loaded

**Invariant: skill-pi never loads any `.pi` directory** — not the user's
`~/.pi/agent` (D1) and not any `<repo>/.pi` or shim `.pi`.

pi derives its project config dir name from the *active package's*
`package.json` `piConfig.configDir` (default `.pi`), resolved at module load via
`getPackageDir()`, which honors `PI_PACKAGE_DIR` (verified: `chunk-WJUNYZC5.js` —
`CONFIG_DIR_NAME=pkg.piConfig?.configDir||".pi"`; `getPackageDir()` reads
`process.env.PI_PACKAGE_DIR` first). skill-pi's root `package.json` therefore declares:

```json
{ "piConfig": { "configDir": ".skill-pi" } }
```

and the wrapper sets `PI_PACKAGE_DIR` to the skill-pi package root. The consequence:
pi's `projectBaseDir` becomes `<cwd>/.skill-pi` for every pi-sourced project path
(settings, extensions, skills, prompts, themes) — **`.pi` is never referenced by
skill-pi.**

Two design consequences:

1. **Run pi with cwd = the real repo (no shim).** With the project dir renamed to
   `.skill-pi`, the shim's original reason (owning an empty `.pi/` so the real project
   `.pi/` is unused) vanishes: pi now reads `<repo>/.skill-pi`, which the stock `pi`
   (still `configDir=".pi"`) never reads or writes. Project trust is anchored to
   `<repo>/.skill-pi` (the trust store itself stays per-agent-dir, D1), so `pi` and
   `skill-pi` trust the project independently. The `lib/shim.js` shim-cwd mechanism is
   **retired** — a simplification over the earlier mirror design.
2. **`.agents/skills` is now reachable for free.** pi's ancestor walk
   (`collectAncestorAgentsSkillDirs`) from the real repo cwd finds
   `<repo>/.agents/skills` directly (the walk stops at the git repo root = the repo),
   with no shim symlink needed. `~/.agents/skills` (hardcoded user dir) is likewise
   loaded. This is D3.

> If pi later ships a `PI_CODING_AGENT_PROJECT_DIR` env, D2's `PI_PACKAGE_DIR` +
> `piConfig.configDir` trick can be replaced by it; the observable contract
> ("skill-pi loads `.skill-pi`, never `.pi`") is unchanged.

### D3 — Shared (non-separating) sources: `~/.agents/skills` and `<repo>/.agents/skills`

pi hardcodes `~/.agents/skills` (user) and walks `<cwd>` ancestors collecting
`<dir>/.agents/skills` (project), stopping at the git repo root. Because skill-pi now
runs pi with **cwd = the real repo** (D2), this walk lands on `<repo>/.agents/skills`
directly — no shim, no symlink. (Under the old shim-cwd design the logical `dirname`
walk could not cross the `project` symlink and never reached the repo's `.agents`;
retiring the shim removes that problem.)

The wrapper does **not** set `HOME` (that would break npm, node, and pi's own
installs), so `~/.agents/skills` is shared between `pi` and `skill-pi` by design — the
one accepted non-separated source.

- Precedence/merge with the dedicated sources follows pi's own resource-loader rules
  (later sources win on name collision; collision diagnostics are surfaced by pi).

The four skill sources in the separation contract are therefore:
`~/.skill-pi/agent/skills` (skill-pi user), `<repo>/.skill-pi/skills` (skill-pi
project, loaded because pi's project dir is now `.skill-pi`), `~/.agents/skills`
(shared, hardcoded), `<repo>/.agents/skills` (shared, via pi's ancestor walk from the
real repo cwd).

### D4 — Isolation invariants (testable)

1. **No `.pi` is loaded by skill-pi.** A `skill-pi` run reads no `.pi` directory
   anywhere — no `~/.pi/agent`, no `<repo>/.pi`, no shim `.pi`. (Verified by strace /
   fs-access log or by the byte-identical checks in 3.)
2. `pi` run in a repo with only `.skill-pi/` reads none of it.
3. `skill-pi` run in a repo with only `.pi/` reads none of it (its project dir is
   `.skill-pi`, so a bare `.pi/` is invisible to it).
4. After a `skill-pi` run, `~/.pi/**` and `<repo>/.pi/**` are byte-identical
   (mtime-insensitive) to before.
5. After a `pi` run, `~/.skill-pi/**` and `<repo>/.skill-pi/**` are unchanged.
6. `~/.agents/skills` and `<repo>/.agents/skills` are read by both (shared by design, D3).

## Alternatives considered

- **Shim cwd + `.skill-pi → .pi` mirror** (earlier draft of this ADR) — satisfied
  separation but still had pi load a `.pi` (the shim's own), violating the
  "no `.pi` is loaded" invariant; superseded by the `piConfig.configDir` approach,
  which also lets skill-pi drop the shim.
- **Symlink the whole `.pi` dir (one symlink, not per-entry)** — rejected, same
  reason: pi would still be reading a `.pi`.
- **Fork pi with a `PI_CODING_AGENT_PROJECT_DIR` env** — cleanest long-term knob, but
  skill-pi must stay a thin wrapper (no fork); the `PI_PACKAGE_DIR` +
  `piConfig.configDir` mechanism reaches the same result today. Re-evaluate if pi ships
  the env.
- **Set `HOME` to an isolated dir for the child** — separates `~/.agents/skills` too,
  but breaks npm/node global resolution and pi's own package discovery; the shared
  `~/.agents/skills` is an accepted, documented exception instead.

## Consequences

- `package.json` gains `piConfig.configDir: ".skill-pi"`; the wrapper sets
  `PI_PACKAGE_DIR` to the skill-pi package root (re-introduced, but now to repoint the
  project dir, not to claim the active package — see the ADR 0001 note below).
- `lib/shim.js` and the shim-cwd launch path are **retired**; pi runs with cwd = the
  real repo. `SKILL_PI_WORK_DIR` / the `~/.skill-pi/work` shim dir become unnecessary.
- First-run in a project creates `<repo>/.skill-pi/` (when needed) — never `<repo>/.pi`.
- The existing "shim owns an empty `.pi`" README section is replaced by this contract.
- Invariant tests (D4), especially #1 (no `.pi` loaded), become the regression gate.
- **ADR 0001 interaction:** `PI_PACKAGE_DIR` now points at the skill-pi root, so pi
  treats skill-pi as the active package. ADR 0001's dir-manifest extension loading is
  superseded by ADR 0004 (package-manager resolution); the `--extension` flag is
  dropped, so the only effect of `PI_PACKAGE_DIR` here is the project-dir rename.

## Follow-up

- Implement as SDD change `002-project-separation` (`piConfig.configDir` +
  `PI_PACKAGE_DIR`, retire shim, invariant tests, README/glossary update).
- If pi later ships `PI_CODING_AGENT_PROJECT_DIR`, replace D2's mechanism with it;
  the observable contract is unchanged.
