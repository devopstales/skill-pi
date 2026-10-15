import { ScrollView, VStack, visibleWidth, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { sidebarState, type SidebarRail } from "./sidebar.ts";
import { cardStyle, type CardStyle } from "./card.ts";

export const SIDEBAR_BREAKPOINT = 140;
const RAIL_WIDTH = 50;
const RAIL_PADDING = 1;
const GAP = 3;
/** Right-edge columns the painting rail takes from the editor column. */
export const SIDEBAR_RAIL_COLUMNS = RAIL_WIDTH + GAP;
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: "stretch" | "start" | "center" | "end" };
type TuiMouseDispatchResult = TuiMouseEventResult & { handled: true; target: { component: Component; originX: number; originY: number; width: number; height: number } };
type StackLayoutEntry = ConstructorParameters<typeof VStack>[0] extends Array<infer T> | undefined ? Exclude<T, Component> : never;
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };
type SidebarCache = { revision: number };
type RailHit = { key: string; component: Component; startY: number; height: number; width: number };
type SectionCacheEntry = { component: Component; digest: string | undefined; revision: number; contentWidth: number; lines: string[] };
type SidebarPresentation = { scrollTop: number; output: LayoutNode };
type PreparedRail = {
  revision: number;
  width: number;
  mode: string | undefined;
  cardStyle: CardStyle;
  root: LayoutRoot;
  parts: Array<[string, SidebarRail]>;
  digests: Array<string | undefined>;
  contentWidth: number;
  active: boolean;
  lines: string[];
  hits: RailHit[];
  presentation?: SidebarPresentation;
};
const CACHE = Symbol.for("skill-pi-tui.sidebar.cache");

function sidebarCache(tui: TUI): SidebarCache {
  const terminal = tui.terminal as unknown as Record<symbol, SidebarCache>;
  return terminal[CACHE] ??= { revision: 0 };
}

/** Mark terminal-owned fullscreen sidebar output stale after a part state change. */
export function invalidateSidebar(tui: TUI): void {
  if (tui.terminal) sidebarCache(tui).revision++;
}

function railDigest(rail: SidebarRail): string | undefined {
  try {
    return rail.digest?.();
  } catch {
    return undefined;
  }
}

/** Installs the fullscreen rail: wraps the host layout root with the [main, rail] hstack and returns a disposer restoring the original layout. */
export function installSidebar(tui: TUI, theme: { fg(color: string, text: string): string; bold(text: string): string }, placement: () => "auto" | "right" | "bottom" | "hidden" = () => "auto", _headerPlacement: () => "top" | "below-input" = () => "top", density: () => "comfortable" | "minimal" = () => "comfortable"): () => void {
  if (!tui.terminal) return () => {};
  const host = tui as Host;
  const state = sidebarState(tui);
  const cache = sidebarCache(tui);
  const cleanups: Array<() => void> = [];
  const roots = new Set<LayoutRoot>();
  // ponytail: the footer container (pi's setFooter mount point) has no layout
  // node of its own — the fullscreen layout engine renders its children's lines
  // directly, which breaks the rail's row alignment. Give it a vstack node with
  // no entries (renders empty natively) and rebuild it each tick from the live
  // children so the rail owns its content.
  const docked = new Set<Component>();
  let stopped = false;
  let failed = false;
  let preparing = false;
  let railLines: string[] = [];
  let prepared: PreparedRail | undefined;
  const sectionCache = new Map<string, SectionCacheEntry>();
  state.active = false;
  state.statusHidden = () => !stopped && placement() === "hidden";
  state.headerOwnsStatus = () => false;
  state.railColumns = SIDEBAR_RAIL_COLUMNS;
  state.ownsHost = () => !stopped && host.mode === "fullscreen" && tui.terminal.columns >= SIDEBAR_BREAKPOINT && (placement() === "auto" || placement() === "right") && !!host.layoutRoot && roots.has(host.layoutRoot);
  const rail: Component = {
    render: () => railLines,
    invalidate() {
      invalidateSidebar(tui);
      for (const part of state.parts.values()) part.invalidate();
    },
  };
  const scroll = new ScrollView(rail, {
    follow: "none",
    primary: false,
    overscroll: "contain",
    scrollbar: "auto",
    scrollbarTrackStyle: (text) => theme.fg("border", text),
    scrollbarThumbStyle: (text) => theme.fg("accent", text),
  });
  const nativeMouse = scroll.handleMouse.bind(scroll);
  const dispatchPartMouse = (event: TuiMouseEvent): TuiMouseDispatchResult | undefined => {
    const current = prepared;
    if (!current || stopped || failed || !current.active || current.revision !== cache.revision ||
      host.mode !== "fullscreen" || tui.terminal.columns !== current.width || host.layoutRoot !== current.root ||
      scroll.getContentWidth(event.width) !== current.contentWidth || event.x < RAIL_PADDING ||
      event.x >= current.contentWidth || event.y < 0 || event.y >= event.height) return undefined;
    const contentY = scroll.scrollTop + event.y;
    const hit = current.hits.find((candidate) => contentY >= candidate.startY && contentY < candidate.startY + candidate.height);
    if (!hit || state.parts.get(hit.key) !== hit.component || event.x >= RAIL_PADDING + hit.width) return undefined;
    const result = hit.component.handleMouse?.({
      ...event,
      x: event.x - RAIL_PADDING,
      y: contentY - hit.startY,
      width: hit.width,
      height: hit.height,
    });
    if (!result?.handled) return undefined;
    return { handled: true, capture: result.capture, focus: result.focus, render: result.render, target: { component: hit.component, originX: event.x - RAIL_PADDING, originY: contentY - hit.startY, width: hit.width, height: hit.height } };
  };
  scroll.handleMouse = (event) => {
    if (event.type === "wheel") {
      const sectionResult = dispatchPartMouse(event);
      if (sectionResult?.handled) return sectionResult;
      scroll.scrollBy(event.wheelDelta ?? 0);
      return { handled: true } as ReturnType<typeof nativeMouse>;
    }
    return dispatchPartMouse(event) ?? nativeMouse(event);
  };
  const prepare = (width: number, root: LayoutRoot): boolean => {
    state.active = false;
    if (stopped || failed || host.mode !== "fullscreen") {
      prepared = undefined;
      return false;
    }
    if (preparing) return prepared?.active ?? false;
    preparing = true;
    try {
      const railEligible = width >= SIDEBAR_BREAKPOINT && placement() !== "bottom" && placement() !== "hidden";
      if (!railEligible) {
        prepared = undefined;
        return false;
      }
      const style = cardStyle();
      const parts = [...state.parts.entries()];
      const digests = parts.map(([, rail]) => railDigest(rail));
      const prev = prepared;
      const unchanged = prev !== undefined &&
        prev.revision === cache.revision &&
        prev.width === width && prev.mode === host.mode && prev.cardStyle === style && prev.root === root &&
        prev.parts.length === parts.length && prev.parts.every(([key, part], index) => parts[index]?.[0] === key && parts[index]?.[1] === part) &&
        prev.digests.length === digests.length && prev.digests.every((digest, index) => digest === digests[index]);
      if (unchanged) {
        railLines = prev.lines;
        state.active = prev.active;
        return prev.active;
      }
      const contentWidth = scroll.getContentWidth(RAIL_WIDTH);
      const sections = ["footer", "agents", "todo"].filter((key) => key !== "todo" || state.visibility?.todo !== false).map((key) => {
        const component = state.parts.get(key);
        if (!component) {
          sectionCache.delete(key);
          return { key, component, lines: [] as string[] };
        }
        const digest = railDigest(component);
        const existing = sectionCache.get(key);
        const reusable = existing?.component === component && existing.contentWidth === contentWidth &&
          (digest !== undefined ? existing.digest === digest : existing.digest === undefined && existing.revision === cache.revision);
        const lines = reusable ? existing.lines : (() => {
          const rendered = [...(component.render(contentWidth - RAIL_PADDING * 2) ?? [])];
          while (rendered.length && rendered[rendered.length - 1]?.trim() === "") rendered.pop();
          return rendered;
        })();
        sectionCache.set(key, { component, digest, revision: cache.revision, contentWidth, lines });
        return { key, component, lines };
      }).filter((section) => section.component !== undefined && section.lines.length > 0) as Array<{ key: string; component: Component; lines: string[] }>;
      const hits: RailHit[] = [];
      railLines = [];
      for (const section of sections) {
        if (hits.length > 0 && density() === "comfortable") railLines.push("");
        const startY = railLines.length;
        railLines.push(...section.lines.map((line) => " ".repeat(RAIL_PADDING) + line + " ".repeat(RAIL_PADDING)));
        hits.push({ key: section.key, component: section.component, startY, height: section.lines.length, width: contentWidth - RAIL_PADDING * 2 });
      }
      const active = railLines.length > 0 && railLines.every((line) => visibleWidth(line) <= contentWidth);
      prepared = { revision: cache.revision, width, mode: host.mode, cardStyle: style, root, parts, digests, contentWidth, active, lines: railLines, hits };
      state.active = active;
      return active;
    } catch {
      failed = true;
      return false;
    } finally {
      preparing = false;
    }
  };
  const dock = (component: Component & { [NODE]?: () => LayoutNode }): LayoutNode => {
    if (typeof component[NODE] === "function") {
      const node = component[NODE]!();
      if (node.type === "vstack" || node.type === "hstack") return node;
    }
    const children = (component as { children?: unknown[] }).children;
    if (Array.isArray(children) && children.length > 0) {
      const entries: StackLayoutEntry[] = [];
      for (const child of children) {
        if (!child || typeof child !== "object") continue;
        entries.push({ component: child as Component, basis: 0, grow: 0, shrink: 1, minSize: 0 });
      }
      if (entries.length > 0) return { type: "vstack", entries, gap: 0, align: "stretch" };
    }
    return { type: "vstack", entries: [], gap: 0, align: "stretch" };
  };
  const dockContainer = (container: Component) => {
    if (docked.has(container)) return;
    docked.add(container);
    const target = container as Component & { [NODE]?: () => LayoutNode };
    const descriptor = Object.getOwnPropertyDescriptor(target, NODE);
    target[NODE] = () => dock(target);
    cleanups.push(() => {
      if (docked.delete(container)) {
        if (descriptor) Object.defineProperty(target, NODE, descriptor);
        else Reflect.deleteProperty(target, NODE);
      }
    });
  };
  const trueOriginals = new Map<LayoutRoot, () => LayoutNode>();
  const attach = () => {
    if (stopped || failed) return;
    if (host.mode !== "fullscreen") { state.active = false; return; }
    try {
      const root = host.layoutRoot;
      if (!root || typeof root[NODE] !== "function") { state.active = false; return; }
      let original = trueOriginals.get(root);
      if (!original) {
        original = root[NODE]!;
        trueOriginals.set(root, original);
      }
      const left = { render: () => [], invalidate() {}, [NODE]: () => original.call(root) };
      const hstackHost: Component & { [NODE](): LayoutNode } = {
        render: () => [],
        invalidate() {},
        [NODE]: () => ({ type: "hstack", gap: GAP, align: "stretch", entries: [
          { component: left, basis: 0, grow: 1, shrink: 1, minSize: 1 },
          { component: scroll, basis: RAIL_WIDTH, grow: 0, shrink: 0, minSize: RAIL_WIDTH },
        ] }),
      };
      const replacement = () => {
        if (!prepare(tui.terminal.columns, root)) return original.call(root);
        const current = prepared!;
        if (current.presentation?.scrollTop === scroll.scrollTop) return current.presentation.output;
        return (current.presentation = { scrollTop: scroll.scrollTop, output: hstackHost[NODE]() }).output;
      };
      if (root[NODE] !== replacement) {
        root[NODE] = replacement;
        const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
        cleanups.push(() => {
          if (root[NODE] !== replacement) return;
          if (descriptor) Object.defineProperty(root, NODE, descriptor);
          else Reflect.deleteProperty(root, NODE);
        });
      }
      tui.requestRender();
    } catch {
      failed = true;
      state.active = false;
    }
  };
  attach();
  const timer = setInterval(attach, 100);
  timer.unref();
  return () => {
    stopped = true;
    state.active = false;
    clearInterval(timer);
    scroll.setScrollbar("hidden");
    for (const cleanup of cleanups.reverse()) cleanup();
    tui.requestRender();
  };
}
