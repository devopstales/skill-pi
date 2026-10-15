---
id: TASK-4
title: 'Epic: Unified providers extension (pi-free + opencode-zen + antigravity)'
status: In Progress
assignee: []
created_date: '2026-10-15 08:22'
labels: []
dependencies: []
references:
  - .skillgrid/specs/2026-10-14-unified-providers/briefing.md
  - .skillgrid/specs/2026-10-14-unified-providers/blueprint.md
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
priority: high
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bundle one pi extension (extensions/providers/) that registers the union of three upstream plugins: pi-free@2.8.4 base (26 free/paid providers + filter/telemetry/fallback/quota/diagnostics, vendored as-is), opencode-zen-oauth@1.2.6 (device-flow OAuth), and pi-agy@0.6.1 antigravity (OAuth multi-account). Tracer-thread build shape: door check (base loads under skill-pi jiti + real session) before any OAuth provider is invested in. State stays in ~/.skill-pi/agent (ADR 0002); deps land in extensions/package.json (ADR 0001); no pi source changes (ADR 0006).

Sliced into 7 tickets in 6 waves (stacked-to-main, ask-on-risk). See tasks.md for the full dependency graph and per-ticket acceptance criteria.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green (full root suite)
- [ ] #2 extensions/providers/README.md provenance table complete (3 upstreams, version + license + any ADR-0002 edits)
- [ ] #3 Wrapper README.md "Currently bundled" lists the new extension
- [ ] #4 No writes to ~/.pi or <repo>/.pi (ADR 0002 backstop)
<!-- DOD:END -->
