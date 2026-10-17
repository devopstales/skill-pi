# skill-pi-tui

The TUI surface for [skill-pi](../../README.md): the startup banner, the fullscreen
right-side sidebar with a live Status card, and the enriched footer. Bundled with
`@devopstales/skill-pi` and always loaded — it is not published separately.

## What you get

- **Startup banner** (`session_start` header) — logo, tagline, and a session stats
  grid (extensions, skills, MCP servers, custom tools, packages) confirming the
  isolated session.
- **Fullscreen sidebar** — installed on terminals ≥ 140 columns. Hosts the live
  **Status card** (project path, git branch, session name, uncommitted change
  counts) and is the rendering rail for other extensions (e.g. the `todo` card).
- **Footer** — cwd, git branch + change counts, runtime info, model/thinking
  level, token + cost usage, and per-extension status lines.
- **Context zone bar** — a visual context-health indicator using the
  [smart/warm/dumb zone model](https://github.com/arpagon/pi-context-zone)
  from Dex Horthy's "No Vibes Allowed" talk. The bar shows zone dividers at
  40% and 70% of the context window, color-coded green → yellow → red, with
  the current zone label and remaining % until the next zone ceiling.
  Updated automatically after each turn, compaction, and session start.
- **Peek label** — a live "thinking" label rendered into pi's hidden-thinking
  block while the assistant is working, settling into a one-line summary when the
  turn ends.
- **Provider error cleanup** — raw provider error payloads are blanked and
  re-surfaced as a single readable `errorMessage` line instead of a raw dump plus
  "Unknown error".

## How it works

```
session_start ──▶ header (banner stats) + footer component
                   ├── footer lines (git, runtime, model, cost, extensions)
                   └── sidebar (≥140 cols): Status card + extension parts
agent_start/end ─▶ working timer (250ms re-render) + last-turn duration
message_* ────────▶ peek state machine (idle → thinking → done) → hidden-thinking label
message_end ──────▶ provider error cleanup + usage cache invalidation
session_shutdown ─▶ timers cleared, sidebar removed, footer detached
```

- All async refreshes (git, changes, runtime) are generation-tagged through a
  `SessionLifecycle`, so a shut-down session never schedules renders.
- The sidebar uses `installSidebar` / `sidebarPart` from `src/sidebar-layout.ts`;
  other extensions attach their own cards to the same rail.

## Layout

```
index.ts                 extension entry: events, header, footer, sidebar wiring
src/banner.ts            startup banner header + stats
src/sidebar.ts           sidebar parts (extension cards)
src/sidebar-layout.ts    installSidebar: fullscreen layout switch
src/status-card.ts       live Status card
src/footer.ts            footer line builder
src/changes.ts           uncommitted change capture
src/git.ts               git branch/status reader
src/runtime.ts           runtime info reader
src/session-lifecycle.ts generation guard for async work
src/peek.ts              thinking-peek state machine
src/state.ts             model meta + usage cache
src/context-zone.ts      smart/warm/dumb zone model (40/70 thresholds) + bar renderer
src/provider-error.ts    provider error cleanup
src/icons.ts             glyph resolution
src/utils.ts             formatting helpers
```

## Requirements

- `@earendil-works/pi-coding-agent` ^1.2.0 (peer)
- `@earendil-works/pi-tui` (peer)
- Terminal ≥ 50 columns × 12 rows to render at all; ≥ 140 columns for the sidebar.

## Development

```bash
npm install
npm test          # vitest
npm run check     # tsc --noEmit
```

## License

MIT
