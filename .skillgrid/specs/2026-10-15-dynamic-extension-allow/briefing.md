# Dynamic Extension Tool Allow — Design Briefing

> **STATUS:** `accepted` (2026-10-15) — plan agreed with user in-session (plan mode).

## Problem / Intent

The bundled `permission` extension asks for permission on every tool registered
by an extension (e.g. `todo` from `extensions/todo`). Users must hand-write an
allow rule in `conf.d/permission.conf` for every new extension tool. The allow
behavior should be **dynamic**: any tool registered by a local extension is
allowed by default, with no per-tool code in the permission extension.

## Purpose & Success Criteria

- A `tool_call` for a tool whose `ToolInfo.sourceInfo.path` is a real file
  (extension-registered, `source: "local"`) resolves to `allow` when no
  explicit rule matches.
- Built-in tools (`builtin:` synthetic paths) and namespaced/MCP tools keep
  today's behavior (`ask` by default, or their rule).
- conf.d rules still override: `deny` beats auto-allow, `ask` beats
  auto-allow, `always`/session approvals unchanged.
- Adding a new extension tool requires zero changes to the permission
  extension.

## Constraints

- Self-contained extension (ADR 0007): changes stay in `extensions/permission/`.
- Never modify pi source (ADR 0006): use only the public `ExtensionAPI`
  (`pi.getAllTools()` returns `ToolInfo` with `sourceInfo`).
- No comments in code unless asked. Minimal scoped changes.
- The permission extension's own tool-allow derivation must not create a
  chicken-and-egg problem: the `permission` extension's own tools are also
  extension tools and are auto-allowed (it registers no tools today, but the
  rule holds generally).

## Out of Scope

- MCP / namespaced tools (per user decision: only local extension tools).
- Per-argument rules for auto-allowed tools (they can still be restricted via
  explicit `ask: ["todo(...)"]` / `deny: ["todo"]` rules).

## Fast-track

`small` — single concern (one merge point in `extensions/permission/index.ts`
+ one spec file + one README line), no migration, no new dependency, no trust
boundary change. Skips: brainstorming, blueprint (plan agreed in plan mode).
