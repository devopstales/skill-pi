# @devopstales/pi-webfetch

Web fetch tool for [pi](https://pi.dev) coding agents. Static `undici` fetch with bounded timeout and response size; HTML is converted to clean markdown with [trafilatura](https://trafilatura.readthedocs.io/) instead of a naive HTML-to-markdown pass.

## Origin

Homogenized from two MIT-licensed pi extensions:

- **[code-yeongyu/pi-webfetch](https://github.com/code-yeongyu/pi-webfetch)** — the base: `webfetch` tool contract (`url`, `format`, `timeout`), the undici fetcher with bounded redirects/timeouts/size, output capping, and the TUI renderers. Its Readability+Turndown conversion is replaced.
- **[georgebashi/pi-web-fetch](https://github.com/georgebashi/pi-web-fetch)** — the source of the trafilatura extraction (Python runner auto-detection, HTML piped to `trafilatura --markdown --formatting`) and the built-in site handlers. Its headless-Chrome fetch stage, batch mode, browser pool, LLM sub-agent, and 15-minute cache are **not** ported.

## What it does

The extension registers one LLM-callable tool:

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` (required) | URL to fetch. Must start with `http://` or `https://`. |
| `format` | `"markdown" \| "text" \| "html"` (optional) | Output format. Default `markdown`. |
| `timeout` | `number` (optional) | Timeout in seconds. Defaults to `30`; capped at `120`. |

Behavior:

- **Timeout:** 30s default, 120s max.
- **Response size:** 5MB maximum, checked by `Content-Length` and while reading the body.
- **Accept negotiation:** sends an `Accept` header weighted for the requested format.
- **Extraction:** for HTML responses with `markdown`/`text` format, the document is piped to trafilatura, which strips boilerplate (nav, ads, footers) with ML-based extraction and emits markdown. The runner is auto-detected in priority order: `uvx` → `uv run` → `pipx run` → `pip-run`. The first run downloads trafilatura (~10MB) into the runner's cache; later runs are fast.
- **No runner installed:** the raw decoded body is returned (same as stock `text`/`html` behavior) instead of failing.
- **Built-in site handlers:** GitHub URLs short-circuit to `gh` CLI suggestions; Google Docs URLs point at workspace tools. Other extensions can register handlers via `pi.events.emit("webfetch:register", handler)`.
- **TUI rendering:** compact output shows status, format, size, extraction state, and a short preview; expanded output includes final URL and content type.

### JavaScript-rendered pages

Pages are fetched over plain HTTP — there is no headless browser. If trafilatura finds no content in the static document, the error says so explicitly; re-fetch with `format: "html"` to inspect the raw document.

## Install

Bundled with `skill-pi` (loaded automatically — no install step). For standalone pi:

```sh
pi install @devopstales/pi-webfetch
# or from a local checkout
pi --extension /path/to/skill-pi/extensions/webfetch/index.ts
```

## Configuration

| Env var | Effect |
|---|---|
| `SKILL_PI_WEBFETCH` | `0`/`false`/`no`/`off` disables the extension (default: on) |

Python runner environment: `UV_CACHE_DIR`, `PIPX_HOME` are respected by the runner detection.

## Development

```sh
cd extensions/webfetch
npm install
npm test
npm run check
```
