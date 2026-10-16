# webfetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skillgrid:subagent-execution or simple-execution to implement this plan task-by-task.

**Status:** PROPOSED (implemented in-session 2026-10-16; QA run same day)

**Tier:** T2

**Classification:** standard — fork-and-homogenize of two MIT pi extensions; new bundled capability; no migration; no trust-boundary change beyond outbound HTTP (existing for all pi tools).

**Goal:** A bundled `webfetch` extension for skill-pi: static undici fetch + trafilatura HTML-to-markdown extraction, homogenized from code-yeongyu/pi-webfetch (base) and georgebashi/pi-web-fetch (extraction + site handlers).

**Architecture:** `extensions/webfetch/` with a top-level `index.ts` entry (house pattern, auto-discovered by `collectExtensionFiles`). `src/webfetch/fetcher.ts` is the upstream undici fetcher (verbatim port). `src/webfetch/extract.ts` runs trafilatura in an ephemeral Python environment (runner auto-detect: uvx → uv → pipx → pip-run; 30s extraction timeout; abort-aware). `src/webfetch/tool.ts` defines the `webfetch` tool via `defineTool`, wires fetch → beforeFetch handler short-circuit → trafilatura → `truncateHead` cap. `src/webfetch/registry.ts` + `types.ts` hold the simplified single-hook (`beforeFetch`) site-handler contract; `handlers/` ships the GitHub and Google Docs redirects. `src/webfetch/renderers.ts` are the upstream TUI renderers adapted to the trafilatura details (extracted/runner fields). Env seam `SKILL_PI_WEBFETCH` (skill-pi convention, default-on).

**Tech Stack:** TypeScript (NodeNext, `.ts` import suffixes, tsconfig extends `../skill-pi-tui/tsconfig.json`), `typebox` + `@earendil-works/pi-ai` StringEnum, `undici` (root), `picomatch` (own dep for glob matching), vitest.

**Spec:** `.skillgrid/specs/2026-10-16-webfetch-extension/briefing.md`

## Tasks

### Task 1 — Vendor base fetcher + errors

Port `fetcher.ts` and `errors.ts` from code-yeongyu/pi-webfetch verbatim (`.ts` import suffix fix). Keep the undici request loop, redirect bounds, 5MB cap, Accept negotiation, browser-like headers.

**SATISFIES:** R-tool-contract (fetch layer)

### Task 2 — Trafilatura extraction module

Port the Python-runner detection + stdin-pipe extraction from georgebashi/pi-web-fetch into `extract.ts`. Add: synchronous runner detection (binary presence + cache presence), 30s extraction timeout, abort-aware settle, "no content" error, runner cache pre-check for zero-network steady state.

**SATISFIES:** R-trafilatura-extraction

### Task 3 — Tool definition + handlers

`tool.ts`: `defineTool` with url/format/timeout; beforeFetch short-circuit via `HandlerRegistry`; trafilatura for HTML + markdown/text; `truncateHead` capping; details with extracted/runner. `registry.ts`/`types.ts`: single-hook contract. `handlers/`: GitHub (gh CLI) + Google Docs redirects.

**SATISFIES:** R-github-redirect, R-eventbus-handler, R-plaintext-passthrough, R-html-format

### Task 4 — Entry point + renderers + env seam

`index.ts`: factory with `SKILL_PI_WEBFETCH` toggle (default on), registry build, `webfetch:register` event subscription, `registerTool` with renderers. `renderers.ts`: upstream renderers adapted to the trafilatura details.

**SATISFIES:** R-tool-contract, R-disable-env, R-output-cap

### Task 5 — Loader wiring + docs

No manifest change needed (auto-discovery). Root README extension entry. Extension README with origin/provenance, dropped-machinery list, JS-rendered caveat.

**SATISFIES:** R-loader

## Rollback

`git rm -r extensions/webfetch` + revert the README hunk. No state, no config, no migration. The tool is additive: removing it restores the pre-change tool surface exactly.

## Success Criteria

- `npx vitest run` in `extensions/webfetch`: all tests pass.
- `npx tsc --noEmit -p .`: zero errors.
- Live E2E: real HTML URL → trafilatura markdown; text/plain → passthrough; github.com → gh suggestions; `SKILL_PI_WEBFETCH=0` → no registration.
- Wrapper `collectExtensionFiles` includes `extensions/webfetch/index.ts`.
- Root suite `node --test "test/**/*.test.js"` still green (no regression).
