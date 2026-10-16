# webfetch — Design Briefing

> **STATUS:** `accepted` (2026-10-16) — plan agreed with user in-session:
> "copy and homogenize the code-yeongyu/pi-webfetch plugin using the
> trafilatura from georgebashi/pi-web-fetch".

## Problem / Intent

skill-pi has no bundled web-fetching tool. The agent ecosystem ships two
reference implementations for pi:

- **code-yeongyu/pi-webfetch** (MIT) — a `webfetch` tool with a clean contract
  (`url`, `format`, `timeout`), a robust undici fetcher (bounded redirects,
  30s/120s timeout, 5MB response cap), output capping, and TUI renderers. Its
  HTML conversion is Readability + jsdom + Turndown — four heavy deps and a
  regex-era converter.
- **georgebashi/pi-web-fetch** (MIT) — headless Chrome + trafilatura
  (ML-based boilerplate removal) + LLM sub-agent + batch mode + browser pool +
  15-min cache. Strong extraction, heavy machinery.

Intent: one bundled `webfetch` extension that keeps the lightweight static-HTTP
contract of the first and swaps its conversion for trafilatura from the second.

## Purpose & Success Criteria

- The extension registers exactly one tool, `webfetch`, with parameters
  `url` (required), `format` (`markdown` | `text` | `html`, default
  `markdown`), `timeout` (seconds, default 30, capped at 120).
- Fetching is static undici HTTP: redirects followed (bounded), 30s default /
  120s max timeout, 5MB response cap (checked by Content-Length and while
  reading the body), Accept header weighted for the requested format,
  browser-like headers.
- HTML responses in `markdown`/`text` mode are extracted with trafilatura
  (`trafilatura --markdown --formatting`, HTML on stdin, markdown on stdout);
  the Python runner is auto-detected in priority order `uvx` → `uv run` →
  `pipx` → `pip-run`. `html` mode and non-HTML responses pass through
  unchanged.
- When no Python runner is available the tool still succeeds: it returns the
  decoded body instead of failing.
- Built-in site handlers short-circuit matching URLs before fetching: GitHub
  URLs → `gh` CLI suggestions, Google Docs URLs → workspace tools. Other
  extensions can register handlers via `pi.events.emit("webfetch:register", handler)`;
  event-bus handlers win over built-ins.
- Output is bounded with pi's shared `truncateHead` (2000 lines / 50KB
  defaults) plus a truncation notice.
- `SKILL_PI_WEBFETCH=0` (and false/no/off) disables the extension: no tool
  registered, no event subscriptions. Default on.
- The extension loads via the wrapper's `collectExtensionFiles` auto-discovery
  (subdirectory `index.ts`) with no manifest change.

## Constraints

- Never modify pi source (ADR-0006); build on the public surface
  (`registerTool`, `events`, `exec`, shared truncate utils).
- Self-contained extension dir (ADR-0007): own `package.json`, own tests,
  own tsconfig extending `../skill-pi-tui/tsconfig.json`, `.ts` import
  suffixes (house pattern).
- ADR-0005 naming: `@devopstales/pi-webfetch`.
- No headless Chrome: puppeteer and the browser pool are explicitly dropped;
  JS-rendered pages are out of scope (the tool reports it when trafilatura
  finds no content).
- MIT: both upstreams are MIT; LICENSE retained, provenance recorded in README.
- No comments in code unless asked. Keep changes minimal and scoped.
- Isolation: the extension never touches `~/.pi/agent`; it uses no conf.d
  config (env-only seams).

## Out of Scope

- Batch fetching (`pages` parameter), LLM sub-agent processing/summarization,
  15-minute cache, browser pool / headless Chrome, per-site local extension
  dir loading — all georgebashi machinery that only exists to serve the
  headless-Chrome pipeline.
- The 4-stage hook system (`afterFetch`/`afterExtract`/`summarize`); only
  `beforeFetch` short-circuiting is ported.
- conf.d configuration (ADR-0008) — nothing to configure beyond the env seam.
- Publishing to the npm registry.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- T1: A `webfetch` tool is registered with the exact contract (name, params,
  default-on toggle) — provable by invoking the extension factory with a mock
  `pi` and asserting `registerTool` shape.
- T2: A fetched HTML URL comes back as clean markdown extracted by trafilatura
  — provable end-to-end against a live URL (held-out: real network).
- T3: A non-HTML response passes through unchanged; `html` format returns raw
  HTML — provable against a live URL.
- T4: A GitHub URL short-circuits to `gh` CLI suggestions without fetching —
  provable by invoking the tool and asserting the result contains the
  suggestion and no fetch occurred (no network, fast path).
- T5: With `SKILL_PI_WEBFETCH=0`, the factory registers nothing and
  subscribes to no events — provable with a mock `pi`.
- T6: The output cap applies — provable with a synthetic oversized text input
  to the exported cap function.

**Gates** (runnable shadow of the truths):
- G1: `npx vitest run` in `extensions/webfetch` — all tests pass (covers T1,
  T4, T5, T6 at the unit layer).
- G2: `npx tsc --noEmit -p .` in `extensions/webfetch` — zero errors.
- G3: `node --experimental-strip-types .smoke.mjs` — live fetch of a real URL
  through `createWebfetchTool().execute` returns trafilatura markdown
  (covers T2, T3). Held-out: depends on network + `uvx`.
