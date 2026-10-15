import { applyHidden } from "../../config.js";
import { BASE_URL_ZENMUX, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_ZENMUX, } from "../../constants.js";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.js";
import { withGatewayCompat } from "../../lib/native-provider.js";
import { getProxyModelCompat } from "../../lib/provider-compat.js";
import { isFreeModel } from "../../lib/registry.js";
import { fetchWithRetry, withSignal } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";
const _logger = createLogger("zenmux-models");
/** Extract ZenMux's per-million-token price as a per-token Pi cost. */
function extractZenmuxPrice(pricings, key) {
    const entries = pricings?.[key];
    if (!entries || entries.length === 0)
        return 0;
    // Length check above proves defined.
    return (entries[0].value ?? 0) / 1_000_000;
}
/**
 * Whether a catalog entry can produce chat text. ZenMux lists image/video
 * generation, speech/transcription, embeddings and rerank endpoints alongside
 * chat models; only text-output entries belong in the model picker. Entries
 * with no `output_modalities` are kept (older/partial rows) to avoid
 * over-filtering — the same rule the shared OpenRouter-compatible fetcher
 * applies.
 */
function isChatModel(model) {
    const outputModalities = model.output_modalities ?? [];
    return outputModalities.length === 0 || outputModalities.includes("text");
}
/**
 * Fetch and convert the ZenMux catalog. The catalog endpoint is public, so a
 * missing token fetches anonymously (no Authorization header); a configured
 * token is sent when present.
 */
export async function fetchZenmuxCatalog(options) {
    if (options.signal?.aborted) {
        return { all: [], free: [] };
    }
    try {
        const response = await fetchWithRetry(`${BASE_URL_ZENMUX}/models`, withSignal({
            headers: {
                ...(options.token && {
                    Authorization: `Bearer ${options.token}`,
                }),
                "Content-Type": "application/json",
            },
        }, options.signal), 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
        if (!response.ok) {
            throw new Error(`ZenMux API error: ${response.status}`);
        }
        const data = (await response.json());
        // Chat entries only; see isChatModel.
        const chatModels = (data.data ?? []).filter(isChatModel);
        const mapped = chatModels.map((model) => {
            const hasPricings = model.pricings !== undefined;
            return {
                id: model.id,
                name: model.display_name || model.id,
                reasoning: model.capabilities?.reasoning ?? false,
                input: model.input_modalities?.includes("image")
                    ? ["text", "image"]
                    : ["text"],
                cost: {
                    input: extractZenmuxPrice(model.pricings, "prompt"),
                    output: extractZenmuxPrice(model.pricings, "completion"),
                    cacheRead: extractZenmuxPrice(model.pricings, "input_cache_read"),
                    cacheWrite: 0,
                },
                contextWindow: model.context_length || 128000,
                maxTokens: model.context_length
                    ? Math.floor(model.context_length / 2)
                    : 4096,
                compat: getProxyModelCompat(model),
                _pricingKnown: hasPricings,
            };
        });
        const visible = applyHidden(mapped, PROVIDER_ZENMUX);
        const all = await safeEnrichModelsWithModelsDev(visible, {
            providerId: PROVIDER_ZENMUX,
        });
        const free = all.filter((model) => isFreeModel({ ...model, provider: PROVIDER_ZENMUX }, all));
        return { all, free };
    }
    catch (error) {
        // Pi may abort a superseded refresh; cancellation is not a provider error.
        if (options.signal?.aborted) {
            return { all: [], free: [] };
        }
        _logger.error("Failed to fetch ZenMux models", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { all: [], free: [] };
    }
}
function toZenmuxModel(model) {
    return withGatewayCompat({
        ...model,
        api: "openai-completions",
        provider: PROVIDER_ZENMUX,
        baseUrl: model.baseUrl ?? BASE_URL_ZENMUX,
    });
}
export function toZenmuxModels(models) {
    return models.map(toZenmuxModel);
}
//# sourceMappingURL=zenmux-models.js.map