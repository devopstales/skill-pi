# pi-context-view

TypeScript pi extension (`src/index.ts`) with two TUI-only overlays and one utility command:

- `/context` or `/context usage` — estimate current context composition.
- `/context injections` — inspect the latest request's injections with opt-in raw previews.
- `/context config` — explicitly create the defaults-populated global config file.

The command accepts only `usage`, `injections`, and `config`; keep both views unavailable outside TUI mode and `config` available in every run mode.

## Sources of truth

| Path                  | Read before                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc/ARCHITECTURE.md` | Changing lifecycle capture, silent probes, attribution, usage accounting, the semantic model, configuration semantics, or privacy behavior. Its page table names the `doc/architecture/` page to load.   |
| `doc/UI.md`           | Changing the shared frame, colors, casing, descriptions, interaction, responsive behavior, or release media. Per-view rules live in `doc/ui/usage.md`, `doc/ui/injections.md`, and `doc/ui/previews.md`. |
| `doc/THINKING.md`     | Changing reasoning-token accounting, signature handling, or thinking-preview notation.                                                                                                                   |
| `doc/PLAN.md`         | Adding commands, configuration, runtime inspection, or other roadmap work.                                                                                                                               |
| `doc/RELEASE.md`      | Changing versions, tagging, publishing, or preparing a release.                                                                                                                                          |

## Repository rules

- **Architecture contract.** Preserve the invariants in `doc/ARCHITECTURE.md`; update the owning `doc/architecture/` page with any lifecycle, capture, attribution, or usage behavior change.
- **Privacy gate.** Keep raw prompts and messages process-local and terminal-sanitized; expose them only after explicit Enter preview, and never log them, persist extra copies, include them in notifications, or inject them into later requests.
- **Module boundaries.** Keep `src/index.ts` to wiring: create the layers, call their `register*()` functions in the required order, and register the command. Put independently testable state, measurement, and rendering behavior in focused modules under `src/`, `src/capture/`, `src/probe/`, and `src/ui/`.
- **Command contract.** Keep parsing, completions, registration text, README usage, and command tests synchronized whenever the `/context` grammar or mode guard changes.
- **Config contract.** Keep user-configurable state override-only: defaults in code, no auto-created or default-backfilled config file, invalid entries degrading to defaults. `doc/architecture/privacy.md` holds the full load and write contract.
- **UI contract.** Treat `doc/UI.md` and `doc/ui/` as canonical; update the owning page and focused tests whenever the specified TUI behavior changes.
- **Changelog entries.** Keep the text of each `CHANGELOG.md` bullet, after its `[scope]` tag, to about 80 characters.
- **Dependency contract.** The Pi runtime packages are `peerDependencies` (`pi-coding-agent` pinned to the skill-pi line; `pi-tui` and `pi-ai` as `"*"`), and the same packages are exact-pinned in `devDependencies` for the standalone check. Run `npm install` after changing a pin. This extension has no third-party runtime deps: everything resolves through the host's pi packages.

## Verification

Self-contained per ADR-0007: the toolchain (`typescript`, `@types/node`, the pinned pi packages) is declared locally and installed opt-in by contributors.

```bash
npm install        # local dev toolchain
npm run check      # tsc --noEmit -p .
npm test           # node test/run.ts
```

- **Shared test process.** `npm test` runs every test file concurrently in one process: no top-level hooks, no observable process-wide state changes, and no mocks that change a shared static method's behavior. `doc/architecture/validation.md` lists the safe patterns.
- **Lifecycle changes.** Load `test/fixtures/marker.ts`, `test/fixtures/forced-prompt.ts`, and `test/fixtures/input-transform.ts` in both extension orders and use an `after_provider_response` sentinel to prove a probe makes no provider request. Runtime tests use the mock provider in `test/harness/`; `doc/architecture/validation.md` maps each validation case to its tests.
- **TUI changes.** Run real-PTY UI checks and provider smoke tests only when explicitly requested. When requested, follow the `pi-extension` skill and exercise the dimensions and interactions required by `doc/UI.md`.
