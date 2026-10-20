import {
  keyHint,
  rawKeyHint,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { PERMISSION_CHOICES, type PermissionPromptChoice } from "./constants.js";

const HORIZONTAL_PADDING = 3;
const OVERLAY_INSET = 6;
const MIN_OVERLAY_WIDTH = 60;
const MIN_OVERLAY_HEIGHT = 16;

interface CommandDialogState {
  selectedIndex: number;
  scrollOffset: number;
}

type CommandDialogResult = PermissionPromptChoice | undefined;

export interface CommandDialogPreview {
  toolName: string;
  command: string;
}

export async function showCommandPreviewDialog(
  ctx: ExtensionContext,
  preview: CommandDialogPreview,
): Promise<PermissionPromptChoice | undefined> {
  return ctx.ui.custom<CommandDialogResult>((tui: TUI, theme: Theme, keybindings: KeybindingsManager, done) => {
    return new CommandPreviewDialog(tui, theme, keybindings, preview, done);
  }, {
    overlay: true,
    overlayOptions: getCommandOverlayOptions(process.stdout.columns ?? 80, process.stdout.rows ?? 24),
  });
}

class CommandPreviewDialog implements Component {
  private selectedIndex = 0;
  private scrollOffset = 0;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly preview: CommandDialogPreview,
    private readonly done: (result: CommandDialogResult) => void,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.selectedIndex = Math.min(PERMISSION_CHOICES.length - 1, this.selectedIndex + 1);
      this.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.getScrollPageSize());
      this.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.scrollOffset += this.getScrollPageSize();
      this.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm") || data === "\n") {
      this.done(PERMISSION_CHOICES[this.selectedIndex]);
      return;
    }

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done(undefined);
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - HORIZONTAL_PADDING);
    const frameWidth = innerWidth - 2;
    const titleLines = wrapSection(this.getTitle(), frameWidth, this.theme);
    const metaLines = wrapSection(this.getMeta(), frameWidth, this.theme);
    const actionLines = this.getActionLines(frameWidth);
    const hintLines = wrapSection(this.getHintText(), frameWidth, this.theme);

    const maxHeight = getCommandOverlayOptions(this.tui.terminal.columns, this.tui.terminal.rows).maxHeight;
    const availableHeight = typeof maxHeight === "number" ? maxHeight : this.tui.terminal.rows - 2;
    const previewHeight = Math.max(
      4,
      availableHeight - titleLines.length - metaLines.length - actionLines.length - hintLines.length - 5,
    );

    const previewLines = this.getVisiblePreviewLines(frameWidth, previewHeight);
    const lines = [
      this.renderBorder(width, "top"),
      ...titleLines.map((line) => this.renderBodyLine(width, line)),
      ...metaLines.map((line) => this.renderBodyLine(width, line)),
      this.renderBorder(width, "middle"),
      ...previewLines.map((line) => this.renderBodyLine(width, line)),
      this.renderBorder(width, "middle"),
      ...actionLines.map((line) => this.renderBodyLine(width, line)),
      this.renderBorder(width, "middle"),
      ...hintLines.map((line) => this.renderBodyLine(width, line)),
      this.renderBorder(width, "bottom"),
    ];

    return lines;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private getTitle(): string {
    return `${this.theme.fg("accent", this.theme.bold(this.preview.toolName))} ${this.theme.fg("muted", "(command preview)")}`;
  }

  private getMeta(): string {
    const lineCount = this.preview.command.split("\n").length;
    return `${this.theme.fg("muted", "command preview")} • ${this.theme.fg("text", `${lineCount} line${lineCount === 1 ? "" : "s"}`)}`;
  }

  private getActionLines(width: number): string[] {
    return PERMISSION_CHOICES.map((choice, index) => {
      const isSelected = index === this.selectedIndex;
      const prefix = isSelected ? this.theme.fg("accent", "→") : this.theme.fg("muted", " ");
      const label = isSelected ? this.theme.fg("accent", choice) : this.theme.fg("text", choice);
      return truncateToWidth(`${prefix} ${label}`, width, "…", true);
    });
  }

  private getHintText(): string {
    const scrollHint = rawKeyHint(getScrollHintLabel(), "scroll");
    return [
      rawKeyHint("↑↓", "choose"),
      keyHint("tui.select.confirm", "select"),
      scrollHint,
      keyHint("tui.select.cancel", "cancel"),
    ].join("  ");
  }

  private getVisiblePreviewLines(width: number, height: number): string[] {
    const allLines = this.buildPreviewLines(width);
    if (allLines.length === 0) {
      return [truncateToWidth(this.theme.fg("muted", "Nothing to preview."), width, "…", true)];
    }

    const safeHeight = Math.max(1, height);
    const clampedOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, allLines.length - safeHeight)));
    this.scrollOffset = clampedOffset;

    const showTopIndicator = clampedOffset > 0;
    const showBottomIndicator = clampedOffset + safeHeight < allLines.length;
    const indicatorSlots = Number(showTopIndicator) + Number(showBottomIndicator);
    const contentHeight = Math.max(1, safeHeight - indicatorSlots);
    const visibleLines = allLines.slice(clampedOffset, clampedOffset + contentHeight);
    const lines: string[] = [];

    if (showTopIndicator) {
      lines.push(
        truncateToWidth(
          this.theme.fg("muted", `↑ ${clampedOffset} line${clampedOffset === 1 ? "" : "s"} above`),
          width,
          "…",
          true,
        ),
      );
    }

    for (const line of visibleLines) {
      lines.push(truncateToWidth(line, width, "…", true));
    }

    if (showBottomIndicator) {
      lines.push(
        truncateToWidth(
          this.theme.fg("muted", `↓ ${allLines.length - clampedOffset - contentHeight} more line${allLines.length - clampedOffset - contentHeight === 1 ? "" : "s"}`),
          width,
          "…",
          true,
        ),
      );
    }

    while (lines.length < safeHeight) {
      lines.push(" ".repeat(width));
    }

    return lines;
  }

  private buildPreviewLines(width: number): string[] {
    const rawLines = this.preview.command.length === 0 ? [""] : this.preview.command.split("\n");
    return rawLines.flatMap((line: string) => {
      const content = this.theme.fg("toolOutput", line);
      const wrapped = wrapTextWithAnsi(content, width);
      return wrapped.length > 0 ? wrapped : [this.theme.fg("muted", "")];
    });
  }

  private getScrollPageSize(): number {
    return 8;
  }

  private renderBodyLine(width: number, content: string): string {
    const bodyWidth = Math.max(1, width - 4);
    return `${this.theme.fg("border", "│")} ${truncateToWidth(content, bodyWidth, "…", true)} ${this.theme.fg("border", "│")}`;
  }

  private renderBorder(width: number, kind: "top" | "middle" | "bottom"): string {
    const innerWidth = Math.max(1, width - 2);
    if (kind === "top") {
      return `${this.theme.fg("border", "┌")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┐")}`;
    }
    if (kind === "bottom") {
      return `${this.theme.fg("border", "└")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┘")}`;
    }
    return `${this.theme.fg("border", "├")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┤")}`;
  }
}

function getCommandOverlayOptions(columns: number, rows: number): OverlayOptions {
  return {
    anchor: "center",
    width: Math.max(MIN_OVERLAY_WIDTH, Math.min(columns - OVERLAY_INSET, 110)),
    maxHeight: Math.max(MIN_OVERLAY_HEIGHT, Math.min(rows - OVERLAY_INSET, 30)),
  };
}

function getScrollHintLabel(): string {
  return process.platform === "darwin" ? "Fn+↑/Fn+↓" : "PgUp/PgDn";
}

function wrapSection(text: string, width: number, theme: Theme): string[] {
  if (!text) return [" ".repeat(width)];

  const lines = text
    .split("\n")
    .flatMap((line: string) => {
      const wrapped = wrapTextWithAnsi(line, width);
      return wrapped.length > 0 ? wrapped : [theme.fg("muted", "")];
    });

  return lines.map((line: string) => truncateToWidth(line, width, "…", true));
}
