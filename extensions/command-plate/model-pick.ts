import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { searchableSelect } from "./searchable-select.js";
import type { SearchableItem } from "./searchable-select.js";
import { buildThinkingItems } from "./thinking-picker.js";

export const ALL_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export * from "./searchable-select.js";
export * from "./thinking-picker.js";
export * from "./scoped-models.js";

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
