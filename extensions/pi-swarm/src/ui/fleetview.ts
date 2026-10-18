import { parseKey, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentSnapshot, TranscriptLine } from "../domain.ts";
import { formatAgentRow, formatMainRow, statusGlyph as statusGlyphLocal, type FleetTheme } from "../format.ts";

export const FLEETVIEW_HINT = "esc to return · enter to open · x to stop";
export const OVERLAY_HINT = "↑↓ scroll · x stop · esc close";

const OVERLAY_RENDER_THROTTLE_MS = 50;
const OVERLAY_CONFIRM_MS = 2000;
const OVERLINE_MIN = 1;
const OVERLINE_MAX = 16;

export interface FleetReadModel {
  list(): readonly AgentSnapshot[];
  get(id: string): AgentSnapshot | undefined;
  cancel(id: string): Promise<void> | void;
  subscribe(listener: () => void): () => void;
}

export interface FleetClock {
  now(): number;
  setTimer(fn: () => void, delayMs: number): unknown;
  clearTimer(id: unknown): void;
}

function defaultClock(): FleetClock {
  return {
    now: () => Date.now(),
    setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
    clearTimer: (id) => clearTimeout(id as NodeJS.Timeout),
  };
}

export function sanitizeTranscriptText(text: string): string {
  return stripTerminalSequences(text).replace(/\r/g, "").replace(/\n/g, " ");
}

function transcriptRow(line: TranscriptLine, innerWidth: number, theme: FleetTheme): string {
  const text = sanitizeTranscriptText(line.text);
  const inner = Math.max(1, Math.floor(innerWidth));
  const budget = Math.max(1, inner - visibleWidth(prefixFor(line.kind)));
  const body = truncateToWidth(text, budget, "…");
  const colored =
    line.kind === "user" ? theme.fg("text", body) :
    line.kind === "tool" ? theme.fg("dim", body) :
    line.kind === "error" ? theme.fg("warning", body) :
    body;
  return prefixFor(line.kind) + colored;
}

function prefixFor(kind: TranscriptLine["kind"]): string {
  if (kind === "user") return "> ";
  if (kind === "tool") return "→ ";
  if (kind === "error") return "⚠ ";
  return "  ";
}

export function transcriptOverlayRows(
  lines: readonly TranscriptLine[],
  innerWidth: number,
  scrollTop: number,
  theme: FleetTheme,
): string[] {
  const inner = Math.max(1, Math.floor(innerWidth));
  const wrapped = lines.flatMap((line) => wrapTextWithAnsi(transcriptRow(line, inner, theme), inner));
  const maxTop = Math.max(0, wrapped.length - OVERLINE_MAX);
  const top = Math.min(Math.max(0, Math.floor(scrollTop)), maxTop);
  const bottom = top + OVERLINE_MAX - 1;
  return wrapped.slice(top, bottom + 1).map((row) => {
    const clipped = sliceByColumn(row, 0, inner);
    const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
    return `│ ${clipped}${pad} │`;
  });
}

export function isFleetViewVisible(agents: readonly AgentSnapshot[]): boolean {
  return agents.some((a) => a.status === "running" || a.status === "queued");
}

const MARKER_WIDTH = visibleWidth("❯ ");

export interface FleetViewOptions {
  clock?: FleetClock;
}

export function createFleetView(
  readModel: FleetReadModel,
  options: FleetViewOptions = {},
): Component & { dispose(): void; tui: TUI | undefined; overlayOpen(): boolean } {
  const clock = options.clock ?? defaultClock();
  let theme: FleetTheme = { fg: (_c, t) => t, bold: (t) => t };
  let rows: { id: string | null }[] = [{ id: null }];
  let selection = 0;
  let disposed = false;

  let overlayId: string | null = null;
  let scrollTop = 0;
  let confirmArmed = false;
  let confirmDeadline = 0;
  let confirmTimer: unknown;
  let renderTimer: unknown;

  let componentRef: { tui?: TUI };
  const requestRender = () => {
    componentRef?.tui?.requestRender();
  };

  const syncSelection = () => {
    if (rows.length === 0) {
      selection = 0;
      return;
    }
    selection = Math.min(selection, rows.length - 1);
    const firstActive = rows.findIndex((row) => {
      const snapshot = row.id ? readModel.get(row.id) : undefined;
      return snapshot !== undefined && (snapshot.status === "running" || snapshot.status === "queued");
    });
    if (firstActive >= 0) selection = firstActive;
  };

  const wrappedCount = (snapshot: AgentSnapshot): number =>
    snapshot.transcript.reduce((n, line) => n + wrapTextWithAnsi(transcriptRow(line, 200, theme), 200).length, 0);

  const maxTopFor = (snapshot: AgentSnapshot): number => Math.max(0, wrappedCount(snapshot) - OVERLINE_MAX);

  const isAtBottom = (snapshot: AgentSnapshot): boolean =>
    scrollTop === maxTopFor(snapshot);

  const disarmConfirm = () => {
    confirmArmed = false;
    confirmDeadline = 0;
    if (confirmTimer !== undefined) {
      clock.clearTimer(confirmTimer);
      confirmTimer = undefined;
    }
  };

  const armConfirm = (id: string) => {
    if (confirmArmed) {
      disarmConfirm();
      void Promise.resolve(readModel.cancel(id)).catch(() => {});
      return;
    }
    confirmArmed = true;
    confirmDeadline = clock.now() + OVERLAY_CONFIRM_MS;
    confirmTimer = clock.setTimer(() => {
      confirmArmed = false;
      confirmDeadline = 0;
      confirmTimer = undefined;
      requestRender();
    }, OVERLAY_CONFIRM_MS);
  };

  const scheduleRender = () => {
    if (disposed) return;
    if (renderTimer !== undefined) {
      clock.clearTimer(renderTimer);
      renderTimer = undefined;
    }
    renderTimer = clock.setTimer(() => {
      renderTimer = undefined;
      if (!disposed) requestRender();
    }, OVERLAY_RENDER_THROTTLE_MS);
  };

  const refresh = () => {
    if (disposed) return;
    const agents = [...readModel.list()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    rows = [{ id: null }, ...agents.map((a) => ({ id: a.id }))];
    if (overlayId !== null) {
      const open = agents.find((a) => a.id === overlayId);
      if (!open) {
        overlayId = null;
        disarmConfirm();
      } else {
        const wasAtBottom = scrollTop >= maxTopFor(open) - 1;
        if (wasAtBottom) {
          scrollTop = maxTopFor(open);
        }
      }
      scheduleRender();
      return;
    }
    syncSelection();
    requestRender();
  };

  const unsubscribe = readModel.subscribe(refresh);
  refresh();

  const dimmedTheme: FleetTheme = {
    fg: (color, text) => theme.fg("dim", text),
    bold: (text) => theme.fg("dim", text),
  };

  const selectedRow = (): { id: string | null } | undefined => rows[selection];

  const renderList = (width: number): string[] => {
    const out: string[] = [];
    const inner = Math.max(1, width - MARKER_WIDTH);
    for (const row of rows) {
      const selected = rows[selection] === row;
      const marker = selected ? "❯ " : "  ";
      if (row.id === null) {
        out.push(marker + truncateToWidth(formatMainRow(selected ? theme : dimmedTheme), inner, "…"));
        continue;
      }
      const snapshot = readModel.get(row.id);
      if (!snapshot) continue;
      out.push(marker + truncateToWidth(formatAgentRow(snapshot, inner, clock.now(), selected ? theme : dimmedTheme), inner, "…"));
    }
    out.push(theme.fg("dim", truncateToWidth(FLEETVIEW_HINT, width, "…")));
    return out;
  };

  const renderOverlay = (width: number): string[] => {
    if (!overlayId) return renderList(width);
    const snapshot = readModel.get(overlayId);
    if (!snapshot) return renderList(width);
    const target = Math.max(0, Math.floor(width));
    if (target < 4) return [];
    const head = `${snapshot.id} ${statusGlyphLocal(snapshot.status)} ${snapshot.title}`;
    const inner = Math.max(1, target - 4);
    const top = `╭ ${truncateToWidth(head, inner, "…")} ╮`;
    const body = transcriptOverlayRows(snapshot.transcript, inner, scrollTop, theme);
    const bottomContent = confirmArmed ? "x again to stop" : undefined;
    let bottom: string;
    if (bottomContent) {
      const content = theme.fg("warning", bottomContent);
      const fill = Math.max(0, inner - visibleWidth(content) - 2);
      bottom = `╰ ${"─".repeat(fill)} ${content} ╯`;
    } else {
      bottom = `╰ ${"─".repeat(inner)} ╯`;
    }
    const hint = theme.fg("dim", truncateToWidth(OVERLAY_HINT, target, "…"));
    return [top, ...body, bottom, hint];
  };

  const component: Component & { dispose(): void; tui: TUI | undefined; overlayOpen(): boolean } = {
    tui: undefined,
    overlayOpen: () => overlayId !== null,
    render(width) {
      if (!isFleetViewVisible(readModel.list()) && !overlayId) return [];
      const result = overlayId ? renderOverlay(width) : renderList(width);
      return result;
    },
    handleInput(data) {
      const key = parseKey(data) ?? data;
      if (overlayId) {
        const id = overlayId;
        if (key === "escape") {
          overlayId = null;
          scrollTop = 0;
          disarmConfirm();
          requestRender();
          return;
        }
        if (key === "enter") {
          return;
        }
        if (key === "up") {
          if (scrollTop > 0) scrollTop -= 1;
          disarmConfirm();
          requestRender();
          return;
        }
        if (key === "down" || key === "left" || key === "right") {
          const snapshot = readModel.get(id);
          if (snapshot) {
            const maxTop = maxTopFor(snapshot);
            if (scrollTop < maxTop) scrollTop += 1;
          }
          disarmConfirm();
          requestRender();
          return;
        }
        if (key === "x") {
          armConfirm(id);
          requestRender();
          return;
        }
        if (key !== " " && key !== "") disarmConfirm();
        return;
      }
      if (key === "up") {
        if (selection > 0) selection -= 1;
        requestRender();
        return;
      }
      if (key === "down" || key === "left" || key === "right") {
        if (selection < rows.length - 1) selection += 1;
        requestRender();
        return;
      }
      if (key === "enter") {
        const row = selectedRow();
        const snapshot = row?.id ? readModel.get(row.id) : undefined;
        if (row?.id && snapshot) {
          overlayId = row.id;
          scrollTop = maxTopFor(snapshot);
          confirmArmed = false;
          requestRender();
        }
        return;
      }
      if (key === "escape") {
        requestRender();
        return;
      }
      if (key === "x") {
        const row = selectedRow();
        if (row?.id) void Promise.resolve(readModel.cancel(row.id)).catch(() => {});
        return;
      }
    },
    invalidate() {},
    dispose() {
      disposed = true;
      unsubscribe();
      if (renderTimer !== undefined) {
        clock.clearTimer(renderTimer);
        renderTimer = undefined;
      }
      if (confirmTimer !== undefined) {
        clock.clearTimer(confirmTimer);
        confirmTimer = undefined;
      }
    },
  };

  componentRef = component;
  return component;
}


