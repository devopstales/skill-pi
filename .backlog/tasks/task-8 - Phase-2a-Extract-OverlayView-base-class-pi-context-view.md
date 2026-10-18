---
id: TASK-8
title: 'Phase 2a: Extract OverlayView base class (pi-context-view)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-16 15:50'
labels: []
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate 10 clone pairs between usage-view.ts (1272L, cx 266) and injections-view.ts (771L, cx 187).

Extract src/ui/overlay-view.ts with:
- openFullscreenView<T>() — shared overlay launcher
- handleListNavigation(data) — close/wheel/step/page/home/end ladder
- handlePreviewScroll(data) — PreviewScroller scroll/page/scrollTo ladder
- renderCached(width, fn) — width+rows caching
- invalidate() — clearPreviewContent + clearCache
- clearCache() — reset cachedWidth/Rows/Lines
- fit(line, width) — fitLine wrapper
- dotLeader(width) — character leader
- renderPreviewFrame(opts) — border/header/body/counter/hints skeleton
- scrollCounterRow(...) — (visible/total) dim row

UsageView extends OverlayView (keeps: map/legend/zoom/blocks/dashboard).
InjectionsView extends OverlayView (keeps: columns/diffs/status/compact fallback).

Expected: ~150 lines dedup, both files drop ~20-30 cx.
Run pi-context-view tests. One commit: refactor: extract OverlayView base class for shared view plumbing
<!-- SECTION:DESCRIPTION:END -->
