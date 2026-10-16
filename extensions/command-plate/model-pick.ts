import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { fuzzyFilter, Key, matchesKey, parseKey } from "@earendil-works/pi-tui";
import { OverlayFrame } from "./overlay-frame.js";

export const ALL_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const THINKING_ROLES: Record<string, ThemeColor> = {
  off: "dim",
  minimal: "dim",
  low: "success",
  medium: "warning",
  high: "bashMode",
  xhigh: "error",
};

// ─────────────────────────────────────────────────────────────────────────────
// Enabled-model filtering
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderInfo {
  name: string;
  modelCount: number;
}

function getEnabledModelSet(cwd: string): Set<string> | undefined {
  const sm = SettingsManager.create(cwd);
  const patterns = sm.getEnabledModels();
  if (!patterns || patterns.length === 0) return undefined;
  return new Set(patterns.map((p) => p.toLowerCase()));
}

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

function isModelEnabled(
  provider: string,
  modelId: string,
  enabled: Set<string> | undefined,
): boolean {
  if (!enabled) return true;
  const key = `${provider}/${modelId}`.toLowerCase();
  if (enabled.has(key)) return true;
  for (const pattern of enabled) {
    if (pattern.includes("*") || pattern.includes("?")) {
      const regex = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      if (regex.test(key)) return true;
    }
  }
  return false;
}

function getAvailableEnabledModels(
  registry: ModelRegistry,
  cwd: string,
): Model<any>[] {
  const enabled = getEnabledModelSet(cwd);
  return registry.getAvailable().filter((m) => isModelEnabled(m.provider, m.id, enabled));
}

export function getProviders(ctx: ExtensionContext): ProviderInfo[] {
  const models = getAvailableEnabledModels(ctx.modelRegistry, ctx.cwd);
  const providerMap = new Map<string, number>();
  for (const model of models) {
    providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
  }
  return Array.from(providerMap.entries())
    .map(([name, count]) => ({ name, modelCount: count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getModelsForProvider(ctx: ExtensionContext, provider: string): Model<any>[] {
  return getAvailableEnabledModels(ctx.modelRegistry, ctx.cwd)
    .filter((m) => m.provider === provider)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Searchable select
// ─────────────────────────────────────────────────────────────────────────────

interface SearchableItem {
  value: string;
  label: string;
  description?: string;
}

const MAX_VISIBLE = 15;

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

// ─────────────────────────────────────────────────────────────────────────────
// Thinking level
// ─────────────────────────────────────────────────────────────────────────────

function buildThinkingItems(currentThinking: ModelThinkingLevel): SearchableItem[] {
  return ALL_THINKING_LEVELS.map((level) => {
    const isCurrent = level === currentThinking;
    return {
      value: level,
      label: isCurrent ? `${level} (current)` : level,
      description: getThinkingDescription(level),
    };
  });
}

export function getThinkingDescription(level: ModelThinkingLevel): string {
  switch (level) {
    case "off":
      return "No extended thinking";
    case "minimal":
      return "Minimal reasoning effort";
    case "low":
      return "Low reasoning effort";
    case "medium":
      return "Moderate reasoning effort";
    case "high":
      return "High reasoning effort";
    case "xhigh":
      return "Maximum reasoning effort";
    default:
      return "";
  }
}

export async function runThinkingPicker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) return;

  const currentThinking = pi.getThinkingLevel();

  const thinkingItems = buildThinkingItems(currentThinking);

  const choice = await searchableSelect<ModelThinkingLevel>(
    ctx,
    "Select Thinking Level",
    thinkingItems,
  );

  if (!choice) return;

  pi.setThinkingLevel(choice);
  ctx.ui.notify(`Thinking: ${choice}`, "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// Full model switcher (provider → model → thinking)
// ─────────────────────────────────────────────────────────────────────────────

export async function runModelSwitcher(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) return;

  const providers = getProviders(ctx);
  if (providers.length === 0) {
    ctx.ui.notify("No providers available", "warning");
    return;
  }

  const currentProvider = ctx.model?.provider;

  const providerItems: SearchableItem[] = providers.map((p) => {
    const isCurrent = p.name === currentProvider;
    const badge = isCurrent ? " (current)" : "";
    return {
      value: p.name,
      label: `${p.name}${badge}`,
      description: `${p.modelCount} model${p.modelCount !== 1 ? "s" : ""}`,
    };
  });

  const selectedProvider = await searchableSelect<string>(
    ctx,
    "Select Provider",
    providerItems,
  );
  if (!selectedProvider) return;

  const models = getModelsForProvider(ctx, selectedProvider);
  if (models.length === 0) {
    ctx.ui.notify(`No models found for provider "${selectedProvider}"`, "warning");
    return;
  }

  const currentModelId = ctx.model?.id;

  const modelItems: SearchableItem[] = models.map((model) => {
    const isCurrent = model.provider === currentProvider && model.id === currentModelId;
    const badge = isCurrent ? " (current)" : "";
    const features: string[] = [];
    if (model.reasoning) features.push("reasoning");
    if (model.input.includes("image")) features.push("vision");
    const desc = features.length > 0 ? features.join(", ") : "";

    return {
      value: model.id,
      label: `${model.name}${badge}`,
      description: desc,
    };
  });

  const selectedModelId = await searchableSelect<string>(
    ctx,
    `Select Model (${selectedProvider})`,
    modelItems,
  );
  if (!selectedModelId) return;

  const selectedModel = ctx.modelRegistry.find(selectedProvider, selectedModelId);
  if (!selectedModel) {
    ctx.ui.notify(`Model ${selectedProvider}/${selectedModelId} not found`, "error");
    return;
  }

  const supportsReasoning = selectedModel.reasoning;
  let selectedThinking: ModelThinkingLevel = pi.getThinkingLevel();

  if (supportsReasoning) {
    const thinkingItems = buildThinkingItems(pi.getThinkingLevel());

    const thinkingChoice = await searchableSelect<ModelThinkingLevel>(
      ctx,
      `Thinking Level (${selectedModel.name})`,
      thinkingItems,
      "type to search • ↑↓ navigate • enter select • esc cancel",
    );

    if (!thinkingChoice) return;
    selectedThinking = thinkingChoice;
  }

  const ok = await pi.setModel(selectedModel);
  if (!ok) {
    ctx.ui.notify(`No API key available for ${selectedProvider}/${selectedModelId}`, "warning");
    return;
  }

  if (supportsReasoning) {
    pi.setThinkingLevel(selectedThinking);
  }

  ctx.ui.notify(
    `Switched to ${selectedModel.name}${supportsReasoning ? ` (thinking: ${selectedThinking})` : ""}`,
    "info",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped models picker (enabledModels scope + thinking cycling)
// ─────────────────────────────────────────────────────────────────────────────

interface ScopedModelEntry {
  label: string;
  provider: string;
  model: string;
  thinking?: ModelThinkingLevel;
}

interface ModelRow {
  type: "model";
  entry: ScopedModelEntry;
  modelIndex: number;
}

interface HeaderRow {
  type: "header";
  provider: string;
  count: number;
}

type DisplayRow = ModelRow | HeaderRow;

function buildDisplayRows(entries: ScopedModelEntry[]): DisplayRow[] {
  const sorted = entries
    .map((e, i) => ({ ...e, originalIndex: i }))
    .sort((a, b) => {
      const pc = a.provider.localeCompare(b.provider);
      if (pc !== 0) return pc;
      return a.label.localeCompare(b.label);
    });

  const rows: DisplayRow[] = [];
  let lastProvider = "";
  let providerCount = 0;
  let providerStart = 0;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.provider !== lastProvider) {
      if (lastProvider) {
        rows[providerStart] = { type: "header", provider: lastProvider, count: providerCount };
      }
      rows.push({ type: "header", provider: item.provider, count: 0 });
      providerStart = rows.length - 1;
      providerCount = 0;
      lastProvider = item.provider;
    }
    rows.push({ type: "model", entry: item, modelIndex: item.originalIndex });
    providerCount++;
  }
  if (lastProvider) {
    rows[providerStart] = { type: "header", provider: lastProvider, count: providerCount };
  }

  return rows;
}

function nextModelRow(rows: DisplayRow[], from: number, dir: -1 | 1): number {
  let i = from + dir;
  while (i >= 0 && i < rows.length) {
    if (rows[i].type === "model") return i;
    i += dir;
  }
  return from;
}

function nthModelRow(rows: DisplayRow[], n: number): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "model") {
      if (count === n) return i;
      count++;
    }
  }
  return -1;
}

const THINKING_SHORTCUTS: Record<string, ModelThinkingLevel> = {
  o: "off",
  i: "minimal",
  l: "low",
  m: "medium",
  h: "high",
  x: "xhigh",
};

function getPrintableKey(data: string): string | null {
  const parsed = parseKey(data);
  if (parsed && parsed.length === 1 && parsed >= " " && parsed <= "~") {
    return parsed.toLowerCase();
  }
  if (data.length === 1 && data >= " " && data <= "~") {
    return data.toLowerCase();
  }
  return null;
}

function isThinkingLevel(value: string | undefined): value is ModelThinkingLevel {
  return !!value && (ALL_THINKING_LEVELS as string[]).includes(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    "^" + escapeRegExp(pattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$",
    "i",
  );
}

function findExactModelReferenceMatch(
  modelReference: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const slashIndex = modelReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = modelReference.substring(0, slashIndex).toLowerCase();
    const modelId = modelReference.substring(slashIndex + 1).toLowerCase();
    return availableModels.find(
      (model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === modelId,
    );
  }

  const matches = availableModels.filter(
    (model) => model.id.toLowerCase() === modelReference.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function sortAllAvailableModels(
  availableModels: Model<any>[],
  currentModel: Model<any> | undefined,
): Model<any>[] {
  return [...availableModels].sort((a, b) => {
    const aIsCurrent = currentModel?.provider === a.provider && currentModel?.id === a.id;
    const bIsCurrent = currentModel?.provider === b.provider && currentModel?.id === b.id;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;

    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return a.name.localeCompare(b.name);
  });
}

function toEntry(model: Model<any>, thinking?: ModelThinkingLevel): ScopedModelEntry {
  return {
    label: model.name,
    provider: model.provider,
    model: model.id,
    thinking,
  };
}

export function loadScopedModels(ctx: ExtensionContext): ScopedModelEntry[] {
  const settings = SettingsManager.create(ctx.cwd);
  const patterns = settings.getEnabledModels();
  const availableModels = ctx.modelRegistry.getAvailable();

  if (!patterns || patterns.length === 0) {
    return sortAllAvailableModels(availableModels, ctx.model).map((model) => toEntry(model));
  }

  const resolved: ScopedModelEntry[] = [];
  const seen = new Set<string>();

  const pushModel = (model: Model<any>, thinking?: ModelThinkingLevel) => {
    const key = `${model.provider}/${model.id}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    resolved.push(toEntry(model, thinking));
  };

  for (const rawPattern of patterns) {
    const exactFullMatch = findExactModelReferenceMatch(rawPattern, availableModels);
    if (exactFullMatch) {
      pushModel(exactFullMatch);
      continue;
    }

    let pattern = rawPattern;
    let thinking: ModelThinkingLevel | undefined;
    const colonIndex = rawPattern.lastIndexOf(":");
    if (colonIndex !== -1) {
      const maybeThinking = rawPattern.substring(colonIndex + 1);
      if (isThinkingLevel(maybeThinking)) {
        thinking = maybeThinking;
        pattern = rawPattern.substring(0, colonIndex);
      }
    }

    const exactMatch = findExactModelReferenceMatch(pattern, availableModels);
    if (exactMatch) {
      pushModel(exactMatch, thinking);
      continue;
    }

    const matcher = globToRegExp(pattern);
    const matchingModels = availableModels.filter((model) => {
      const fullId = `${model.provider}/${model.id}`;
      return matcher.test(fullId) || matcher.test(model.id);
    });

    for (const model of matchingModels) {
      pushModel(model, thinking);
    }
  }

  return resolved;
}

interface PickerResult {
  entry: ScopedModelEntry;
  thinking: ModelThinkingLevel;
}

export async function runScopedModels(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) return;

  const scoped = loadScopedModels(ctx);
  if (scoped.length === 0) {
    ctx.ui.notify("No scoped models available. Configure API keys or enabledModels", "warning");
    return;
  }

  const currentModel = ctx.model;
  const currentThinking = pi.getThinkingLevel();

  const thinkingIndices: number[] = scoped.map((entry) => {
    const idx = entry.thinking ? ALL_THINKING_LEVELS.indexOf(entry.thinking) : -1;
    return idx >= 0 ? idx : ALL_THINKING_LEVELS.indexOf(currentThinking);
  });

  const rows = buildDisplayRows(scoped);
  const firstModelRow = rows.findIndex((r) => r.type === "model");

  const selected = await ctx.ui.custom<PickerResult | null>(
    (tui, theme, _kb, done) => {
      let highlightedIndex = firstModelRow >= 0 ? firstModelRow : 0;
      const th = theme;

      const getModelIndex = (): number => {
        const row = rows[highlightedIndex];
        return row?.type === "model" ? row.modelIndex : -1;
      };

      return {
        render: (width: number) => {
          const f = new OverlayFrame(width, th);
          const lines: string[] = [];

          lines.push(f.top());
          lines.push(f.row(th.fg("accent", th.bold("Scoped Models"))));
          lines.push(f.separator());

          let modelCounter = 0;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.type === "header") {
              const headerText = ` ${row.provider} ${row.count > 0 ? `(${row.count})` : ""} `;
              const padded = headerText.padEnd(width - 4, "─");
              lines.push(f.row(th.fg("dim", `──${padded}`)));
              continue;
            }

            const entry = row.entry;
            const isHighlighted = i === highlightedIndex;
            const mi = row.modelIndex;

            const isCurrent =
              currentModel?.provider === entry.provider && currentModel?.id === entry.model;

            const currentBadge = isCurrent ? " " + th.fg("success", "●") : "";

            const thinking = ALL_THINKING_LEVELS[thinkingIndices[mi]];
            const thinkingRole = THINKING_ROLES[thinking] ?? "dim";
            const thinkingTag = isHighlighted
              ? th.fg("dim", "‹") + th.fg(thinkingRole, ` ${thinking} `) + th.fg("dim", "›")
              : th.fg(thinkingRole, thinking);

            const line = `${isHighlighted ? "> " : "  "}${itemNumber(th, modelCounter)} ${highlightItemLabel(th, entry.label, isHighlighted)}${currentBadge}  ${thinkingTag}`;
            lines.push(f.rowTruncated(line));
            modelCounter++;
          }

          lines.push(f.separator());
          lines.push(f.row(th.fg("dim", "j/k navigate | 1-9 jump | left/right cycle thinking")));
          lines.push(f.row(th.fg("dim", "o/i/l/m/h/x set thinking | enter select | esc cancel")));
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
            done(null);
            return;
          }

          const key = getPrintableKey(data);

          if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p")) || key === "k") {
            highlightedIndex = nextModelRow(rows, highlightedIndex, -1);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n")) || key === "j") {
            highlightedIndex = nextModelRow(rows, highlightedIndex, 1);
            tui.requestRender();
            return;
          }

          if (matchesKey(data, "left")) {
            const mi = getModelIndex();
            if (mi >= 0) {
              thinkingIndices[mi] =
                (thinkingIndices[mi] - 1 + ALL_THINKING_LEVELS.length) % ALL_THINKING_LEVELS.length;
              tui.requestRender();
            }
            return;
          }
          if (matchesKey(data, "right")) {
            const mi = getModelIndex();
            if (mi >= 0) {
              thinkingIndices[mi] = (thinkingIndices[mi] + 1) % ALL_THINKING_LEVELS.length;
              tui.requestRender();
            }
            return;
          }

          if (key) {
            const num = parseInt(key, 10);
            const modelCount = rows.filter((r) => r.type === "model").length;
            if (num >= 1 && num <= Math.min(9, modelCount)) {
              const target = nthModelRow(rows, num - 1);
              if (target >= 0) highlightedIndex = target;
              tui.requestRender();
              return;
            }
          }

          if (key) {
            const shortcutThinking = THINKING_SHORTCUTS[key];
            if (shortcutThinking) {
              const mi = getModelIndex();
              if (mi >= 0) {
                thinkingIndices[mi] = ALL_THINKING_LEVELS.indexOf(shortcutThinking);
                tui.requestRender();
              }
              return;
            }
          }

          if (matchesKey(data, "enter")) {
            const row = rows[highlightedIndex];
            if (row?.type === "model") {
              done({
                entry: row.entry,
                thinking: ALL_THINKING_LEVELS[thinkingIndices[row.modelIndex]],
              });
            }
          }
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

  if (!selected) return;

  const modelInfo = ctx.modelRegistry.find(selected.entry.provider, selected.entry.model);
  if (!modelInfo) {
    ctx.ui.notify(`Model ${selected.entry.provider}/${selected.entry.model} not found in registry`, "error");
    return;
  }

  const ok = await pi.setModel(modelInfo);
  if (!ok) {
    ctx.ui.notify(`No API key available for ${selected.entry.provider}/${selected.entry.model}`, "warning");
    return;
  }
  pi.setThinkingLevel(selected.thinking);

  ctx.ui.notify(
    `Switched to ${selected.entry.label} (thinking: ${selected.thinking})`,
    "info",
  );
}
