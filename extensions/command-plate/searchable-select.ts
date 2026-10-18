import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Key, matchesKey } from "@earendil-works/pi-tui";
import { OverlayFrame } from "./overlay-frame.js";

export interface SearchableItem {
  value: string;
  label: string;
  description?: string;
}

const MAX_VISIBLE = 15;

export function resolveScrollOffset(
  highlightedIndex: number,
  scrollOffset: number,
  maxVisible: number,
  itemCount: number,
): number {
  let offset = scrollOffset;
  if (highlightedIndex < offset) {
    offset = highlightedIndex;
  } else if (highlightedIndex >= offset + maxVisible) {
    offset = highlightedIndex - maxVisible + 1;
  }
  return offset;
}

export function highlightItemLabel(theme: Theme, label: string, highlighted: boolean): string {
  return highlighted ? theme.fg("accent", theme.bold(label)) : theme.fg("text", label);
}

export function itemNumber(theme: Theme, modelIndex: number): string {
  return modelIndex < 9 ? theme.fg("dim", `${modelIndex + 1}`) : theme.fg("dim", "·");
}

export function renderSearchWindow<T>(options: {
  frame: OverlayFrame;
  theme: Theme;
  items: T[];
  highlightedIndex: number;
  scrollOffset: number;
  maxVisible?: number;
  renderRow: (item: T, isHighlighted: boolean, modelIndex: number) => string;
}): string[] {
  const { frame, theme: th, items, highlightedIndex, scrollOffset, maxVisible = MAX_VISIBLE, renderRow } = options;
  const lines: string[] = [];
  const visibleEnd = Math.min(scrollOffset + maxVisible, items.length);

  if (items.length === 0) {
    lines.push(frame.row(th.fg("warning", "  no matches")));
    return lines;
  }

  if (scrollOffset > 0) {
    lines.push(frame.row(th.fg("dim", `  ↑ ${scrollOffset} more`)));
  }

  for (let i = scrollOffset; i < visibleEnd; i++) {
    const isHighlighted = i === highlightedIndex;
    lines.push(frame.rowTruncated(renderRow(items[i], isHighlighted, i)));
  }

  const remaining = items.length - visibleEnd;
  if (remaining > 0) {
    lines.push(frame.row(th.fg("dim", `  ↓ ${remaining} more`)));
  }

  return lines;
}

export async function searchableSelect<T extends string>(
  ctx: ExtensionContext,
  title: string,
  items: SearchableItem[],
  helpText?: string,
  defaultValue?: string,
): Promise<T | null> {
  const defaultIndex = defaultValue ? items.findIndex((i) => i.value === defaultValue) : -1;
  return ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
    let searchText = "";
    let filteredItems = [...items];
    let highlightedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    let scrollOffset = 0;

    const th = theme;

    const applyFilter = () => {
      if (searchText === "") {
        filteredItems = [...items];
      } else {
        filteredItems = fuzzyFilter(items, searchText, (item) => `${item.label} ${item.value}`);
      }
      highlightedIndex = 0;
      scrollOffset = 0;
    };

    const ensureVisible = () => {
      scrollOffset = resolveScrollOffset(highlightedIndex, scrollOffset, MAX_VISIBLE, filteredItems.length);
    };

    return {
      render: (width: number) => {
        const f = new OverlayFrame(width, th);
        const lines: string[] = [];

        lines.push(f.top());
        lines.push(f.row(th.fg("accent", th.bold(title))));

        if (searchText.length > 0) {
          lines.push(
            f.row(th.fg("muted", "search: ") + th.fg("accent", searchText) + th.fg("dim", "▏")),
          );
        }

        lines.push(f.separator());

        lines.push(
          ...renderSearchWindow<SearchableItem>({
            frame: f,
            theme: th,
            items: filteredItems,
            highlightedIndex,
            scrollOffset,
            renderRow: (item, isHighlighted) => {
              let line = `${isHighlighted ? "> " : "  "}${highlightItemLabel(th, item.label, isHighlighted)}`;
              if (item.description) {
                line += "  " + th.fg("dim", item.description);
              }
              return line;
            },
          }),
        );

        lines.push(f.separator());
        const hint = helpText ?? "type to search • ↑↓ navigate • enter select • esc cancel";
        lines.push(f.row(th.fg("dim", hint)));
        lines.push(f.bottom());

        return lines;
      },
      invalidate: () => {},
      handleInput: (data: string) => {
        if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
          done(null);
          return;
        }

        if (matchesKey(data, "backspace")) {
          if (searchText.length > 0) {
            searchText = searchText.slice(0, -1);
            applyFilter();
            tui.requestRender();
          }
          return;
        }

        if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p"))) {
          highlightedIndex = Math.max(0, highlightedIndex - 1);
          ensureVisible();
          tui.requestRender();
          return;
        }
        if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n"))) {
          highlightedIndex = Math.min(filteredItems.length - 1, highlightedIndex + 1);
          ensureVisible();
          tui.requestRender();
          return;
        }

        if (matchesKey(data, "enter")) {
          if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
            done(filteredItems[highlightedIndex].value as T);
          }
          return;
        }

        if (data.length === 1 && data >= " " && data <= "~") {
          searchText += data;
          applyFilter();
          tui.requestRender();
          return;
        }
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: 80,
      minWidth: 50,
      maxHeight: "80%",
    },
  });
}
