import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
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
      type: "group",
      group: {
        key: "a",
        label: "Agents",
        items: [
          {
            key: "s",
            label: "Subagents",
            description: "open the subagents panel",
            action: (ctx) => runCommand(ctx, "/subagents"),
          },
          {
            key: "p",
            label: "Processes",
            description: "show running processes",
            action: (ctx) => runCommand(ctx, "/ps"),
          },
        ],
      },
    },
    {
      type: "action",
      key: "t",
      label: "Tree",
      description: "open native session tree",
      action: (ctx) => runCommand(ctx, "/tree"),
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

  render(width: number): string[] {
    const th = this.theme;
    const f = new OverlayFrame(width, th);
    const lines: string[] = [];

    lines.push(f.top());

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
  let stopScopedModelsShortcut: (() => void) | undefined;
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

    const selected = await ctx.ui.custom<ActionItem | null>(
      (tui, theme, _kb, done) => {
        const overlay = new CommandPlateOverlay(entries, theme, done);
        return {
          render: (w: number) => overlay.render(w),
          invalidate: () => overlay.invalidate(),
          handleInput: (data: string) => {
            overlay.handleInput(data);
            tui.requestRender();
          },
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

    if (selected) {
      try {
        await selected.action(ctx);
      } catch (err) {
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
        ctx.ui.notify(`Action failed: ${detail}`, "error");
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    stopScopedModelsShortcut?.();
    stopScopedModelsShortcut = ctx.ui.onTerminalInput((data) => {
      if (parseKey(data) !== Key.ctrl("m")) return;
      void openScopedModels(ctx);
      return { consume: true };
    });
  });

  pi.on("session_shutdown", async () => {
    stopScopedModelsShortcut?.();
    stopScopedModelsShortcut = undefined;
  });

  pi.registerCommand("cp", {
    description: "Open Command Plate palette",
    handler: async (_args, ctx) => {
      await openCommandPlate(ctx);
    },
  });

  pi.registerShortcut(Key.ctrl("k"), {
    description: "Open Command Plate",
    handler: async (ctx) => {
      await openCommandPlate(ctx);
    },
  });
}
