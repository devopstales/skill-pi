# providers

Dir-level index for bundled model-provider extensions. Loaded by the skill-pi
wrapper through `extensions/package.json` → `pi.extensions: ["./providers/index.ts"]`.

## Layout

| Path | Package | What it is |
|------|---------|------------|
| [`pi-free/`](./pi-free/README.md) | [`pi-free`](https://github.com/apmantza/pi-free) (apmantza) | Upstream provider package, vendored here and re-exported through `index.ts` |
| [`zen/`](./zen/) | [`opencode-zen-oauth`](https://www.npmjs.com/package/opencode-zen-oauth) (Naab2k3) | OpenCode Zen OAuth provider (device flow), vendored as raw TS |
| [`antigravity/`](./antigravity/) | [`pi-agy`](https://www.npmjs.com/package/pi-agy) (shakthi-sagar) | Antigravity OAuth multi-account provider, vendored as raw TS |

`index.ts` composes the three: `await base(pi)` (pi-free entry), then
`registerZen(pi)` and `registerAntigravity(pi)` when not disabled by the
`SKILL_PI_DISABLE_PROVIDERS` seam (see `test/providers.seam.test.js`).

## Adding a provider extension

1. Drop the package under `providers/<name>/` (built `dist/` or source with an
   `index.ts`).
2. Add a re-export module (see `pi-free/base.js`) and register it in
   `providers/index.ts`.
3. If it needs new runtime deps, add them to `extensions/package.json`
   (dir-level manifest, hoisted by the root `npm install`).

## Provenance

| Vendored path | Upstream | Version | License | ADR-0002 edits |
|---------------|----------|---------|---------|----------------|
| `pi-free/dist/`, `pi-free/package.json`, `pi-free/CHANGELOG.md`, `pi-free/base.js` | [apmantza/pi-free](https://github.com/apmantza/pi-free) | 2.8.4 | MIT | `dist/lib/paths.js`: `PI_DATA_DIR` + new `resolveAgentDir()` read `PI_CODING_AGENT_DIR` first, falling back to `~/.pi` / `~/.pi/agent`; `dist/config.js`: `readAuthJsonKey` reads agent-dir `auth.json` via `resolveAgentDir()`; `dist/lib/telemetry.js`: telemetry path resolves through the agent dir; `dist/providers/qoder/cosy.js`: machine-id fallback path via `resolveAgentDir()`. No other changes. |
| `zen/auth.ts`, `zen/models.ts`, `zen/free-tier.ts`, `zen/v2-gate.ts`, `zen/provider.ts` | [opencode-zen-oauth](https://www.npmjs.com/package/opencode-zen-oauth) | 1.2.6 | MIT | none |
| `antigravity/src/`, `antigravity/provider.ts` | [pi-agy](https://www.npmjs.com/package/pi-agy) | 0.6.1 | MIT | none (`src/accounts/store.ts` already honors `PI_CODING_AGENT_DIR`) |

### ADR-0002: home-path audit of the vendored tree

`grep -rn "\.pi/agent\|HOME\|os.homedir\|/home/" extensions/providers/` plus a
supplementary `os.homedir`/`homedir()` pass. Every code-level hit is classified
below; doc-comment mentions of `~/.pi/agent` (kilo, cline, llm7, pi-ai-loader,
constants) describe pi's own credential store and resolve through pi's
`PI_CODING_AGENT_DIR` (safe).

| Location | Classification |
|----------|----------------|
| `pi-free/dist/lib/paths.js` — `PI_DATA_DIR` (was `join(homedir(), ".pi")`) | (b) confirmed hardcoded write — FIXED: resolves through `PI_CODING_AGENT_DIR` |
| `pi-free/dist/config.js` — `readAuthJsonKey` (was `join(PI_DATA_DIR, "agent", "auth.json")`) | (b) confirmed hardcoded read — FIXED: resolves through `PI_CODING_AGENT_DIR` |
| `pi-free/dist/lib/telemetry.js` — `TELEMETRY_FILE` (captured `PI_FREE_TELEMETRY_FILE` at module scope) | (b) confirmed hardcoded write — FIXED: path now resolves through the agent dir |
| `pi-free/dist/providers/qoder/cosy.js` — `getMachineId` fallback (was `~/.pi/agent/qoder-machine-id`) | (b) confirmed hardcoded write — FIXED: resolves through `PI_CODING_AGENT_DIR` |
| `pi-free/dist/providers/qoder/models.js` — `CACHE_PATH` = `~/.pi/agent/qoder-models-cache.json` | (a) pi-owned agent-dir read — read-only in this build, no write path; recorded for completeness, not edited (minimal-diff rule) |
| `pi-free/dist/providers/cline/cline-auth.js` — `~/.cline/data/settings/providers.json` | (a) external-tool (Cline CLI) config, read-only fallback; outside `~/.pi`, safe |
| `pi-free/dist/providers/qoder/cosy.js` — `~/.qoder/.auth/machine_id` | (a) external-tool (Qoder) config, first-choice read; outside `~/.pi`, safe |
| `pi-free/dist/lib/pi-ai-loader.js` — `~/.pi/agent/npm/node_modules` | (a) read-only resolution probe of pi's agent npm dir; never writes |
| `antigravity/src/accounts/store.ts` — agent dir | (a) already honors `PI_CODING_AGENT_DIR`; no edit |
| `dist/vendor/*` (minified) | (a) bundled third-party deps; no state writes (no fs usage in the audit) |

The confinement regression test is `test/providers.separation.test.js`
(G3/G4): it runs the full entry under a temp `PI_CODING_AGENT_DIR`, asserts
every state path resolves under it, and asserts no new file appears under
`~/.pi`.

## License

See each package's own README — all three are MIT.
