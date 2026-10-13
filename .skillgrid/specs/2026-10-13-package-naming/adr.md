# ADR Review Manifest — package naming (`@devopstales` scope)

ADR review completed for the package-naming decision. No SDD change is in flight for
this topic; it is a standalone architectural correction recorded directly.

## In-force ADRs reviewed

| ADR | Status at review | Disposition |
|-----|------------------|-------------|
| [ADR 0001](../../artifacts/04-adr-0001-extension-loading-via-dir-manifest.md) | accepted | Reviewed; unchanged (loading mechanism, not naming). |
| [ADR 0002](../../artifacts/04-adr-0002-full-separation-from-pi.md) | proposed | Reviewed; naming does not affect separation invariants. |
| [ADR 0003](../../artifacts/04-adr-0003-taskfile-as-automation-standard.md) | accepted | Reviewed; publish pipeline stays a Taskfile surface. |
| [ADR 0004](../../artifacts/04-adr-0004-extensions-as-separately-published-packages.md) | proposed | **Superseded (scope) by ADR 0005** — its `@skill-pi` scope/naming is replaced; its publishing model remains in force. |

## ADR files created by this change

- [ADR 0005 — Package naming: `@devopstales/skill-pi` wrapper + `@devopstales/pi-<name>` extensions](../../artifacts/04-adr-0005-package-naming-devopstales-scope.md) — `status: accepted`, `supersedes: ADR-0004`.

## ADR files superseded

- [ADR 0004](../../artifacts/04-adr-0004-extensions-as-separately-published-packages.md) — scope/naming decision only. File retained on disk as frozen history; its `## LOCKED` index row is marked superseded.

No other ADR file was mutated.
