# @devopstales/pi-file-search

First-class `fd` (find files) and `rg` (search content) tools for [pi](https://pi.dev) coding agents.

## What it does

On session start the extension resolves a usable binary for each tool:

1. A normally installed system binary (`fd`/`fdfind`, `rg`) is preferred — used silently.
2. An existing fallback binary in the package's `bin/` directory is used silently.
3. Only when neither exists does it download an official release into `bin/` — the single case that shows a UI notification.

Tools await that initialization before executing and report a clear error if it failed.

Supported platforms: darwin (x64, arm64) and linux (x64, arm64 — musl builds, statically linked).

## Install

### As a pi extension

```sh
pi install @devopstales/pi-file-search
```

Or install manually and pass the entry point to pi:

```sh
npm install @devopstales/pi-file-search
pi --extension node_modules/@devopstales/pi-file-search/index.ts
```

The extension exposes `index.ts` as its entry point (pi's standard discovery convention).

### Bundled

`@devopstales/skill-pi` bundles this extension — it loads automatically on every session.

## Tools

| Tool | Purpose |
|---|---|
| `fd` | Find files by name (pattern, type, extension, glob, depth, limit) |
| `rg` | Search file contents (pattern, path, glob, type, case sensitivity, context, limit) |

Both tools stream output with bounded memory, persist truncated output to a temp file, and respect pi's standard truncation limits.

## Peer dependencies

The extension resolves these from the host pi install (declared as `peerDependencies`, not bundled):

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `@earendil-works/pi-ai`
- `typebox`

`effect` and `@effect/platform-node` are implementation dependencies and are installed with the package.

## Registry

Published to [GitHub Packages](https://github.com/devopstales/skill-pi/packages). Configure the registry before installing:

```sh
npm config set @devopstales:registry https://npm.pkg.github.com
```

Auth requires a GitHub token with `read:packages` on the `skill-pi` repo:

```sh
npm config set //npm.pkg.github.com/:username=<your-username>
npm config set //npm.pkg.github.com/:password=<github-token>
```

## Attribution

Inspired by the `file-search` extension in [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) (MIT).

## License

MIT
