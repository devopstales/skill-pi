# pi-free (vendored)

Free and paid AI model providers for [Pi](https://pi.dev) — one install, many
providers, with a global free-only filter and per-provider toggles.

This directory vendors [`pi-free`](https://github.com/apmantza/pi-free) by
Apostolos Mantzaris (MIT). The vendored package is compiled (`dist/`) and
re-exported through [`../index.ts`](../index.ts) so the skill-pi wrapper loads it
on every session.

## Upstream

- Repository: <https://github.com/apmantza/pi-free>
- Install (stock pi): `pi install npm:pi-free`
- Docs: [provider catalog & auth](https://github.com/apmantza/pi-free/blob/master/docs/providers.md), [slash commands](https://github.com/apmantza/pi-free/blob/master/docs/commands.md), [configuration](https://github.com/apmantza/pi-free/blob/master/docs/configuration.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md) (v2.8.4 at time of vendoring)

## In skill-pi

- Loaded via `extensions/package.json` → `pi.extensions: ["./providers/index.ts"]`
  → `pi-free/base.js` → `./dist/index.js`.
- Registers native providers (Kilo, Cline, LLM7, FastRouter, Ollama Cloud,
  StepFun, ZenMux, DeepInfra, Novita, Routeway, OpenGateway, B.AI, GMI Cloud,
  Agnes AI, Venice AI, Infron AI, AnyAPI, SambaNova, TokenRouter) and captures
  Pi's built-in OpenCode / OpenCode Go / OpenRouter catalogs, refreshing them
  after session start.
- Free-only filter is on by default; per-provider toggles (`/toggle-kilo`,
  `/toggle-openrouter`, …) switch a provider between its free view and full
  catalog.
- `/pi-free-health` and `/free-startup` report diagnostics without exposing
  credentials; auto-fallback to another free model on error is opt-in via
  `/toggle-auto-fallback`.
- Uses Pi's native model and auth stores (`~/.skill-pi/agent/models-store.json`,
  `~/.skill-pi/agent/auth.json`); extension-provider API keys go in
  `~/.skill-pi/free.json` or the documented env vars.

## Upgrading

The vendored copy is a point-in-time snapshot. To pick up upstream fixes:

1. Bump to the latest published `pi-free` (npm or git).
2. Rebuild its `dist/` if you vendor from source.
3. Update `package.json` version + `CHANGELOG.md` references in this directory.
4. Re-verify with a real session (`/pi-free-health`).

## License

MIT — see [`LICENSE`](./LICENSE). Upstream: [apmantza/pi-free](https://github.com/apmantza/pi-free).
