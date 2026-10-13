# skill-pi

Isolated pi-based coding agent (thin wrapper around `@earendil-works/pi-coding-agent`).
See `README.md` for the full picture.

<!-- skillgrid-sdd:start -->
## Agent skills

Skillgrid SDD is active in this repo. The workflow, registry, and tracker below are the source of truth for agent work here.

### Workflow
`onboard → propose → spec → apply ⇄ verify → archive` (optional explore / design-spike before locking change.md)

- Project facts (stack, testing, tracker, conventions): `docs/skillgrid/config.yaml` and Mnemonic (`sdd/{project}/…`)
- Glossary: `docs/skillgrid/glossary/`
- Triage labels: `docs/skillgrid/agents/issue-tracker.md` + the tracker's label map
- Skill registry (optional index): `docs/skillgrid/agents/skill-registry.md`

### Issue tracker
GitHub Issues via `gh` on `devopstales/skill-pi`. See `docs/skillgrid/agents/issue-tracker.md`.
<!-- skillgrid-sdd:end -->

## Conventions

- No comments in code unless asked.
- Keep changes minimal and scoped.
- Verify before claiming: run the tests, read the output, then report.
