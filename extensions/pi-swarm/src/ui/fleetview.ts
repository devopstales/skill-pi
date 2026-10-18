import { parseKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentSnapshot } from "../domain.ts";
import { formatAgentRow, formatMainRow, type FleetTheme } from "../format.ts";

export const FLEETVIEW_HINT = "esc to return · enter to open · x to stop";

export interface FleetReadModel {
  list(): readonly AgentSnapshot[];
  get(id: string): AgentSnapshot | undefined;
  cancel(id: string): Promise<void> | void;
  subscribe(listener: () => void): () => void;
}

export function isFleetViewVisible(agents: readonly AgentSnapshot[]): boolean {
  return agents.some((a) => a.status === "running" || a.status === "queued");
}

const MARKER_WIDTH = visibleWidth("❯ ");

export function createFleetView(readModel: FleetReadModel): Component & { dispose(): void; tui: TUI | undefined } {
  let theme: FleetTheme = { fg: (_c, t) => t, bold: (t) => t };
  let tui: TUI | undefined;
  let rows: { id: string | null }[] = [{ id: null }];
  let selection = 0;
  let disposed = false;

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

  const refresh = () => {
    if (disposed) return;
    const agents = [...readModel.list()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    rows = [{ id: null }, ...agents.map((a) => ({ id: a.id }))];
    syncSelection();
    tui?.requestRender();
  };

  const unsubscribe = readModel.subscribe(refresh);
  refresh();

  const dimmedTheme: FleetTheme = {
    fg: (color, text) => theme.fg("dim", text),
    bold: (text) => theme.fg("dim", text),
  };

  const component: Component & { dispose(): void; tui: TUI | undefined } = {
    render(width) {
      if (!isFleetViewVisible(readModel.list())) return [];
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
        out.push(marker + truncateToWidth(formatAgentRow(snapshot, inner, Date.now(), selected ? theme : dimmedTheme), inner, "…"));
      }
      out.push(theme.fg("dim", truncateToWidth(FLEETVIEW_HINT, width, "…")));
      return out;
    },
    handleInput(data) {
      const key = parseKey(data) ?? data;
      if (key === "up") {
        if (selection > 0) selection -= 1;
        tui?.requestRender();
        return;
      }
      if (key === "down" || key === "left" || key === "right") {
        if (selection < rows.length - 1) selection += 1;
        tui?.requestRender();
        return;
      }
      if (key === "x") {
        const row = rows[selection];
        if (row?.id) void Promise.resolve(readModel.cancel(row.id)).catch(() => {});
        return;
      }
    },
    invalidate() {},
    dispose() {
      disposed = true;
      unsubscribe();
    },
    tui: undefined,
  };

  return component;
}
