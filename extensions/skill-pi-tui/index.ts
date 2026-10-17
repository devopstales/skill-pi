import { resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { installSidebar } from "./src/sidebar-layout.ts";
import { sidebarPart } from "./src/sidebar.ts";
import { renderStatusCard } from "./src/status-card.ts";
import { captureChanges, emptyChanges, type ChangesModel } from "./src/changes.ts";
import { buildFooterContent, type FooterConfig, type FooterState } from "./src/footer.ts";
import { readGitStatus, emptyGitStatus } from "./src/git.ts";
import { readRuntimeInfo } from "./src/runtime.ts";
import { SessionLifecycle } from "./src/session-lifecycle.ts";
import { getModelMeta, invalidateUsageCache } from "./src/state.ts";
import { cleanProviderError } from "./src/provider-error.ts";
import { resolveGlyphs } from "./src/icons.ts";
import { formatCwd } from "./src/utils.ts";
import {
  BannerHeader,
  buildBannerStats,
  countCustomTools,
  loadedResourceCounts,
  mcpServerCount,
} from "./src/banner.ts";
import {
  buildPeekLabel,
  collectPeekParts,
  createPeekState,
  reducePeek,
  type PeekState,
} from "./src/peek.ts";

let currentCtx: ExtensionContext | undefined;
let tuiRef: TUI | undefined;
let removeSidebar: (() => void) | undefined;
let changesTimer: ReturnType<typeof setInterval> | undefined;
let workingTimer: ReturnType<typeof setInterval> | undefined;
let peekSettleTimer: ReturnType<typeof setTimeout> | undefined;
let currentChanges: ChangesModel = emptyChanges();
let footerState: FooterState = { ...emptyGitStatus(), runtime: null, workingSince: undefined, lastDoneIn: undefined };
let peek: PeekState = createPeekState();
let peekFrame = 0;
let peekTaskEpoch = 0;
let peekLabelActive = false;
const lifecycle = new SessionLifecycle();
let getThinkingLevelFn: (() => string) | undefined;

const FOOTER_CONFIG: FooterConfig = {
  iconMode: "auto",
  segments: {
    cwd: true,
    hostname: false,
    sessionName: true,
    gitBranch: true,
    gitStatus: true,
    runtime: true,
    context: true,
    tokens: true,
    cost: true,
    extensionStatuses: true,
    capitalizeProviderName: true,
  },
};

const HIDDEN_THINKING_PADDING = 2;

interface HiddenThinkingComponent {
  children: unknown[];
  setHiddenThinkingLabel(label: string): void;
  setHideThinkingBlock(hide: boolean): void;
  updateContent(message: unknown, isStreaming?: boolean): void;
}

function isHiddenThinkingComponent(value: object): value is HiddenThinkingComponent {
  const c = value as unknown as Record<string, unknown>;
  return (
    Array.isArray(c.children) &&
    typeof c.setHiddenThinkingLabel === "function" &&
    typeof c.setHideThinkingBlock === "function" &&
    typeof c.updateContent === "function"
  );
}

// ponytail: until pi exposes a per-message hidden-thinking label API, walk the
// live component graph and keep the newest matching node (source: pi-open-tui).
function findLatestHiddenThinkingComponent(tui: TUI): HiddenThinkingComponent | undefined {
  const pending: unknown[] = [tui];
  const visited = new Set<object>();
  let latest: HiddenThinkingComponent | undefined;
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (isHiddenThinkingComponent(value)) latest = value;
    const children = (value as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  return latest;
}

function refreshChanges() {
  const cwd = currentCtx?.cwd ?? process.cwd();
  void captureChanges(cwd).then((changes) => {
    currentChanges = changes;
    tuiRef?.requestRender();
  });
}

function refreshGit() {
  const ctx = currentCtx;
  if (!ctx || !lifecycle.isCurrent()) return;
  const generation = lifecycle.currentGeneration();
  void readGitStatus(ctx.cwd).then((git) => {
    if (!lifecycle.isCurrent(generation)) return;
    footerState = { ...footerState, ...git };
    tuiRef?.requestRender();
  });
}

function refreshRuntime() {
  const ctx = currentCtx;
  if (!ctx || !lifecycle.isCurrent()) return;
  const generation = lifecycle.currentGeneration();
  void readRuntimeInfo(ctx.cwd).then((info) => {
    if (!lifecycle.isCurrent(generation)) return;
    footerState = { ...footerState, runtime: info };
    tuiRef?.requestRender();
  });
}

function startWorkingTimer() {
  stopWorkingTimer();
  workingTimer = setInterval(() => {
    if (lifecycle.isCurrent()) tuiRef?.requestRender();
  }, 250);
  workingTimer.unref();
}

function stopWorkingTimer() {
  if (workingTimer) {
    clearInterval(workingTimer);
    workingTimer = undefined;
  }
}

function hiddenThinkingWidth(): number {
  return Math.max(1, (tuiRef?.terminal?.columns ?? 1) - HIDDEN_THINKING_PADDING);
}

function setPeekLabel(ctx?: ExtensionContext) {
  if (peek.phase === "idle") return;
  const target = ctx ?? currentCtx;
  if (!target || !tuiRef) return;
  const node = findLatestHiddenThinkingComponent(tuiRef);
  if (!node) return;
  node.setHiddenThinkingLabel(
    buildPeekLabel(peek, peekFrame, resolveGlyphs(FOOTER_CONFIG.iconMode), hiddenThinkingWidth()),
  );
  peekLabelActive = true;
  tuiRef.requestRender();
}

function clearPeekLabel(ctx?: ExtensionContext) {
  if (!peekLabelActive) return;
  const target = ctx ?? currentCtx;
  if (!target) return;
  try {
    target.ui.setHiddenThinkingLabel();
  } catch {
    // pi without the label API (older builds) — the state reset is what matters
  }
  peekLabelActive = false;
}

function resetPeek() {
  peek = createPeekState();
  if (peekSettleTimer) {
    clearTimeout(peekSettleTimer);
    peekSettleTimer = undefined;
  }
}

function buildTheme(theme: Theme) {
  // ponytail: card theme accepts free color names ("success"/"error"/"accent"/
  // "muted"/"border"/"dim") that pi's ThemeColor union types as the known
  // tokens; pi's Theme.fg resolves them at runtime (and throws on a truly
  // unknown token — the card's fgSafe degrades that to the text role).
  return { fg: (color: ThemeColor, text: string) => theme.fg(color, text), bold: (text: string) => theme.bold(text) };
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (process.stdout.rows < 12 || process.stdout.columns < 50) return;

    lifecycle.start();
    footerState = { ...emptyGitStatus(), runtime: null, workingSince: undefined, lastDoneIn: undefined };
    resetPeek();
    clearPeekLabel(ctx);
    try {
      getThinkingLevelFn = () => pi.getThinkingLevel();
    } catch {
      getThinkingLevelFn = undefined;
    }

    const agentDir = getAgentDir();

    const settings = (() => {
      try {
        const raw = pi.getSettings();
        return {
          packages: Array.isArray(raw.packages) ? raw.packages.length : 0,
          extensions: Array.isArray(raw.extensions) ? [...raw.extensions] : [],
          skills: Array.isArray(raw.skills) ? [...raw.skills] : [],
        };
      } catch {
        return { packages: 0, extensions: [] as string[], skills: [] as string[] };
      }
    })();

    const { skills, extensions } = await loadedResourceCounts(
      ctx.cwd,
      agentDir,
      settings.extensions,
      settings.skills,
    );

    const customTools = countCustomTools(() => pi.getAllTools());

    const mcpConfigured = mcpServerCount(ctx.cwd, agentDir);
    let mcpLoaded = 0;
    try {
      mcpLoaded = pi.getMcpServers().length;
    } catch {
      mcpLoaded = 0;
    }

    const stats = buildBannerStats({
      cwd: ctx.cwd,
      settings: { packages: settings.packages },
      mcpConfigured,
      mcpLoaded,
      skills,
      extensions,
      customTools,
    });

    ctx.ui.setHeader((_tui, _theme) => new BannerHeader(stats));

    currentCtx = ctx;
    refreshChanges();
    changesTimer = setInterval(refreshChanges, 2000);
    changesTimer.unref();
    refreshGit();
    refreshRuntime();

    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;
      const barTheme = buildTheme(theme);
      const footerDigest = () =>
        JSON.stringify([footerState.branch, footerState.modified, footerState.untracked, footerState.staged, footerState.runtime?.name, footerState.workingSince ?? 0, footerState.lastDoneIn ?? 0]);
      const bottom: Component & { dispose(): void; digest?: () => string } = {
        render(width: number): string[] {
          const model = getModelMeta(ctx, getThinkingLevelFn ?? (() => "off"), FOOTER_CONFIG.segments.capitalizeProviderName);
          const { mainLines, extensionLines } = buildFooterContent(
            ctx,
            footerState,
            FOOTER_CONFIG,
            model,
            theme,
            footerData,
            width,
          );
          return [...mainLines, ...extensionLines];
        },
        invalidate() {},
        digest: footerDigest,
        dispose() {
          removeSidebar?.();
          removeSidebar = undefined;
          tuiRef = undefined;
        },
      };
      const statusCard = {
        render(width: number): string[] {
          const changes = currentChanges.files.length
            ? { files: currentChanges.files.length, added: currentChanges.added, deleted: currentChanges.deleted, notice: currentChanges.notice }
            : undefined;
          return renderStatusCard(
            {
              cwd: formatCwd(resolve(currentCtx?.cwd ?? ctx.cwd)),
              branch: footerData?.getGitBranch() ?? null,
              sessionName: ctx.sessionManager?.getSessionName?.() ?? undefined,
              changes,
            },
            barTheme,
            width,
          );
        },
        invalidate: () => tui.requestRender(),
        digest: () => JSON.stringify([currentChanges.added, currentChanges.deleted, currentChanges.files.length]),
      };
      const part = sidebarPart(tui, "footer", bottom, statusCard);
      removeSidebar = installSidebar(tui, barTheme);
      return part;
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    lifecycle.shutdown();
    stopWorkingTimer();
    if (peekSettleTimer) {
      clearTimeout(peekSettleTimer);
      peekSettleTimer = undefined;
    }
    if (changesTimer) {
      clearInterval(changesTimer);
      changesTimer = undefined;
    }
    clearPeekLabel(ctx);
    resetPeek();
    ctx.ui.setFooter(undefined);
    removeSidebar?.();
    removeSidebar = undefined;
    tuiRef = undefined;
    currentCtx = undefined;
    currentChanges = emptyChanges();
    footerState = { ...emptyGitStatus(), runtime: null, workingSince: undefined, lastDoneIn: undefined };
  });

  pi.on("agent_start", () => {
    if (!lifecycle.isCurrent()) return;
    peekTaskEpoch++;
    footerState = { ...footerState, workingSince: Date.now(), lastDoneIn: undefined };
    startWorkingTimer();
  });

  pi.on("agent_end", () => {
    if (!lifecycle.isCurrent()) return;
    stopWorkingTimer();
    if (footerState.workingSince !== undefined) {
      footerState = { ...footerState, lastDoneIn: Date.now() - footerState.workingSince, workingSince: undefined };
    }
    tuiRef?.requestRender();
  });

  pi.on("message_start", (event, ctx) => {
    if (!lifecycle.isCurrent()) return;
    const role = (event as { message?: { role?: string } }).message?.role;
    if (role === "user" || role === "assistant") {
      resetPeek();
      clearPeekLabel(ctx);
    }
  });

  pi.on("message_update", (event, ctx) => {
    if (!lifecycle.isCurrent()) return;
    const message = (event as { message?: { role?: string; content?: unknown } }).message;
    if (!message || message.role !== "assistant") return;
    if (peek.phase === "done") return;
    const parts = collectPeekParts(message.content);
    const next = reducePeek(peek, parts);
    const changed = next.phase !== peek.phase || next.tail !== peek.tail;
    peek = next;
    if (!changed) return;
    if (peek.phase === "thinking") {
      peekFrame++;
      setPeekLabel(ctx);
    } else if (peek.phase === "done") {
      setPeekLabel(ctx);
    }
  });

  pi.on("message_end", (event) => {
    if (!lifecycle.isCurrent()) return;
    const message = (event as { message?: unknown }).message;
    if (message?.role === "assistant" && peek.phase === "thinking") {
      peek = { ...peek, phase: "done" };
      setPeekLabel();
    }
    const cleaned = cleanProviderError(message);
    if (cleaned) {
      // pi renders a red `Error: ${errorMessage}` line for any stopReason "error"
      // message, independent of the content. Blank the (raw) content and carry the
      // humanized reason in errorMessage so the error shows exactly once,
      // readable, instead of a raw payload plus "Unknown error".
      const text = cleaned.content.find((c) => c.type === "text")?.text;
      return { message: { ...message, content: [], errorMessage: text } };
    }
    invalidateUsageCache();
    tuiRef?.requestRender();
  });

  pi.on("agent_settled", (_event, ctx) => {
    const settleEpoch = peekTaskEpoch;
    if (peekSettleTimer) clearTimeout(peekSettleTimer);
    peekSettleTimer = setTimeout(() => {
      peekSettleTimer = undefined;
      if (!lifecycle.isCurrent() || peekTaskEpoch !== settleEpoch) return;
      resetPeek();
      clearPeekLabel(ctx);
    }, 300);
    peekSettleTimer.unref?.();
  });

  pi.on("model_select", () => {
    if (lifecycle.isCurrent()) tuiRef?.requestRender();
  });

  pi.on("thinking_level_select", () => {
    if (lifecycle.isCurrent()) tuiRef?.requestRender();
  });

  pi.on("tool_execution_end", () => {
    if (lifecycle.isCurrent()) tuiRef?.requestRender();
  });

  pi.on("session_compact", () => {
    if (!lifecycle.isCurrent()) return;
    invalidateUsageCache();
    tuiRef?.requestRender();
  });
}
