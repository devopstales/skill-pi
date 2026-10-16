import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, parseKey } from "@earendil-works/pi-tui";
import { OverlayFrame } from "./overlay-frame.js";
import { runScopedModels } from "./model-pick.js";
import type { ActionItem, ActionGroup, TopLevelEntry } from "./types.js";

function runCommand(ctx: ExtensionContext, command: string) {
  ctx.ui.setEditorText(command);
  setTimeout(() => process.stdin.emit("data", "\r"), 0);
}

export function buildEntries(
  pi: ExtensionAPI,
  openScopedModels: (ctx: ExtensionContext) => Promise<void>,
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

    const entries = buildEntries(pi, openScopedModels);

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

    if (selected) {
      try {
        await selected.action(ctx);
      } catch (err) {
        const detail = err instanceof Error ? err.stack ?? err.message : String(err);
        ctx.ui.notify(`Action failed: ${detail}`, "error");
      }
    }
  }

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
          const entries = buildEntries(pi, openScopedModels);
          const action = entries.find((e) => e.type === "action" && e.key === key.toLowerCase());
          if (action?.type === "action") {
            void (async () => {
              try {
                await action.action(ctx);
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
