# ADR Review Manifest — 2026-10-13-ask-user

ADR review for the bundled `ask_user` extension change. No ADR file was created by
this change — it is a feature change, not an architectural decision. This manifest
records the in-force ADR set the implementation must respect, and the one naming
constraint ADR-0005 imposes on how this extension (and any split of it) is published.

## In-force ADRs reviewed

| ADR | Status at review | Relevance to this change |
|-----|------------------|--------------------------|
| [ADR 0001](../../artifacts/04-adr-0001-extension-loading-via-dir-manifest.md) | accepted | Governs how the bundled extension is loaded: register `./ask-user.ts` in `extensions/package.json` `pi.extensions`. The change's Step 01 does exactly this. |
| [ADR 0002](../../artifacts/04-adr-0002-full-separation-from-pi.md) | proposed | Separation invariants: the extension writes no state to `~/.pi` or `<repo>/.pi`; agent dir is `~/.skill-pi/agent`. Matches the change's "no user data or session state" claim. |
| [ADR 0003](../../artifacts/04-adr-0003-taskfile-as-automation-standard.md) | accepted | `Taskfile.yml` is the automation surface; no new non-Taskfile lifecycle ops are introduced by this change. |
| [ADR 0004](../../artifacts/04-adr-0004-extensions-as-separately-published-packages.md) | superseded (scope) by ADR-0005 | If `ask_user` is ever split into a separately published package, it follows ADR-0004's model (separately published, independently versioned, `pi install`-able). |
| [ADR 0005](../../artifacts/04-adr-0005-package-naming-devopstales-scope.md) | accepted | **Naming constraint:** any published package derived from this extension must be named `@devopstales/pi-ask-user` (not `@skill-pi/pi-ask-user`). All `@skill-pi/*` references in ADR-0004 are read as `@devopstales/*`. |

## ADR files created by this change

None.

## ADR files superseded by this change

None.

## Notes for executors

- The change touches `extensions/`, `test/`, `package.json`, `README.md` only — no
  package `name` changes, no npm publish, no monorepo restructure. ADR-0005's naming
  applies **at publish time** if/when this extension is split out; it does not alter
  the in-tree file layout or the bundled `extensions/ask-user.ts` path.
- If the ADR-0004 monorepo restructure lands before this change's first publish, the
  extension file moves to `packages/pi-ask-user/` and the package `name` is
  `@devopstales/pi-ask-user` per ADR-0005 D2.
