import { parseKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentSnapshot } from "../domain.ts";
import { formatAgentRow, statusGlyph, type FleetTheme } from "../format.ts";
import {
  DASHBOARD_CONFIRM_MS,
  DASHBOARD_RENDER_THROTTLE_MS,
  OVERLINE_MAX,
  sanitizeTranscriptText,
  transcriptOverlayRows,
  type FleetClock,
} from "./fleetview.ts";

export const DASHBOARD_HINT = "j/k move · enter open · x stop · esc close";
export const DASHBOARD_EMPTY = "no swarm agents";

export interface DashboardReadModel {
  list(): readonly AgentSnapshot[];
  get(id: string): AgentSnapshot | undefined;
  cancel(id: string): Promise<void> | void;
  subscribe(listener: () => void): () => void;
}

const MARKER_WIDTH = visibleWidth("❯ ");

function defaultClock(): FleetClock {
  return {
    now: () => Date.now(),
    setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
    clearTimer: (id) => clearTimeout(id as NodeJS.Timeout),
  };
}

export interface DashboardOptions {
  clock?: FleetClock;
}

export function createDashboard(
  readModel: DashboardReadModel,
  options: DashboardOptions = {},
): Component & { dispose(): void; tui: TUI | undefined; isOpen(): boolean; overlayOpen(): boolean; overlayId(): string | null } {
  const clock = options.clock ?? defaultClock();
  let theme: FleetTheme = { fg: (_c, t) => t, bold: (t) => t };
  let rows: string[] = [];
  let selection = 0;
  let open = true;
  let disposed = false;

  let overlayId: string | null = null;
  let scrollTop = 0;
  let confirmArmed = false;
  let confirmTimer: unknown;
  let renderTimer: unknown;

  let componentRef: { tui?: TUI };
  const requestRender = () => {
    if (open) componentRef?.tui?.requestRender();
  };

  const refreshRows = () => {
    if (disposed) return;
    const agents = [...readModel.list()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    rows = agents.map((a) => a.id);
    if (selection > rows.length - 1) selection = Math.max(0, rows.length - 1);
    if (overlayId !== null && !agents.some((a) => a.id === overlayId)) {
      overlayId = null;
      clearConfirm();
    }
  };

  const wrappedCount = (snapshot: AgentSnapshot): number =>
    snapshot.transcript.reduce((n, line) => n + wrapTextWithAnsi(sanitizeTranscriptText(line.text), 200).length, 0);

  const maxTopFor = (snapshot: AgentSnapshot): number => Math.max(0, wrappedCount(snapshot) - OVERLINE_MAX);

  const clearConfirm = () => {
    if (confirmTimer !== undefined) {
      clock.clearTimer(confirmTimer);
      confirmTimer = undefined;
    }
    confirmArmed = false;
  };

  const armConfirm = (id: string) => {
    if (confirmArmed) {
      clearConfirm();
      if (overlayId !== null && overlayId !== id) overlayId = null;
      void Promise.resolve(readModel.cancel(id)).catch(() => {});
      requestRender();
      return;
    }
    confirmArmed = true;
    confirmTimer = clock.setTimer(() => {
      confirmArmed = false;
      confirmTimer = undefined;
      requestRender();
    }, DASHBOARD_CONFIRM_MS);
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
    }, DASHBOARD_RENDER_THROTTLE_MS);
  };

  const onSnapshotChange = () => {
    if (disposed) return;
    refreshRows();
    if (open) scheduleRender();
  };

  const unsubscribe = readModel.subscribe(onSnapshotChange);
  refreshRows();

  const dimmedTheme: FleetTheme = {
    fg: (color, text) => theme.fg("dim", text),
    bold: (text) => theme.fg("dim", text),
  };

  const isSettledRow = (id: string): boolean => {
    const snapshot = readModel.get(id);
    return snapshot !== undefined && (snapshot.status === "done" || snapshot.status === "error" || snapshot.status === "interrupted");
  };

  const selectedId = (): string | undefined => rows[selection];

  const renderList = (width: number): string[] => {
    const out: string[] = [];
    if (rows.length === 0) {
      out.push(theme.fg("dim", truncateToWidth(DASHBOARD_EMPTY, width, "…")));
    }
    for (const id of rows) {
      const snapshot = readModel.get(id);
      if (!snapshot) continue;
      const selected = id === selectedId();
      const marker = selected ? "❯ " : "  ";
      const inner = Math.max(1, width - MARKER_WIDTH);
      out.push(marker + truncateToWidth(formatAgentRow(snapshot, inner, clock.now(), selected ? theme : dimmedTheme), inner, "…"));
    }
    out.push(theme.fg("dim", truncateToWidth(DASHBOARD_HINT, width, "…")));
    return out;
  };

  const renderOverlay = (width: number): string[] => {
    if (!overlayId) return renderList(width);
    const snapshot = readModel.get(overlayId);
    if (!snapshot) return renderList(width);
    const target = Math.max(0, Math.floor(width));
    if (target < 4) return [];
    const head = `${snapshot.id} ${statusGlyph(snapshot.status)} ${snapshot.title}`;
    const inner = Math.max(1, target - 2);
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
    return [top, ...body, bottom];
  };

  const handleListInput = (key: string): void => {
    if (key === "j" || key === "down") {
      clearConfirm();
      if (selection < rows.length - 1) selection += 1;
      requestRender();
      return;
    }
    if (key === "k" || key === "up") {
      clearConfirm();
      if (selection > 0) selection -= 1;
      requestRender();
      return;
    }
    if (key === "enter") {
      const id = selectedId();
      if (id !== undefined) {
        const snapshot = readModel.get(id);
        if (snapshot) {
          overlayId = id;
          scrollTop = maxTopFor(snapshot);
          confirmArmed = false;
          requestRender();
        }
      }
      return;
    }
    if (key === "x") {
      const id = selectedId();
      if (id !== undefined && !isSettledRow(id)) {
        armConfirm(id);
        requestRender();
      }
      return;
    }
    if (key === "escape") {
      open = false;
      clearConfirm();
      requestRender();
      return;
    }
    clearConfirm();
  };

  const handleOverlayInput = (key: string): void => {
    const id = overlayId;
    if (key === "escape") {
      overlayId = null;
      scrollTop = 0;
      clearConfirm();
      requestRender();
      return;
    }
    if (key === "up") {
      if (scrollTop > 0) scrollTop -= 1;
      clearConfirm();
      requestRender();
      return;
    }
    if (key === "down") {
      const snapshot = id ? readModel.get(id) : undefined;
      if (snapshot && scrollTop < maxTopFor(snapshot)) scrollTop += 1;
      clearConfirm();
      requestRender();
      return;
    }
    if (key === "x" && id) {
      armConfirm(id);
      requestRender();
      return;
    }
    clearConfirm();
  };

  const component: Component & { dispose(): void; tui: TUI | undefined; isOpen(): boolean; overlayOpen(): boolean; overlayId(): string | null } = {
    tui: undefined,
    isOpen: () => open,
    overlayOpen: () => overlayId !== null,
    overlayId: () => overlayId,
    render(width) {
      if (!open) return [];
      return overlayId ? renderOverlay(width) : renderList(width);
    },
    handleInput(data) {
      const key = parseKey(data) ?? data;
      if (overlayId) {
        handleOverlayInput(key);
        return;
      }
      handleListInput(key);
    },
    invalidate() {},
    dispose() {
      disposed = true;
      open = false;
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
