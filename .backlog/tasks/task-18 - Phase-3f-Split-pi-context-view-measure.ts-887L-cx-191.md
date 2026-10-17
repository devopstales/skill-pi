---
id: TASK-18
title: 'Phase 3f: Split pi-context-view/measure.ts (887L, cx 191)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 09:57'
labels: []
dependencies: []
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split by measurement concern:
pi-context-view/src/
├── measure.ts (kept) — analyzeSystemPrompt orchestration, textTokens/charTokens
├── measure-sections.ts — measureSectionPart, deletedSectionPart, measureGeneratedSection, decodeXml
├── measure-tools.ts    — measureTools, toolPromptLines, droppedSections, createToolItem
├── measure-attribution.ts — locateRenderedLines, piOwnedGuidelines, claimGuidelines
└── measure-items.ts    — createSystemPromptItem, createItem, createAggregateItem, allocateSectionTokens

Run pi-context-view tests. One commit: refactor: split measure.ts by measurement concern
<!-- SECTION:DESCRIPTION:END -->
