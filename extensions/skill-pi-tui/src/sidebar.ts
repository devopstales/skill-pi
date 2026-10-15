import type { Component, TUI } from "@earendil-works/pi-tui";

// Store on the terminal, not a module singleton: extension loaders may isolate
// modules, while Pi keeps this terminal across regular/fullscreen transitions.
const STATE = Symbol.for("skill-pi-tui.sidebar.state");
export const VISUAL_SETTINGS_CHANGED = "skill-pi-tui.visual-settings-changed";

export interface SidebarState {
  active: boolean;
  visibility?: { todo?: boolean };
  ownsHost?: () => boolean;
  railColumns?: number;
  statusHidden?: () => boolean;
  headerOwnsStatus?: () => boolean;
  parts: Map<string, SidebarRail>;
}

/** A rail slot in the fullscreen sidebar. */
export interface SidebarRail extends Component {
  digest?(): string;
}

export function sidebarState(tui: TUI): SidebarState {
  const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
  return terminal[STATE] ??= { active: false, parts: new Map() };
}

/** Keep the original bottom component mounted, suppressing only its paint. */
export function sidebarPart<T extends Component & { dispose?(): void }>(tui: TUI, key: string, bottom: T, rail: SidebarRail = bottom): T {
  if (!tui.terminal) return bottom;
  const state = sidebarState(tui);
  state.parts.set(key, rail);
  return {
    ...bottom,
    render: (width: number) => (key === "todo" && state.visibility?.todo === false) || (key === "footer" && (state.statusHidden?.() || state.headerOwnsStatus?.())) || (state.active && state.ownsHost?.()) ? [] : bottom.render(width),
    dispose() {
      if (state.parts.get(key) === rail) state.parts.delete(key);
      bottom.dispose?.();
    },
  };
}

/**
 * Register the fullscreen header rail: the one row above the hstack. This
 * project has no header chrome (deferred), so it only ever writes the "header"
 * slot in sidebarState(tui).parts and returns its own disposer.
 */
export function sidebarHeader(tui: TUI, rail: SidebarRail): () => void {
  if (!tui.terminal) return () => {};
  const state = sidebarState(tui);
  state.parts.set("header", rail);
  return () => {
    if (state.parts.get("header") === rail) state.parts.delete("header");
  };
}
