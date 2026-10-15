import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const CARD_TONE = {
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
} as const;

export type CardTone = (typeof CARD_TONE)[keyof typeof CARD_TONE];

export interface Card {
  title: string;
  subtitle?: string;
  body: string[];
  tone: CardTone;
  glyph?: string;
}

export interface CardTheme {
  fg(color: string, text: string): string;
  bg?(color: string, text: string): string;
}

export const CARD_STYLE = {
  NEON: "neon",
  FLOAT: "float",
} as const;

export type CardStyle = (typeof CARD_STYLE)[keyof typeof CARD_STYLE];

const CARD_STYLE_SLOT = Symbol.for("skill-pi-tui.card-style");
const styleState = globalThis as typeof globalThis & { [CARD_STYLE_SLOT]?: unknown };

export function cardStyle(): CardStyle {
  return styleState[CARD_STYLE_SLOT] === CARD_STYLE.NEON ? CARD_STYLE.NEON : CARD_STYLE.FLOAT;
}

export function setCardStyle(style: CardStyle): void {
  styleState[CARD_STYLE_SLOT] = style;
}

export interface CardRenderOptions {
  expanded: boolean;
  previewRows?: number;
  hint?: string;
  panel?: boolean;
}

const CARD_GLYPH = "✿";
const FRAME_ROLE: Record<CardTone, string> = {
  [CARD_TONE.INFO]: "border",
  [CARD_TONE.SUCCESS]: "success",
  [CARD_TONE.WARNING]: "warning",
  [CARD_TONE.ERROR]: "error",
};
const TITLE_ROLE: Record<CardTone, string> = {
  [CARD_TONE.INFO]: "accent",
  [CARD_TONE.SUCCESS]: "success",
  [CARD_TONE.WARNING]: "warning",
  [CARD_TONE.ERROR]: "error",
};
const HINT_ROLE = "dim";
const SUBTITLE_ROLE = "muted";
const BODY_ROLE = "text";
// pi themes precompute per-token ANSI; a missing token (e.g. a custom theme
// without borderAccent) must degrade to the plain border role, not throw mid-frame.
function fgSafe(theme: CardTheme, role: string, text: string): string {
  try {
    return theme.fg(role, text);
  } catch {
    return theme.fg("text", text);
  }
}
const SEPARATOR = "·";
const FRAME_COLUMNS = 4;

interface CardChrome {
  topLeft: string;
  topLead: string;
  topRight: string;
  rule: string;
  side: string;
  rail: string;
  bottomLeft: string;
  bottomRight: string;
}

const OUTLINE_CHROME: CardChrome = { topLeft: "╭", topLead: "─ ", topRight: "╮", rule: "─", side: "│", rail: "│", bottomLeft: "╰", bottomRight: "╯" };
const FLOAT_CHROME: CardChrome = { topLeft: "▎", topLead: " ", topRight: "  ", rule: " ", side: "▎", rail: " ", bottomLeft: "▎", bottomRight: " " };
let chrome = OUTLINE_CHROME;

function withChrome<T>(next: CardChrome, run: () => T): T {
  const previous = chrome;
  chrome = next;
  try {
    return run();
  } finally {
    chrome = previous;
  }
}

function rule(length: number): string {
  return chrome.rule.repeat(Math.max(0, length));
}

function titleText(card: Card, theme: CardTheme): { styled: string; width: number } {
  const head = `${card.glyph ?? CARD_GLYPH} ${card.title}`;
  const styled = card.subtitle
    ? `${fgSafe(theme, TITLE_ROLE[card.tone], head)} ${fgSafe(theme, SUBTITLE_ROLE, SEPARATOR)} ${fgSafe(theme, SUBTITLE_ROLE, card.subtitle)}`
    : fgSafe(theme, TITLE_ROLE[card.tone], head);
  return { styled, width: visibleWidth(head) + (card.subtitle ? visibleWidth(card.subtitle) + 3 : 0) };
}

function bodyLines(card: Card, innerWidth: number): string[] {
  return card.body.flatMap((paragraph) => (paragraph === "" ? [""] : wrapTextWithAnsi(paragraph, innerWidth)));
}

function frame(theme: CardTheme, tone: CardTone, text: string): string {
  return fgSafe(theme, FRAME_ROLE[tone], text);
}

export function cardTop(card: Card, theme: CardTheme, width: number, hint?: string): string {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  if (targetWidth < 5) {
    const left = fgSafe(theme, FRAME_ROLE[card.tone], "╭");
    if (targetWidth === 1) return left;
    return left + frame(theme, card.tone, `${rule(targetWidth - 2)}╮`);
  }

  const title = titleText(card, theme);
  const fullHintWidth = hint ? visibleWidth(hint) + 2 : 0;
  const shownHint = hint && title.width + 5 + fullHintWidth <= targetWidth ? hint : undefined;
  const hintWidth = shownHint ? fullHintWidth : 0;
  const titleWidth = Math.max(0, targetWidth - 5 - hintWidth);
  const styledTitle = title.width <= titleWidth ? title.styled : truncateToWidth(title.styled, titleWidth, "");
  const styledTitleWidth = title.width <= titleWidth ? title.width : visibleWidth(styledTitle);
  const fill = rule(targetWidth - styledTitleWidth - 5 - hintWidth);
  const tail = shownHint ? ` ${fgSafe(theme, HINT_ROLE, shownHint)} ` : "";
  return fgSafe(theme, FRAME_ROLE[card.tone], chrome.topLeft) + frame(theme, card.tone, chrome.topLead) + styledTitle + frame(theme, card.tone, ` ${fill}`) + tail + frame(theme, card.tone, chrome.topRight);
}

export function cardLine(text: string, tone: CardTone, theme: CardTheme, width: number): string {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  const left = theme.fg(FRAME_ROLE[tone], chrome.side);
  if (targetWidth === 1) return left;
  if (targetWidth === 2) return left + frame(theme, tone, "│");
  if (targetWidth === 3) return `${left} ${frame(theme, tone, "│")}`;

  const innerWidth = targetWidth - FRAME_COLUMNS;
  const clipped = innerWidth === 0 ? "" : truncateToWidth(text, innerWidth, "…");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
  return `${left} ${clipped}${padding} ${frame(theme, tone, chrome.rail)}`;
}

export function cardBottom(tone: CardTone, theme: CardTheme, width: number, content?: string): string {
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return "";
  const left = theme.fg(FRAME_ROLE[tone], chrome.bottomLeft);
  if (targetWidth === 1) return left;
  if (content === undefined || visibleWidth(content) === 0) return left + frame(theme, tone, `${rule(targetWidth - 2)}${chrome.bottomRight}`);
  const contentWidth = visibleWidth(content) + 2;
  if (targetWidth - 2 - contentWidth < 3) return left + frame(theme, tone, `${rule(targetWidth - 2)}${chrome.bottomRight}`);
  return left + frame(theme, tone, `${rule(targetWidth - 2 - contentWidth)} `) + fgSafe(theme, HINT_ROLE, content) + frame(theme, tone, ` ${chrome.bottomRight}`);
}

export function cardInnerWidth(width: number): number {
  return Math.max(1, width - FRAME_COLUMNS);
}

export function cardBodyRows(
  rows: readonly string[], tone: CardTone, theme: CardTheme, width: number,
  options: CardRenderOptions,
): string[] {
  if (width <= 0) return [];
  const wrapped = rows.flatMap((row) => row.split("\n").flatMap((line) => line === "" ? [""] : wrapTextWithAnsi(line, cardInnerWidth(width))));
  const limit = Math.max(0, Math.floor(options.previewRows ?? 3));
  const shown = options.expanded ? wrapped : wrapped.slice(0, limit);
  return shown.map((line) => cardLine(line, tone, theme, width));
}

const FLOAT_MARGIN = 1;
const FLOAT_MIN_WIDTH = 10;
const FLOAT_BG_ROLE: Record<CardTone, string> = {
  [CARD_TONE.INFO]: "toolSuccessBg",
  [CARD_TONE.SUCCESS]: "toolSuccessBg",
  [CARD_TONE.WARNING]: "toolPendingBg",
  [CARD_TONE.ERROR]: "toolErrorBg",
};
const BG_RESET = "\x1b[49m";
const BG_CLEARING = /\x1b\[(?:0|49)?m/g;

function panelOpener(theme: CardTheme, tone: CardTone): string {
  if (typeof theme.bg !== "function") return "";
  try {
    const painted = theme.bg(FLOAT_BG_ROLE[tone], "");
    return painted.endsWith(BG_RESET) ? painted.slice(0, -BG_RESET.length) : "";
  } catch {
    return "";
  }
}

export function floatRows(tone: CardTone, theme: CardTheme, width: number, render: (width: number) => CardParts): string[] {
  const target = Math.max(0, Math.floor(width));
  const open = floatOpener(theme, tone, target);
  if (!open) {
    const { head = [], body = [], bottom } = render(width);
    return [...head, ...body, ...(bottom === undefined ? [] : [bottom])];
  }
  const inner = target - FLOAT_MARGIN * 2;
  const rows = withChrome(FLOAT_CHROME, () => {
    const { head = [], body = [], bottom, afterHeading = false } = render(inner);
    const blank = cardBottom(tone, theme, inner);
    return [
      ...(head.length > 0 ? [blank, ...head] : []),
      ...(body.length > 0 && (head.length > 0 || afterHeading) ? [blank] : []),
      ...body,
      ...(bottom === undefined ? [] : [bottom]),
    ];
  });
  return paintFloat(rows, open);
}

function floatOpener(theme: CardTheme, tone: CardTone, width: number): string {
  return cardStyle() === CARD_STYLE.FLOAT && Math.floor(width) >= FLOAT_MIN_WIDTH ? panelOpener(theme, tone) : "";
}

function paintFloat(rows: readonly string[], open: string): string[] {
  const margin = " ".repeat(FLOAT_MARGIN);
  return rows.map((row) => `${margin}${open}${row.replace(BG_CLEARING, (reset) => reset + open)}${BG_RESET}${margin}`);
}

export function panelInnerWidth(theme: CardTheme, width: number, tone: CardTone = CARD_TONE.INFO): number {
  return floatOpener(theme, tone, width) ? cardInnerWidth(Math.floor(width) - FLOAT_MARGIN * 2) : cardInnerWidth(width);
}

export function panelHeaderRow(theme: CardTheme, width: number, tone: CardTone = CARD_TONE.INFO): number {
  return floatOpener(theme, tone, width) ? 1 : 0;
}

export function panelExtraRows(theme: CardTheme, width: number, tone: CardTone = CARD_TONE.INFO): number {
  return floatOpener(theme, tone, width) ? 2 : 0;
}

export interface CardParts {
  head?: readonly string[];
  body?: readonly string[];
  bottom?: string;
  afterHeading?: boolean;
}

export function renderCard(card: Card, theme: CardTheme, width: number, options: CardRenderOptions): string[] {
  if (options.previewRows !== undefined) return width <= 0 ? [] : floatRows(card.tone, theme, width, (inner) => ({
    head: [cardTop(card, theme, inner, options.hint)],
    body: cardBodyRows(card.body.map((line) => fgSafe(theme, BODY_ROLE, line)), card.tone, theme, inner, options),
    bottom: cardBottom(card.tone, theme, inner),
  }));
  if (chrome !== OUTLINE_CHROME) return withChrome(OUTLINE_CHROME, () => renderCard(card, theme, width, options));
  const open = options.panel ? floatOpener(theme, card.tone, width) : "";
  if (open) return paintFloat(withChrome(FLOAT_CHROME, () => floatPanel(card, theme, Math.floor(width) - FLOAT_MARGIN * 2, options)), open);
  const top = cardTop(card, theme, width, options.hint);
  const bottom = cardBottom(card.tone, theme, width);
  return [top, ...cardText(card, theme, cardInnerWidth(width), options.expanded).map((line) => cardLine(line, card.tone, theme, width)), bottom];
}

function cardText(card: Card, theme: CardTheme, innerWidth: number, expanded: boolean): string[] {
  const lines = bodyLines(card, innerWidth);
  if (lines.length === 0) return [];
  if (!expanded) {
    const first = lines.find((line) => line !== "") ?? "";
    const clipped = lines.length > 1 ? truncateToWidth(first, Math.max(1, innerWidth - 1), "") + "…" : first;
    return [fgSafe(theme, BODY_ROLE, clipped)];
  }
  return lines.map((line) => (line === "" ? "" : fgSafe(theme, BODY_ROLE, line)));
}

function floatPanel(card: Card, theme: CardTheme, width: number, options: CardRenderOptions): string[] {
  const blank = cardBottom(card.tone, theme, width);
  const body = cardText(card, theme, cardInnerWidth(width), options.expanded).map((line) => cardLine(line, card.tone, theme, width));
  return [blank, panelHeader(card, theme, width, options.hint), ...(body.length > 0 ? [blank, ...body] : []), blank];
}

function fitRow(text: string, width: number): string {
  const clipped = visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function panelHeader(card: Card, theme: CardTheme, width: number, hint?: string): string {
  const lead = fgSafe(theme, FRAME_ROLE[card.tone], chrome.topLeft) + chrome.topLead;
  const subtitle = card.subtitle ? `  ${fgSafe(theme, SUBTITLE_ROLE, card.subtitle)}` : "";
  const left = `${lead}${fgSafe(theme, TITLE_ROLE[card.tone], `${card.glyph ?? CARD_GLYPH} ${card.title}`)}${subtitle}`;
  const right = hint ? `${fgSafe(theme, SUBTITLE_ROLE, hint)}${chrome.topRight}` : "";
  const gap = width - visibleWidth(left) - visibleWidth(right);
  return right && gap >= 1 ? `${left}${" ".repeat(gap)}${right}` : fitRow(left, width);
}
