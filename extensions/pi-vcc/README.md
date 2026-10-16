# pi-vcc

Algorithmic conversation compactor for the [skill-pi](../../README.md) agent.
When the context window fills up, it replaces the LLM-generated summary with a
deterministic, extraction-based brief: no API call, no hallucination, same input
always yields the same output. Bundled with `@devopstales/skill-pi` and always
loaded — it is not published separately.

Vendored from [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc) (MIT),
homogenized for skill-pi: config and session paths resolve through the isolated
agent dir, and the upstream Czech goal/preference patterns are removed.

## Why algorithmic, not an LLM summary

| | pi default | pi-vcc |
|---|---|---|
| Method | LLM-generated summary | Algorithmic extraction |
| Determinism | Non-deterministic, can hallucinate | Same input = same output |
| Token reduction | Varies | 35–99% on real sessions |
| Compaction latency | Waits for an LLM call | ~30–470 ms, no API call |
| Cost | Burns tokens on the summary call | Zero |
| History after compaction | Gone — only the summary remains | Active lineage stays searchable via `vcc_recall` |

The default pi compaction asks the model to summarize the whole transcript and
then discards the raw messages. pi-vcc instead keeps a rolling brief plus a set
of sticky semantic sections, and — because the raw session JSONL is never deleted
— the agent can still retrieve the pre-compaction history on demand.

## What you get

- **`/pi-vcc`** — manual compaction. `/pi-vcc keep:N [prompt]` keeps the last `N`
  user turns (default `1`; `0` = compact everything). An optional trailing
  prompt is sent to the agent after compaction.
- **`vcc_recall`** — a tool that searches the session history. It reads the raw
  session JSONL directly, so it works across any number of compactions. Default
  scope is the **active lineage**; pass `scope: "all"` to also search
  off-lineage branches. Supports regex patterns, multi-word OR queries ranked by
  term relevance (rare terms weighted higher), paging, and full expansion of a
  result by index.
- **`/pi-vcc-recall [query] [scope:all]`** — the same search as a slash command;
  results are shown as a message and fed back to the agent as context.
- **Automatic** — when `overrideDefaultCompaction` is set, pi-vcc also handles
  `/compact` and the auto-threshold/overflow paths instead of falling through to
  pi core.

## What the compaction produces

Five sticky sections (emitted only when non-empty) plus a rolling brief
transcript. Sections merge across repeated compactions — sticky ones dedup,
volatile ones are replaced — so they accumulate without growing unbounded.

```
[Session Goal]
- Fix the authentication bug in login flow
- [Scope change]
- Also update the session token refresh logic

[Files And Changes]
- Modified: src/auth/session.ts
- Created: tests/auth-refresh.test.ts

[Commits]
- a1b2c3d: fix(auth): refresh token after password reset

[Outstanding Context]
- lint check still failing on line 42

[User Preferences]
- Prefer Vietnamese responses
- Always run tests before committing

[user]
Fix the auth bug, users can't log in after password reset

[assistant]
Root cause is a missing token refresh after password reset...
* bash "bun test tests/auth.test.ts" (#12)
* edit "src/auth/session.ts" (#14)
...(28 earlier lines omitted)
```

| Section | Source |
|---|---|
| `[Session Goal]` | First user goal + detected scope changes |
| `[Files And Changes]` | Modified / created files from tool calls (capped, paths trimmed to the common root) |
| `[Commits]` | Git commits made during the session (last 8, hash + first line) |
| `[Outstanding Context]` | Unresolved items — errors, blockers, pending questions |
| `[User Preferences]` | Regex-extracted from user messages (`always`, `never`, `prefer`, …) |
| Brief transcript | Chronological flow; each tool call collapsed to a one-liner with a `(#N)` ref, long text truncated |

## How it works

1. **Calibrate** — estimate `charsPerToken` from the reported `tokensBefore`
   (falls back to a `4 chars/token` heuristic).
2. **Smart keep** — if the `keep:1` tail is small (≤ 5k tokens), grow `keep` to
   the largest `N` whose tail stays ≤ 25k. An explicit `keep:N` is always
   respected.
3. **Cut** — split at the keep boundary; everything before is summarized, the
   tail stays intact. A fallback cut still runs when pi core hands back nothing.
4. **Normalize → filter noise** — raw messages become uniform blocks; system
   noise and empty blocks are dropped.
5. **Build sections + brief** — extract the five sections and the transcript.
6. **Merge** — if a previous summary exists, sticky sections dedup, volatile
   sections are replaced, and the transcript rolls.

## Configuration

Config lives at `<agent-dir>/pi-vcc-config.json`, auto-scaffolded with safe
defaults on first load. The agent dir resolves through `getAgentDir()` /
`PI_CODING_AGENT_DIR` — for skill-pi that is `~/.skill-pi/agent`, never the
stock `~/.pi/agent`.

```json
{
  "overrideDefaultCompaction": false,
  "smartKeepTail": true,
  "continueAfterThresholdCompact": true,
  "debug": false
}
```

- **`overrideDefaultCompaction`** *(default `false`)* — `false`: pi-vcc only runs
  for `/pi-vcc`; `/compact` and auto-threshold/overflow fall through to pi core.
  `true`: pi-vcc handles every compaction path.
- **`smartKeepTail`** *(default `true`)* — boost the default `keep:1` to a
  larger `N` when the tail is small, per the smart-keep rule above.
- **`continueAfterThresholdCompact`** *(default `true`)* — ask the agent to
  continue after a successful automatic compaction, so it doesn't stop mid-task
  right after the context is compacted.
- **`debug`** *(default `false`)* — write a detailed snapshot
  (`/tmp/pi-vcc-debug.json`) on each compaction: message counts, cut boundary,
  section list, summary preview, token calibration.

## Development

```sh
cd extensions/pi-vcc
npm install        # dev toolchain only (bun, typescript, @types/*)
npm run check      # tsc --noEmit
npm test           # bun test
```

## License

MIT
