# Review — lsp

> Change: `.skillgrid/specs/2026-10-16-lsp-extension/`
> Generated: 2026-10-16T12:00:00+02:00 (requesting-code-review)
> Diff: commits `429fe5d` + `5e66f28` (the `extensions/lsp/` port + suggestion fixes; interleaved command-plate commits excluded)
> Rigor tier: T2 (Beta) — three-axis review
> Independence: Grade B per axis (fresh subagent context, same model family as the implementer)

## What Important means

- **Critical** — must fix before merge. Security, data loss, broken functionality, a hard standard breach. Blocks ship.
- **Important** — should fix before merge. Architecture drift from a term or in-force ADR, a hard standard breach, missing/partial requirement, or scope creep.
- **Minor** — nice to have. Baseline smells, style, doc polish. Capped to 5 listed.

## Passes

### Standards

- **Worst issue (within this axis):** `minimatch` is a phantom runtime dep — present in root `node_modules` (hoisted from pi's tree) but absent from root `package.json`, violating ADR 0007's explicit root-resolution contract.
- **Findings:** 1 Critical / 4 Important / 4 Minor (capped)
- **Verdict:** met-with-fixes

### Spec

- **Worst issue (within this axis):** none — every briefing success criterion is backed by code + a named passing test.
- **Findings:** 0 Critical / 0 Important / 1 Minor (eagerInit is a small additive knob not named in the briefing; acceptable for a fast-track port)
- **Verdict:** met

### Security

- **Worst issue (within this axis):** project-scope `lsp.conf` names and spawns an arbitrary executable (CWE-94 / ASI05) — opening a repo runs its chosen LSP server.
- **Findings:** 0 Critical / 0 High / 2 Medium / 2 Low / 2 Info
- **Verdict:** secure-with-fixes

## Findings

### Critical

- **[Standards]** `extensions/lsp/package.json` vs root `package.json` — `minimatch` (the extension's only runtime dep) is not declared in the root `dependencies`. ADR 0007 (quoting the `file-search`/`permission` precedent): "an extension's runtime npm packages must also be present in the root `node_modules` to load… the root carries the same packages." Currently it only resolves because npm hoists it from pi's dep tree (phantom). A clean global install or a future pi dep-shuffle breaks `import { minimatch } from "minimatch"` at first `code_symbols` call. **Fix:** add `minimatch: ^10.2.3` to root `package.json` dependencies.

### Important

- **[Standards]** `index.ts:33,35` — swallowed errors (`.catch(() => {})` on eager `getClient`; bare `catch {}` around `loadConfig`). A misconfigured `lsp.conf` at session start dies silently; the tool later fails with a far-away "No lsp.conf found". Code-standards: "an error that's caught and ignored must be justified in writing." **Fix:** log once per session (config path in the message).
- **[Standards]** `lsp-client.ts:190-237` vs `fake-lsp-server.ts:215-236` — Duplicated Code: near-identical Content-Length framing parse loops. **Fix (Optional):** extract a small shared framing helper.
- **[Standards]** `config.ts:185-201` — Divergent Change / hidden dependency: `loadConfig(cwd)` resolves the project conf from `git rev-parse` on the raw cwd; if the session starts outside the repo, it reads `<cwd>/.skill-pi/...` (absent) and throws even though the repo-root conf exists. **Fix (Optional):** document the "session must start inside the repo" constraint in README.
- **[Standards]** `source-extractor.ts` + `types.ts:3` — Speculative Generality: `SourceExtractor` (async, unused `_serverTreeSitterLanguage` param, impossible `undefined` return) + exported-but-unused `ServerTransport = "stdio"`, both seams for the out-of-scope tree-sitter feature. **Fix (Consider):** inline the slice, drop `ServerTransport`, or name the seam in the README.

### Minor

- **[Standards]** `config.ts:240-276` — Primitive Obsession: language routing via bare strings + a hand-rolled extension switch. (Judgement call; acceptable for a ported fork.)
- **[Standards]** `lsp-client.ts:55-70` + `source-extractor.ts:13-32` — Duplicated line-offset math in 3 places. (Becomes moot if the extractor is inlined.)
- **[Standards]** `config.ts:161-167` — `defaultLimit`/`maxLimit`/`eagerInit` accepted but not type-validated like the other fields. (Optional.)
- **[Security]** `tool.ts:33-35` + `config.ts:328-336` — `limit` schema has no `minimum: 1`; `NaN`/fractional `limit` coerces via `.slice` (benign). (Optional.)
- **[Security]** `config.ts:52-54` — `stripJsonComments` removes `//` inside string literals (breaks URLs in config args). (Optional; document that `//` in strings is unsupported.)

### Accepted / Documented (not fixed in-loop)

- **[Security][MEDIUM]** Project-scope `lsp.conf` → arbitrary `spawn` (CWE-94, ASI05). Accepted: the project conf lives at `<git-root>/.skill-pi/conf.d/` — the *same* trust boundary the user already accepts for `settings.json`/`AGENTS.md` in the repo they opened; the user reviews the repo before working in it. `eagerInit` defaults to `false` (lazy spawn on first tool call), narrowing the window. Documented in the extension README (trust-model note).
- **[Standards]** `package.json` `private: true` (reviewer's #6) — **reviewer error**: 9/10 extension packages are publishable (`@devopstales/*` + publishConfig + .npmrc); only `skill-pi-tui` is private. `lsp` matches the family convention, not a drift.

## Reviewer notes (non-findings)

- **Spec** — no RED→GREEN evidence (tests + impl landed in the same port commit). Acceptable for a `small` fast-track port; noted per the skill.
- **Spec** — `command.env` merging is exercised indirectly (the fake server is driven entirely by env, so every passing test proves env reaches the child). Not a gap.

## Independence

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | B | fresh `reviewer` subagent, no session history; same model family as the implementer |
| Spec | B | fresh `reviewer` subagent, no session history; same model family |
| Security | B | fresh `reviewer` subagent, no session history; same model family |

**Reading the grade:** B = fresh context but same model family / toolchain as the implementer (independent, weaker than A). No leaks: reviewers received the diff range + named standards/spec/security sources only — no session narrative, rationale, or prior verdict.

## Verdict

- **Standards:** met-with-fixes
- **Spec:** met
- **Security:** secure-with-fixes
- **Floor (decides):** met-with-fixes
- **Worst issue (across all three axes):** `minimatch` phantom root dep (ADR 0007 breach) — Critical, local fix.
- **Unfixed Important count (must be 0 to proceed):** 0 (Critical + Important to be fixed before ship; Minors + the security Medium accepted/documented).
