import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { VERSION, getAgentDir, SettingsManager, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { installSidebar } from "./src/sidebar-layout.ts";
import { sidebarPart } from "./src/sidebar.ts";
import { renderStatusCard } from "./src/status-card.ts";
import { captureChanges, emptyChanges, type ChangesModel } from "./src/changes.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { buildFooterContent, type FooterConfig, type FooterState } from "./src/footer.ts";
import { readGitStatus, emptyGitStatus } from "./src/git.ts";
import { readRuntimeInfo } from "./src/runtime.ts";
import { SessionLifecycle } from "./src/session-lifecycle.ts";
import { getModelMeta, invalidateUsageCache } from "./src/state.ts";
import { resolveGlyphs } from "./src/icons.ts";
import {
  buildPeekLabel,
  collectPeekParts,
  createPeekState,
  reducePeek,
  type PeekState,
} from "./src/peek.ts";

const LOGO = [
  " ███████╗██╗  ██╗██╗██╗     ██╗     ██████╗  ██████╗ ██╗██████╗  ",
  " ██╔════╝██║  ██║██║██║     ██║    ██╔════╝  ██╔══██╗██║██╔══██╗ ",
  " ███████╗███████║██║██║     ██║    ██║   ███╗██████╔╝██║██║  ██║ ",
  " ╚════██║██╔══██║██║██║     ██║    ██║    ██║██╔══██╗██║██║  ██║ ",
  " ███████║██║  ██║██║███████╗███████╗╚██████╔╝██║  ██║██║██████╔╝ ",
  " ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ",
];

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const FG = "\x1b[38;2;152;84;241m";

function color(text: string): string {
  return `${BOLD}${FG}${text}${RESET}`;
}

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

interface BannerStats {
  gitBranch: string;
  path: string;
  mcpServers: number;
  packages: number;
  skills: number;
  extensions: number;
  piVersion: string;
  customTools: number;
}

function gitBranch(cwd: string): string {
  try {
    const branch = sanitizeTerminalText(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim());
    return branch || "(detached)";
  } catch {
    return "(not a git repo)";
  }
}

function shortPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
  return cwd;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function mcpServerCount(cwd: string, agentDir: string): number {
  const count = (doc: unknown): number => {
    const servers = (doc as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers;
    return servers && typeof servers === "object" ? Object.keys(servers).length : 0;
  };
  // mcp.json files are additive: the project layer sits next to cwd, the
  // global one next to the agent dir.
  return count(readJson(join(cwd, "mcp.json"))) + count(readJson(join(agentDir, "mcp.json")));
}

async function loadedResourceCounts(
  cwd: string,
  agentDir: string,
  cliExtensions: string[],
  cliSkills: string[],
): Promise<{ skills: number; extensions: number }> {
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: cliExtensions,
      additionalSkillPaths: cliSkills,
      noExtensions: true,
    });
    await loader.reload();
    return {
      skills: loader.getSkills().skills.length,
      extensions: loader.getExtensions().extensions.length,
    };
  } catch {
    return { skills: 0, extensions: 0 };
  }
}

function buildStatsLines(stats: BannerStats): string[] {
  const cells: Array<[string, string]> = [
    ["GIT:", `On branch ${stats.gitBranch}`],
    ["PATH:", stats.path],
    ["MCP:", `${stats.mcpServers} server(s)`],
    ["PLUGINS:", `${stats.packages} package(s)`],
    ["SKILLS:", `${stats.skills} loaded`],
    ["EXTENSIONS:", `${stats.extensions} active`],
    ["PI:", `v${stats.piVersion}`],
    ["TOOLS:", `${stats.customTools} custom`],
  ];
  const labelW = Math.max(...cells.map(([l]) => l.length));
  const kvGap = 1;
  const cellGap = 4;
  const valueW = Math.max(...cells.map(([, v]) => v.length));
  const cellW = labelW + kvGap + valueW;
  const rows: Array<[string, string, string, string]> = [];
  for (let i = 0; i < cells.length; i += 2) {
    const [l1, v1] = cells[i];
    const [l2, v2] = cells[i + 1] || ["", ""];
    rows.push([l1, v1, l2, v2]);
  }
  return rows.map(([l1, v1, l2, v2]) => {
    const left = `${l1.padEnd(labelW)}${" ".repeat(kvGap)}${dim(v1.padEnd(valueW))}`;
    const right = l2 ? `${l2.padEnd(labelW)}${" ".repeat(kvGap)}${dim(v2.padEnd(valueW))}` : " ".repeat(cellW);
    return left + " ".repeat(cellGap) + right;
  });
}

class BannerHeader implements Component {
  private stats: BannerStats;

  constructor(stats: BannerStats) {
    this.stats = stats;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    for (const line of LOGO) {
      const pad = Math.max(0, Math.floor((width - line.length) / 2));
      lines.push(" ".repeat(pad) + color(line));
    }

    const tagline = "isolated session ready";
    const tagPad = Math.max(0, Math.floor((width - tagline.length) / 2));
    lines.push(" ".repeat(tagPad) + dim(tagline));

    for (const line of buildStatsLines(this.stats)) {
      const pad = Math.max(0, Math.floor((width - line.length) / 2));
      lines.push(" ".repeat(pad) + line);
    }

    return lines.map((l) => truncateToWidth(l, width, ""));
  }
}

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
    context: false,
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

function shortenHome(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home || !cwd.startsWith(home)) return cwd;
  const rel = cwd.slice(home.length).replace(/^\/+/, "");
  return rel ? `~/${rel}` : "~";
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

    let customTools = 0;
    try {
      for (const tool of pi.getAllTools()) {
        if (tool.sourceInfo.source !== "builtin") customTools += 1;
      }
    } catch {
      customTools = 0;
    }

    const mcpConfigured = mcpServerCount(ctx.cwd, agentDir);
    let mcpLoaded = 0;
    try {
      mcpLoaded = pi.getMcpServers().length;
    } catch {
      mcpLoaded = 0;
    }
    const mcpServers = mcpConfigured > 0 ? mcpConfigured : mcpLoaded;

    const stats: BannerStats = {
      gitBranch: gitBranch(ctx.cwd),
      path: shortPath(resolve(ctx.cwd)),
      mcpServers,
      packages: settings.packages,
      skills,
      extensions,
      piVersion: VERSION,
      customTools,
    };

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
              cwd: shortenHome(resolve(currentCtx?.cwd ?? ctx.cwd)),
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
    const message = (event as { message?: { role?: string } }).message;
    if (message?.role === "assistant" && peek.phase === "thinking") {
      peek = { ...peek, phase: "done" };
      setPeekLabel();
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
