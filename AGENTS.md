# skill-pi

Isolated pi-based coding agent (thin wrapper around `@earendil-works/pi-coding-agent`).
See `README.md` for the full picture.

<!-- skillgrid:start -->
## Skillgrid

This project is configured with Skillgrid. Project: **skill-pi**.

Config: `.skillgrid/config.yaml` (static) — read it before running any Skillgrid skill.
State: `.skillgrid/state.yaml` (dynamic) — where the project is right now (phase, current change, progress).

### Artifacts

| Artifact | Path |
|----------|------|
| Project knowledge (PRD, architecture, terms, ADRs, constraints, research) | `.skillgrid/artifacts/` |
| Project state (phase, current change, progress) | `.skillgrid/state.yaml` |
| Specs (briefing, blueprint, tasks) | `.skillgrid/specs/` |
| Execution ledger | `.skillgrid/sdd/` (gitignored) |

**Domain model:** read the vocabulary + ADRs under `.skillgrid/artifacts/` (index: `README.md`) and `.skillgrid/ASSUMPTIONS.md` (§ LOCKED) before designing or implementing.

**Rules & standards:** operational rules are owned by this file's `### Rules` section (the real source — edit there). Shared standards are referenced, never inlined — each loads via the skills that apply it.

- **Coding conventions** — reference `.agents/skills/_shared/rules/code-standards.md` for detailed coding conventions.
- **Testing conventions** — reference `.agents/skills/_shared/references/strict-tdd.md` for the TDD cycle and testing conventions.
- **Commits & verification** — reference `.agents/skills/_shared/rules/commits.md` for the commit contract, `.agents/skills/_shared/rules/verification-ladder.md` for the verification ladder, and `.agents/skills/_shared/planning/rigor-tiers.md` for rigor tiers.
- **Memory, code index & web cache** — reference the `skillgrid:mnemonic` skill (shared rules: `.agents/skills/_shared/rules/mnemonic-memory.md`, `.agents/skills/_shared/rules/mnemonic-artifacts.md`, `.agents/skills/_shared/rules/mnemonic-code-indexing.md`).

### Rules

- No comments in code unless asked.
- Keep changes minimal and scoped.
- Verify before claiming: run the tests, read the output, then report.
- Never read or write the stock `~/.pi/agent` — isolation is the product.
- The wrapper only sets `PI_CODING_AGENT_DIR`; never set `PI_PACKAGE_DIR`.

### Issue Tracker

GitHub — reference `.agents/skills/_shared/rules/ticketing/github.md` for conventions.

### Memory

Persistent memory is active (Mnemonic). Use `mem_save` for decisions, `mem_search` for recall, `code_status` → `code_index` → `code_search` for code orientation. Full protocol: `skillgrid:mnemonic` skill.

### Workflow

`brainstorming` → `writing-blueprints` → `slicing` → `ticketing` → execution (`subagent-execution` or `simple-execution`) → `qa` → `requesting-code-review` → `receiving-code-review` → `ship` → `reflect`

Run `skillgrid:onboarding` to update config after stack changes.
<!-- skillgrid:end -->

## Conventions

- No comments in code unless asked.
- Keep changes minimal and scoped.
- Verify before claiming: run the tests, read the output, then report.
