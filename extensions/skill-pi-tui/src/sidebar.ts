import type { Component, TUI } from "@earendil-works/pi-tui";

// Store on the terminal, not a module singleton: extension loaders may isolate
// modules, while Pi keeps this terminal across regular/fullscreen transitions.
const STATE = Symbol.for("skill-pi-tui.sidebar.state");
export const VISUAL_SETTINGS_CHANGED = "skill-pi-tui.visual-settings-changed";

export interface SidebarState {
  active: boolean;
  /**
   * Whether the [main, rail] hstack is currently attached to the layout root
   * Pi is actually rendering. The bottom-widget suppression (sidebarPart) must
   * key off this, not off `active`: `active` is decided by `prepare()` before
   * `attach()` knows the hstack landed on the live root, so the two can
   * disagree and the todo card would render in both the rail and the main
   * column. `ownsHost()` is derived from this.
   */
  attached?: boolean;
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
    // Suppress the main-screen paint for the todo exactly when the rail owns the
    // host column: ownsHost() is true only while the hstack is attached to the
    // live layout root (state.attached, set by installSidebar's attach() each
    // tick). Without that, a content-fit `active` alone would hide the card here
    // even though the rail isn't painting — or leave it duplicated when the rail
    // is. The footer is never suppressed by the rail: the rail's Status card is a
    // complement, not a replacement, so the model/tokens/cost bar stays visible
    // in the main column regardless of sidebar state.
    render: (width: number) => (key === "todo" && (state.visibility?.todo === false || (state.active && state.ownsHost?.()))) || (key === "footer" && (state.statusHidden?.() || state.headerOwnsStatus?.())) ? [] : bottom.render(width),
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
