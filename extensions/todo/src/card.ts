import { truncateToWidth } from "@earendil-works/pi-tui";
import { CARD_TONE, cardBottom, cardTop, panelHeaderRow, renderCard, type CardTheme } from "../../skill-pi-tui/src/card.ts";
import { GLYPHS, TODO_GLYPH, todoSummary, type TodoState } from "./model.ts";

export interface TodoCardTheme extends CardTheme {
  bold(text: string): string;
}

export interface TodoCardOptions {
  collapsed?: boolean;
  staleTurns?: number;
  collapseKey?: string;
}

const STALE_THRESHOLD = 4;

export function todoCardTone(staleTurns: number | undefined): typeof CARD_TONE.INFO | typeof CARD_TONE.WARNING {
  return staleTurns !== undefined && staleTurns >= STALE_THRESHOLD ? CARD_TONE.WARNING : CARD_TONE.INFO;
}

export interface TodoCardRows {
  header: string[];
  body: string[];
  footer: string;
}

export function todoCardRows(state: TodoState, theme: TodoCardTheme, width: number, options: TodoCardOptions = {}): TodoCardRows {
  const summary = todoSummary(state);
  const tone = todoCardTone(options.staleTurns);
  const subtitle = `${summary.done}/${summary.total} · ${summary.open} open`;
  let hint = options.collapsed ? (options.collapseKey ? options.collapseKey : undefined) : undefined;
  if (options.staleTurns !== undefined && options.staleTurns >= STALE_THRESHOLD && hint) {
    hint = `stale · ${hint}`;
  }

  const body: string[] = [];
  if (options.collapsed) {
    body.push(theme.fg("muted", summary.open > 0 ? `${summary.open} open${summary.blocked > 0 ? ` (${summary.blocked} blocked)` : ""}` : "all done"));
  } else if (state.tasks.length === 0) {
    body.push(theme.fg("muted", "No todos yet."));
  } else {
    for (const task of state.tasks) {
      body.push(taskRow(task, theme));
    }
  }

  const footerBits: string[] = [];
  if (options.staleTurns !== undefined && options.staleTurns >= STALE_THRESHOLD) {
    footerBits.push(theme.fg("warning", `untouched ${options.staleTurns} turns`));
  }
  footerBits.push(`${summary.open} open · ${summary.done}/${summary.total} done`);

  return {
    header: [cardTop({ title: "Todo", subtitle, body: [], tone, glyph: TODO_GLYPH }, theme, width, hint)],
    body,
    footer: cardBottom(tone, theme, width, options.collapsed ? undefined : truncateToWidth(footerBits.join(" · "), width, "…")),
  };
}

function taskRow(task: { status: string; title: string; note?: string }, theme: TodoCardTheme): string {
  const glyph = theme.fg(statusRole(task.status), GLYPHS[task.status as keyof typeof GLYPHS] ?? GLYPHS.pending);
  let line = `${glyph} ${task.title}`;
  if (task.status === "in_progress" && task.note) line += theme.fg("dim", ` · ${task.note}`);
  else if (task.status === "blocked" && task.note) line += theme.fg("warning", ` · ${task.note}`);
  if (task.status === "done" || task.status === "dropped") line = theme.fg("dim", line);
  return line;
}

function statusRole(status: string): string {
  switch (status) {
    case "in_progress":
      return "accent";
    case "done":
      return "success";
    case "blocked":
      return "warning";
    case "dropped":
      return "dim";
    default:
      return "muted";
  }
}

/** Full card: frame top + body rows (clipped to inner width) + frame bottom. */
export function renderTodoCard(state: TodoState, theme: TodoCardTheme, width: number, options: TodoCardOptions = {}): string[] {
  const rows = todoCardRows(state, theme, width, options);
  const inner = Math.max(1, width - 4);
  return [
    rows.header[0],
    ...rows.body.map((line) => padLine(line, inner)),
    rows.footer,
  ];
}

function padLine(line: string, inner: number): string {
  const clipped = truncateToWidth(line, inner, "…");
  const plain = clipped.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = " ".repeat(Math.max(0, inner - plain.length));
  return `│ ${clipped}${pad} │`;
}

export function headerRowFor(theme: TodoCardTheme, width: number, options: TodoCardOptions = {}): number {
  return panelHeaderRow(theme, width, todoCardTone(options.staleTurns));
}

export { renderCard };
