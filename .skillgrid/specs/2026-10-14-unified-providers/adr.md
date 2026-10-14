# ADR Review Manifest — 2026-10-14-unified-providers

ADR review for the unified providers extension change (merging `pi-free`,
`opencode-zen-oauth`, and `pi-agy` into one bundled extension). No ADR file is
created by this change — it is a feature change, not a new architectural
decision. This manifest records the in-force ADR set the implementation must
respect and the constraints each imposes.

## In-force ADRs reviewed

| ADR | Status at review | Relevance to this change |
|-----|------------------|--------------------------|
| [ADR 0001](../../artifacts/04-adr-0001-extension-loading-via-dir-manifest.md) | accepted | Governs loading: register the new entry `./providers/index.ts` in `extensions/package.json` `pi.extensions`. All runtime imports of the vendored code must resolve relative to `extensions/` (the dir passed via `--extension`), so new deps land in `extensions/package.json`, not the wrapper root. |
| [ADR 0002](../../artifacts/04-adr-0002-full-separation-from-pi.md) | proposed | Separation invariants: the extension writes all state (auth, telemetry, caches, account store) to the agent dir `~/.skill-pi/agent`, never `~/.pi` or `<repo>/.pi`. The vendored code's hardcoded `~/.pi/agent/auth.json` references must resolve through pi's own credential store (which pi already redirects via `PI_CODING_AGENT_DIR`), not a literal path. |
| [ADR 0003](../../artifacts/04-adr-0003-taskfile-as-automation-standard.md) | accepted | New lifecycle ops (install/vendor deps, test the extension) are `Taskfile.yml` tasks; `package.json` scripts are shims only. |
| [ADR 0004](../../artifacts/04-adr-0004-extensions-as-separately-published-packages.md) | superseded (scope) by ADR-0005 | If this extension is later split into a published package it follows the separately-published model. Not triggered by this change (stays in-tree). |
| [ADR 0005](../../artifacts/04-adr-0005-package-naming-devopstales-scope.md) | accepted | **Naming constraint:** if/when the unified extension is split into a package it is named `@devopstales/pi-unified-providers` (or `@devopstales/pi-<name>`). Does not alter in-tree layout. |
| [ADR 0006](../../artifacts/04-adr-0006-never-modify-pi-source.md) | accepted | Build on pi's public surface only: extensions register providers via `pi.registerProvider` / pi-ai `createProvider`; no fork, no runtime patch, no post-install edit of pi. |

## ADR files created by this change

None.

## ADR files superseded by this change

None.

## Notes for executors

- The change touches `extensions/`, `test/`, `Taskfile.yml`, `README.md`, and
  `extensions/package.json` only. No package `name` change, no npm publish, no
  monorepo restructure.
- **Dependency placement is load-bearing (ADR-0001):** pi loads the `--extension`
  dir before its package-manager install step. Raw-TS extension imports resolve
  from the extension's own location, so the three upstreams (or their transitive
  deps) must be declared in `extensions/package.json` and hoisted into the tree
  so jiti can import them. Do not add them to the wrapper root `package.json`.
- **pi-free is the base as-is.** Its 26 providers, registry, free filter,
  telemetry, auto-fallback, quota monitoring, and built-in re-registration are
  ported verbatim. The two OAuth providers are *added on top*, not folded into
  pi-free's free-filter re-registration (they are paid-first OAuth providers).
  The composition seam (one place that registers the base then adds providers,
  with a per-provider toggle) is the only new logic; everything else is vendored
  and unchanged.
- ADR-0002 credential invariants: verify at execution that the ported auth flows
  (Zen device-flow, Antigravity callback-server, pi-free API-key/OAuth) persist
  into `~/.skill-pi/agent/auth.json` and never `~/.pi/agent/auth.json`.
