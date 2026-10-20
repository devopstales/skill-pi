import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, parseKey } from "@earendil-works/pi-tui";
import { OverlayFrame } from "./overlay-frame.js";
import { runScopedModels } from "./model-pick.js";
import type { ActionItem, ActionGroup, TopLevelEntry } from "./types.js";

const TARGET_SET_CHANNEL = "swarm:target-set";

export interface TargetAgent {
  name: string;
  description?: string;
}

export interface TargetOptions {
  agents: readonly TargetAgent[];
}

function resolveProjectDir(cwd: string): string {
  const link = join(cwd, "project");
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(link);
      return isAbsolute(target) ? target : resolve(dirname(link), target);
    }
  } catch {
    // not a shim dir
  }
  return cwd;
}

function parseAgentFile(file: string): TargetAgent | undefined {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    console.warn(`command-plate: skipping agent file ${basename(file)}: ${(err as Error).message}`);
    return undefined;
  }
  const lines = content.split(/\r?\n/);
  let endIndex = -1;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) {
      console.warn(`command-plate: skipping agent file ${basename(file)}: unterminated frontmatter`);
      return undefined;
    }
  }
  const nameLine = endIndex > 0 ? lines.slice(1, endIndex).find((l) => /^name:/.test(l)) : undefined;
  const descLine = endIndex > 0 ? lines.slice(1, endIndex).find((l) => /^description:/.test(l)) : undefined;
  const name = (nameLine ?? "").replace(/^name:\s*/, "").trim() || basename(file, ".md");
  const description = (descLine ?? "").replace(/^description:\s*/, "").trim();
  return { name, description: description || undefined };
}

function listAgentFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function discoverTargetAgents(cwd: string, agentDir: string): TargetAgent[] {
  const project = resolveProjectDir(cwd);
  const projectTypes = listAgentFiles(join(project, ".skill-pi", "agents")).map((f) => parseAgentFile(f));
  const projectNames = new Set(projectTypes.filter(Boolean).map((t) => t!.name));
  const globalTypes = listAgentFiles(join(agentDir, "agents"))
    .map((f) => parseAgentFile(f))
    .filter((t): t is TargetAgent => t !== undefined && !projectNames.has(t.name));
  return [...projectTypes, ...globalTypes].filter((t): t is TargetAgent => t !== undefined);
}

function runCommand(ctx: ExtensionContext, command: string) {
  ctx.ui.setEditorText(command);
  setTimeout(() => process.stdin.emit("data", "\r"), 0);
}

function buildTargetGroup(
  pi: ExtensionAPI,
  getCurrent: () => Promise<string | null>,
  options: TargetOptions,
): ActionGroup {
  const items: ActionItem[] = [
    { key: "build", label: "build", description: "prompt target: main agent" },
    { key: "plan", label: "plan", description: "prompt target: plan-build" },
  ];
  const used = new Set(items.map((item) => item.key));
  for (const agent of options.agents) {
    if (used.has(agent.name)) continue;
    used.add(agent.name);
    const description = agent.description ? `prompt target: agent (${agent.description})` : "prompt target: agent";
    items.push({ key: agent.name, label: agent.name, description });
  }
  for (const item of items) {
    item.action = async () => {
      const current = await getCurrent();
      if (current === item.key) return;
      pi.events.emit(TARGET_SET_CHANNEL, { v: 1, target: item.key });
    };
  }
  return { key: "t", label: "Target", items };
}

export function buildEntries(
  pi: ExtensionAPI,
  openScopedModels: (ctx: ExtensionContext) => Promise<void>,
  getCurrentTarget: () => Promise<string | null>,
  _notify: (message: string, tone?: "info" | "warning" | "error") => void,
  options: TargetOptions,
): TopLevelEntry[] {
  return [
    {
      type: "action",
      key: "m",
      label: "Models",
      description: "switch scoped model",
      action: openScopedModels,
    },
    {
      type: "action",
      key: "s",
      label: "Subagents",
      description: "open the subagents panel",
      action: (ctx) => runCommand(ctx, "/subagents"),
    },
    {
      type: "group",
      group: buildTargetGroup(pi, getCurrentTarget, options),
    },
    {
      type: "action",
      key: "q",
      label: "Quit",
      description: "quit pi",
      action: (ctx) => ctx.shutdown(),
    },
  ];
}

type View = { type: "root" } | { type: "group"; group: ActionGroup };

class CommandPlateOverlay {
  private view: View = { type: "root" };
  private entries: TopLevelEntry[];
  private theme: Theme;
  private done: (result: ActionItem | null) => void;
  private highlightedIndex = 0;

  constructor(
    entries: TopLevelEntry[],
    theme: Theme,
    done: (result: ActionItem | null) => void,
  ) {
    this.entries = entries;
    this.theme = theme;
    this.done = done;
  }

  private get currentItems(): Array<{ key: string; label: string; description?: string }> {
    if (this.view.type === "root") {
      return this.entries.map((e) => {
        if (e.type === "group") {
          return {
            key: e.group.key,
            label: e.group.label,
            description: `${e.group.items.length} action${e.group.items.length !== 1 ? "s" : ""}`,
          };
        }
        return {
          key: e.key,
          label: e.label,
          description: e.description,
        };
      });
    }
    return this.view.group.items;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
      if (this.view.type === "group") {
        this.view = { type: "root" };
        this.highlightedIndex = 0;
      } else {
        this.done(null);
      }
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (this.view.type === "group") {
        this.view = { type: "root" };
        this.highlightedIndex = 0;
      } else {
        this.done(null);
      }
      return;
    }

    if (matchesKey(data, "up")) {
      this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      const items = this.currentItems;
      this.highlightedIndex = Math.min(items.length - 1, this.highlightedIndex + 1);
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const items = this.currentItems;
      if (this.highlightedIndex >= 0 && this.highlightedIndex < items.length) {
        const item = items[this.highlightedIndex];
        if (this.view.type === "root") {
          this.handleRootSelection(item.key);
        } else {
          const action = this.view.group.items.find((a) => a.key === item.key);
          if (action) {
            this.done(action);
          }
        }
      }
      return;
    }

    const parsed = parseKey(data);
    if (parsed && parsed.length === 1 && parsed >= "a" && parsed <= "z") {
      this.selectByKey(parsed.toLowerCase());
    } else if (data.length === 1 && data >= " " && data <= "~") {
      this.selectByKey(data.toLowerCase());
    }
  }

  private selectByKey(key: string): void {
    if (this.view.type === "root") {
      this.handleRootSelection(key);
    } else {
      const action = this.view.group.items.find((a) => a.key === key);
      if (action) {
        this.done(action);
      }
    }
  }

  private handleRootSelection(key: string): void {
    const entry = this.entries.find((e) => {
      if (e.type === "group") return e.group.key === key;
      return e.key === key;
    });
    if (!entry) return;

    if (entry.type === "group") {
      this.view = { type: "group", group: entry.group };
      this.highlightedIndex = 0;
    } else {
      this.done({
        key: entry.key,
        label: entry.label,
        description: entry.description,
        action: entry.action,
      });
    }
  }

  render(width: number, leaderArmed = false): string[] {
    const th = this.theme;
    const f = new OverlayFrame(width, th);
    const lines: string[] = [];

    lines.push(f.top());

    if (leaderArmed) {
      lines.push(f.row(th.fg("accent", th.bold("Command Plate")) + " " + th.fg("dim", "(ctrl+q — select an action)")));
      lines.push(f.separator());
      lines.push(f.bottom());
      return lines;
    }

    if (this.view.type === "root") {
      lines.push(f.row(th.fg("accent", th.bold("Command Plate"))));
    } else {
      const g = this.view.group;
      const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold(g.label));
      lines.push(f.row(breadcrumb));
    }

    lines.push(f.separator());

    const items = this.currentItems;
    if (items.length === 0) {
      lines.push(f.row(th.fg("muted", "  (no items)")));
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isHighlighted = i === this.highlightedIndex;

        const keyBadge = th.fg("warning", th.bold(`[${item.key}]`));
        const label = isHighlighted
          ? th.fg("accent", th.bold(item.label))
          : th.fg("text", item.label);

        let suffix = "";
        if (this.view.type === "root") {
          const entry = this.entries.find((e) => {
            if (e.type === "group") return e.group.key === item.key;
            return e.key === item.key;
          });
          if (entry?.type === "group") {
            suffix = " " + th.fg("dim", ">");
          }
        }

        let line = `${isHighlighted ? "> " : "  "}${keyBadge} ${label}${suffix}`;

        if (item.description) {
          line += "  " + th.fg("dim", item.description);
        }

        lines.push(f.rowTruncated(line));
      }
    }

    lines.push(f.separator());

    if (this.view.type === "root") {
      lines.push(f.row(th.fg("dim", "press key to select | esc close")));
    } else {
      lines.push(f.row(th.fg("dim", "press key to run | bksp back | esc close")));
    }

    lines.push(f.bottom());

    return lines;
  }

  invalidate(): void {}
}

export default function commandPlateExtension(pi: ExtensionAPI) {
  let scopedModelsOpen = false;

  async function openScopedModels(ctx: ExtensionContext) {
    if (!ctx.hasUI || scopedModelsOpen) return;

    scopedModelsOpen = true;
    try {
      await runScopedModels(pi, ctx);
    } finally {
      scopedModelsOpen = false;
    }
  }

  async function openCommandPlate(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const entries = buildEntries(pi, openScopedModels, getCurrentTarget, (message, tone) => ctx.ui.notify(message, tone), targetOptions(ctx.cwd));

    const pending: string[] = [];
    const selected = await ctx.ui.custom<ActionItem | null>(
      (tui, theme, _keybindings, done) => {
        const overlay = new CommandPlateOverlay(entries, theme, done);
        let leaderArmed = false;
        let leaderTimer: NodeJS.Timeout | undefined;
        const disarm = () => {
          leaderArmed = false;
          leaderTimer = undefined;
          tui.requestRender();
        };
        const stopLeader = tui.addInputListener((data: string) => {
          if (matchesKey(data, "escape")) {
            if (leaderArmed) disarm();
            return undefined;
          }
          const parsed = parseKey(data);
          if (parsed === "ctrl+q") {
            leaderArmed = true;
            leaderTimer = setTimeout(disarm, 2000);
            tui.requestRender();
            return { consume: true };
          }
          if (parsed && parsed.length === 1 && parsed >= "a" && parsed <= "z") {
            if (leaderArmed) {
              if (leaderTimer) {
                clearTimeout(leaderTimer);
                leaderTimer = undefined;
              }
              pending.push(parsed.toLowerCase());
              leaderArmed = false;
              tui.requestRender();
              return { consume: true };
            }
            return undefined;
          }
          if (leaderArmed) disarm();
          return undefined;
        });
        return {
          render: (w: number) => overlay.render(w, leaderArmed),
          invalidate: () => overlay.invalidate(),
          handleInput: (data: string) => {
            overlay.handleInput(data);
            tui.requestRender();
          },
          dispose: () => stopLeader(),
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: 80,
          minWidth: 50,
          maxHeight: "80%",
        },
      },
    );

    if (pending.length > 0) {
      const action = entries.find((e) => e.type === "action" && e.key === pending[0]);
      if (action?.type === "action") {
        try {
          await action.action(ctx);
        } catch (err) {
          const detail = err instanceof Error ? err.stack ?? err.message : String(err);
          ctx.ui.notify(`Action failed: ${detail}`, "error");
        }
      }
    }

    if (selected?.action) {
      try {
        await selected.action(ctx);
      } catch (err) {
        const detail = err instanceof Error ? err.stack ?? err.message : String(err);
        ctx.ui.notify(`Action failed: ${detail}`, "error");
      }
    }
  }

  let currentTarget: string | null = null;
  const stopTargetSet = pi.events.on(TARGET_SET_CHANNEL, (data: unknown) => {
    if (typeof data === "object" && data !== null && typeof (data as { target?: unknown }).target === "string") {
      currentTarget = (data as { target: string }).target;
    }
  });
  const stopSwarmReady = pi.events.on("swarm:ready", (data: unknown) => {
    if (typeof data === "object" && data !== null && typeof (data as { target?: unknown }).target === "string") {
      currentTarget = (data as { target: string }).target;
    }
  });
  const getCurrentTarget = async (): Promise<string | null> => currentTarget;
  const targetOptions = (cwd: string): TargetOptions => ({
    agents: discoverTargetAgents(cwd, getAgentDir()),
  });

  const plateLeader: { stop: (() => void) | undefined } = { stop: undefined };
  let plateArmed = false;

  function startPlateLeader(ctx: ExtensionContext) {
    plateLeader.stop?.();
    plateLeader.stop = undefined;
    if (!ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function") return;
    plateArmed = false;
    plateLeader.stop = ctx.ui.onTerminalInput((data) => {
      if (parseKey(data) === "ctrl+q") {
        plateArmed = true;
        return { consume: true };
      }
      if (plateArmed) {
        plateArmed = false;
        const key = parseKey(data);
        if (key === "escape") return undefined;
        if (key === "?") {
          void openCommandPlate(ctx).catch((err) => {
            const detail = err instanceof Error ? err.stack ?? err.message : String(err);
            ctx.ui.notify(`Action failed: ${detail}`, "error");
          });
          return { consume: true };
        }
        if (key && key.length === 1) {
          const entries = buildEntries(pi, openScopedModels, getCurrentTarget, (message, tone) => ctx.ui.notify(message, tone), targetOptions(ctx.cwd));
          const lower = key.toLowerCase();
          const entry = entries.find((e) => (e.type === "group" ? e.group.key === lower : e.key === lower));
          if (entry?.type === "action") {
            void (async () => {
              try {
                await entry.action(ctx);
              } catch (err) {
                const detail = err instanceof Error ? err.stack ?? err.message : String(err);
                ctx.ui.notify(`Action failed: ${detail}`, "error");
              }
            })();
          }
          return { consume: true };
        }
        return undefined;
      }
      return undefined;
    }) as () => void;
  }

  pi.on("session_start", (_event, ctx) => startPlateLeader(ctx));
  pi.on("session_shutdown", () => {
    plateLeader.stop?.();
    plateLeader.stop = undefined;
    plateArmed = false;
    stopTargetSet();
    stopSwarmReady();
  });

  pi.registerCommand("cp", {
    description: "Open Command Plate palette",
    handler: async (_args, ctx) => {
      await openCommandPlate(ctx);
    },
  });

  pi.registerCommand("models", {
    description: "Open the Scoped Models picker",
    handler: async (_args, ctx) => {
      await openScopedModels(ctx);
    },
  });
}
