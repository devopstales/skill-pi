import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export const ZONE_WARN_PCT = 40;
export const ZONE_DANGER_PCT = 70;

export interface ContextZone {
  key: "smart" | "warm" | "dumb";
  label: string;
  icon: string;
  color: ThemeColor;
  ceiling: number;
}

const ZONES: Record<ContextZone["key"], Omit<ContextZone, "key">> = {
  smart: { label: "smart", icon: "🧠", color: "success", ceiling: ZONE_WARN_PCT },
  warm: { label: "warm", icon: "⚠️", color: "warning", ceiling: ZONE_DANGER_PCT },
  dumb: { label: "dumb", icon: "🧟", color: "error", ceiling: 100 },
};

export function contextZone(pct: number): ContextZone {
  const key: ContextZone["key"] = pct < ZONE_WARN_PCT ? "smart" : pct < ZONE_DANGER_PCT ? "warm" : "dumb";
  return { key, ...ZONES[key] };
}

/**
 * Percentage of context remaining until the current zone's ceiling
 * (smart → 40%, warm → 70%, dumb → 100%).
 */
export function zoneCeilingRemaining(pct: number): number {
  return Math.max(0, Math.round(contextZone(pct).ceiling - pct));
}

export interface ZoneBarOptions {
  warnPos?: number;
  dangerPos?: number;
}

/**
 * Render the zone bar at `width` cells: filled cells colored by the current
 * zone, empty cells dimmed, and zone-boundary markers at 40% and 70% of the
 * width. Theme-aware — colors come from the passed Theme so the bar follows
 * the active pi theme (success/warning/error/dim roles).
 */
export function renderZoneBar(pct: number, width: number, theme: Theme, options: ZoneBarOptions = {}): string {
  if (width <= 0) return "";
  const warnPos = options.warnPos ?? Math.round((ZONE_WARN_PCT / 100) * width);
  const dangerPos = options.dangerPos ?? Math.round((ZONE_DANGER_PCT / 100) * width);
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const zone = contextZone(pct);
  let bar = "";
  for (let i = 0; i < width; i++) {
    if (i === warnPos || i === dangerPos) {
      bar += theme.fg("dim", "│");
    } else if (i < filled) {
      bar += theme.fg(zone.color, "█");
    } else {
      bar += theme.fg("dim", "░");
    }
  }
  return bar;
}
