# Research Findings (cross-change)

Distilled, durable findings carried forward from per-change `findings.md` by `reflect`.

## Findings

- **ADR-0007 "runtime deps also in root node_modules" is in family-wide drift (W034).** `picomatch` is declared+used by 6 bundled extensions (`command-plate`, `ask-user`, `lsp`, `plan-build`, `todo`, `webfetch`) but is absent from root `node_modules`. It is not a load failure (the wrapper loads all of them in the running E2E — pi resolves extension imports through the extension's own `node_modules`), but it contradicts ADR-0007's stated load rule. 10/11 extensions also omit `private: true` (W035). A per-change fix would be inconsistent; this needs one family decision (add the deps to root, standardize on root-carried alternatives like `minimatch`, or amend ADR-0007). — source: 2026-10-16-webfetch-extension review (observation 14), W034/W035.

- **`state-drift-check.mjs` `derivePhase` has no `review` state.** It returns `qa` whenever `report.md` exists (ladder: briefing→blueprint→tasks→report), so a correct `current_phase: review` reads as a false-positive drift after the review phase. Extend the ladder to treat `review.md` presence as `review`. — source: 2026-10-16-webfetch-extension reflect (guard run after setting `current_phase: review`).

- **`new URL` rejects percent-encoded bracket hostnames.** `new URL("http://%5B::1%5D:8080/")` throws, and `new URL("http://host/%5B::1%5D:8080/x").hostname === "host"` (the `%5B` lands in the pathname). So a scheme-only URL validator (`http://`/`https://` + `new URL` parse) does NOT have the percent-encoded-host SSRF that a superficial read suggests. A private-range SSRF denylist is still valid defense-in-depth. — source: 2026-10-16-webfetch-extension security review pushback.

- **macOS: a child process spawned with a bare temp-dir `PATH` (no system `PATH`) can be SIGKILLed at ~900ms.** Subprocess tests that put a fake binary on a controlled minimal `PATH` must keep the system `PATH` available (or the kill is an environment artifact, not the code's). The webfetch extraction-timeout test runs under the system `PATH` for this reason. — source: 2026-10-16-webfetch-extension `test/extract.test.ts` debugging.
