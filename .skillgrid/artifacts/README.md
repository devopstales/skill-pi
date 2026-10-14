# Artifacts — topic index

Durable, cross-change project knowledge (committed). Per-change artifacts live in `../specs/` and `../archive/`.

| File | What it is |
|------|-----------|
| `00-prd.md` | Product requirements reference (what skill-pi is / is not) |
| `01-business-terms.md` | Domain/product/workflow vocabulary (was glossary/business.md) |
| `02-technical-terms.md` | Architecture/platform/protocol vocabulary (was glossary/technical.md) |
| `04-adr-0001-extension-loading-via-dir-manifest.md` | ADR 0001 — bundled extensions via explicit enumeration + `--no-extensions` (accepted) |
| `04-adr-0002-full-separation-from-pi.md` | ADR 0002 — full separation: skill-pi never loads any `.pi` (proposed) |
| `04-adr-0003-taskfile-as-automation-standard.md` | ADR 0003 — Taskfile.yml as automation standard (accepted) |
| `04-adr-0004-extensions-as-separately-published-packages.md` | ADR 0004 — extensions as separately published pi packages (proposed) |
| `04-adr-0006-never-modify-pi-source.md` | ADR 0006 — never modify pi source; build on its public surface (accepted) |
| `04-adr-0007-self-contained-extensions.md` | ADR 0007 — bundled extensions are self-contained subdirs; runtime deps resolve via root (proposed) |
| `06-research-findings.md` | Cross-change distilled research (carried forward from specs) |
| `issue-tracker.md` | GitHub Issues conventions (`gh`, devopstales/skill-pi) |
| `triage-labels.md` | Label map used by the tracker |

New ADRs: one file per decision, `04-adr-NNNN-slug.md`, madr-minimal (see `.skillgrid/config.yaml` `adr_style`); add a pointer row to `.skillgrid/ASSUMPTIONS.md` § LOCKED in the same edit.
