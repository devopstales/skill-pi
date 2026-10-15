# providers

Dir-level index for bundled model-provider extensions. Loaded by the skill-pi
wrapper through `extensions/package.json` → `pi.extensions: ["./providers/index.ts"]`.

## Layout

| Path | Package | What it is |
|------|---------|------------|
| [`pi-free/`](./pi-free/README.md) | [`pi-free`](https://github.com/apmantza/pi-free) (apmantza) | Upstream provider package, vendored here and re-exported through `index.ts` |

`index.ts` is a thin re-export: it imports `pi-free`'s compiled entry via
`base.js` and forwards it, so the wrapper discovers one stable extension entry
regardless of how the vendored package is updated.

## Adding a provider extension

1. Drop the package under `providers/<name>/` (built `dist/` or source with an
   `index.ts`).
2. Add a re-export module (see `pi-free/base.js`) and register it in
   `providers/index.ts`.
3. If it needs new runtime deps, add them to `extensions/package.json`
   (dir-level manifest, hoisted by the root `npm install`).

## License

See each package's own README — `pi-free` is MIT.
