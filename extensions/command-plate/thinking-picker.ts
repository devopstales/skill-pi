import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ALL_THINKING_LEVELS } from "./model-pick.js";
import { searchableSelect } from "./searchable-select.js";
import type { SearchableItem } from "./searchable-select.js";

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

export function buildThinkingItems(currentThinking: ModelThinkingLevel): SearchableItem[] {
  return ALL_THINKING_LEVELS.map((level) => {
    const isCurrent = level === currentThinking;
    return {
      value: level,
      label: isCurrent ? `${level} (current)` : level,
      description: getThinkingDescription(level),
    };
  });
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
