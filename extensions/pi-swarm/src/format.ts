import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSnapshot, SwarmStatus } from "./domain.ts";

export interface FleetTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m${String(totalSec % 60).padStart(2, "0")}s`;
  const totalMin = Math.floor(totalSec / 60);
  return `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2, "0")}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function statusGlyph(status: SwarmStatus): string {
  switch (status) {
    case "running":
      return "⠹";
    case "done":
      return "✓";
    case "error":
      return "✗";
    case "interrupted":
      return "■";
    case "queued":
      return "…";
  }
}

export function statusColor(status: SwarmStatus): string {
  switch (status) {
    case "running":
      return "accent";
    case "done":
      return "success";
    case "error":
      return "warning";
    case "interrupted":
      return "muted";
    case "queued":
      return "dim";
  }
}

function truncateFitting(text: string, budget: number): string {
  if (visibleWidth(text) <= budget) return text;
  let out = "";
  for (const ch of text) {
    if (visibleWidth(out + ch + "…") > budget) break;
    out += ch;
  }
  return out + "…";
}

export function agentRowMeta(s: AgentSnapshot, now: number): { glyph: string; title: string; dim: string } {
  const elapsed = (s.settledAt ?? now) - s.createdAt;
  const modelLabel = s.modelLabel ?? "default";
  return {
    glyph: statusGlyph(s.status),
    title: s.title,
    dim: `${s.agentType || "generic"} · ${modelLabel} · ${formatTokens(s.tokens)} · ${formatElapsed(elapsed)}`,
  };
}

export function formatAgentRow(s: AgentSnapshot, width: number, now: number, theme: FleetTheme): string {
  const meta = agentRowMeta(s, now);
  const dim = theme.fg("dim", ` ${meta.dim}`);
  const fixed = theme.fg(statusColor(s.status), meta.glyph);
  const titleBudget = Math.max(4, width - visibleWidth(fixed) - visibleWidth(dim) - 1);
  return `${fixed} ${truncateFitting(meta.title, titleBudget)}${dim}`;
}

export function formatMainRow(theme: FleetTheme): string {
  return theme.bold("main");
}
