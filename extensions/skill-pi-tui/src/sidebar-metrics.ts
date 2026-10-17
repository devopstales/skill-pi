/**
 * Pure layout computation for the fullscreen sidebar rail: constants, the
 * padded-line painter, and the overflow check. The TUI wiring (installSidebar)
 * in sidebar-layout.ts consumes these to decide when the rail activates and
 * what to paint; keeping the math here means the breakpoint and row geometry
 * can be reasoned about without loading the host TUI.
 */
import { visibleWidth, type Component } from "@earendil-works/pi-tui";

export const RAIL_PADDING = 1;

export const RAIL_WIDTH = 50;
// ponytail: the floating card frame (FLOAT_MARGIN in card.ts) adds 2 cols to a
// part's render width; the host must reserve that or the rail's overflow check
// in prepare() never passes and ownsHost() stays false.
export const GAP = 5;
/** Right-edge columns the painting rail takes from the editor column. */
export const SIDEBAR_RAIL_COLUMNS = RAIL_WIDTH + GAP;
// Minimum columns the main (left) column must keep so the rail doesn't swallow
// the whole screen. The sidebar activates when it fits (RAIL_COLUMNS + this),
// never at a fixed 140 — placement is decided by "does the sidebar fit + is it
// enabled", not by terminal size. Below this, the todo/footer fall back to the
// main screen (the main-screen widget is the narrow-terminal fallback by design).
const MIN_MAIN_COLUMNS = 40;
/** Minimum terminal width for the fullscreen rail to activate. */
export const SIDEBAR_BREAKPOINT = SIDEBAR_RAIL_COLUMNS + MIN_MAIN_COLUMNS;

/** One section's row, before padding: the part's key, the component it came from, and its lines. */
export interface SidebarRailLines {
  key: string;
  component: Component;
  lines: string[];
  /** Content columns this section's component was rendered into (already excludes the rail padding). */
  width: number;
}

export interface RailHit {
  key: string;
  component: Component;
  startY: number;
  height: number;
  width: number;
}

export interface PaintedRail {
  lines: string[];
  hits: RailHit[];
}

/**
 * Paint the rail rows: each section's lines are padded to the rail width, with
 * an empty row between sections when density is comfortable. The hits table is
 * what mouse dispatch uses to route a click to the section under the cursor.
 */
export function railLines(
  sections: readonly SidebarRailLines[],
  comfortable: boolean,
): PaintedRail {
  const lines: string[] = [];
  const hits: RailHit[] = [];
  for (const section of sections) {
    if (hits.length > 0 && comfortable) lines.push("");
    const startY = lines.length;
    lines.push(...section.lines.map((line) => " ".repeat(RAIL_PADDING) + line + " ".repeat(RAIL_PADDING)));
    hits.push({ key: section.key, component: section.component, startY, height: section.lines.length, width: section.width });
  }
  return { lines, hits };
}

/** Whether a painted rail row fits the terminal width (ANSI-aware). */
export function isLineFitting(line: string, width: number): boolean {
  return visibleWidth(line) <= width;
}
