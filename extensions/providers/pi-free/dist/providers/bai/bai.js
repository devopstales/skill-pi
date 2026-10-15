/**
 * B.AI Provider Extension
 *
 * B.AI (https://b.ai) is an OpenAI-compatible LLM gateway providing access
 * to many models (OpenAI, Anthropic, Google, DeepSeek, Qwen, GLM, Kimi).
 *
 * API: https://api.b.ai/v1
 * Models: /v1/models
 * Chat: /v1/chat/completions
 *
 * Pricing is not exposed via the /v1/models endpoint, so all models
 * default to cost=0. The `isFreeModel` Route B detection (name contains
 * "free") is therefore used. As a result, with `free_only: true` no b.ai
 * models will be visible until you run `/toggle-bai` to enable paid models.
 *
 * A small set of known-promotional models are hardcoded as known-free so
 * they remain visible even when free-only mode is on (mirrors the
 * TokenRouter approach for `MiniMax-M3`).
 *
 * Setup:
 *   BAI_API_KEY=sk-...
 *   # or add bai_api_key to ~/.pi/free.json
 */
import { getBaiApiKey, getBaiShowPaid, applyHidden } from "../../config.js";
import { BASE_URL_BAI, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_BAI, } from "../../constants.js";
import { createLogger } from "../../lib/logger.js";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.js";
import { getProxyModelCompat, isLikelyReasoningModel, } from "../../lib/provider-compat.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { cleanModelName, fetchWithRetry, withSignal } from "../../lib/util.js";
import { baiAuth } from "./bai-auth.js";
const _logger = createLogger("bai");
// =============================================================================
// Known Free Models
// B.AI doesn't expose pricing via /v1/models, so known-free models are
// detected by name suffix. Catches `:free`-tagged models the gateway
// advertises as promotional.
// =============================================================================
function isBaiKnownFree(modelId) {
    return modelId.toLowerCase().endsWith(":free");
}
/**
 * Models B.AI's official pricing page documents as FREE on the API.
 *
 * Source: https://docs.b.ai/llmservice/pricing-and-usage/
 * Verified live against https://api.b.ai/v1/models on 2026-08-26 — all three
 * ids were present in the authenticated catalog.
 *
 * CAVEAT: the page's wording is time-limited promotion semantics —
 *   - deepseek-v4-flash: "currently free on B.AI Chat and API"
 *   - deepseek-v4-flash-vision-exp: "currently free for B.AI API use"
 *   - mimo-v2.5: "API usage currently free"
 * REVISIT: re-check the pricing page periodically (first check added
 * 2026-08-26) and remove any id whose free window has ended.
 */
export const BAI_DOCUMENTED_FREE_MODEL_IDS = new Set([
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "mimo-v2.5",
]);
// =============================================================================
// Helpers
// =============================================================================
/** Text-capable chat endpoints (excludes image/video/audio-only types) */
const CHAT_ENDPOINT_TYPES = new Set([
    "openai",
    "openai-response",
    "anthropic",
    "anthropic-compatible",
    "gemini",
]);
function isTextChatModel(model) {
    const endpoints = model.supported_endpoint_types ?? [];
    if (endpoints.length === 0) {
        // No endpoint info — assume text chat (matches TokenRouter fallback)
        return true;
    }
    return endpoints.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}
export function mapBaiModel(model) {
    const name = cleanModelName(model.id);
    const reasoning = isLikelyReasoningModel({ id: model.id, name });
    const isKnownFree = isBaiKnownFree(model.id) || BAI_DOCUMENTED_FREE_MODEL_IDS.has(model.id);
    return {
        id: model.id,
        name,
        reasoning,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
        compat: getProxyModelCompat({ id: model.id, name }),
        // Known-free models bypass name-based detection entirely
        _freeKnown: isKnownFree,
        _isFree: isKnownFree,
        // Non-free models signal no pricing data (name-based detection only)
        _pricingKnown: false,
    };
}
// =============================================================================
// Fetch Models
// =============================================================================
async function fetchBaiModels(apiKey, signal) {
    _logger.info("[bai] Fetching models from B.AI API...");
    try {
        const response = await fetchWithRetry(`${BASE_URL_BAI}/models`, withSignal({
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
        }, signal), 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
        if (!response.ok) {
            throw new Error(`B.AI API error: ${response.status}`);
        }
        const json = (await response.json());
        const models = (json.data ?? []).filter(isTextChatModel);
        _logger.info(`[bai] Fetched ${models.length} text chat models`);
        const enriched = await safeEnrichModelsWithModelsDev(models.map(mapBaiModel), { providerId: PROVIDER_BAI });
        return applyHidden(enriched, PROVIDER_BAI);
    }
    catch (error) {
        // Pi may abort a superseded refresh; cancellation is not a provider error.
        if (signal?.aborted)
            return [];
        _logger.error("[bai] Failed to fetch models", {
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}
// =============================================================================
// Native Provider Entry Point
// =============================================================================
export default function baiProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_BAI,
        name: "B.AI",
        baseUrl: BASE_URL_BAI,
        auth: baiAuth,
        getApiKey: getBaiApiKey,
        getShowPaid: getBaiShowPaid,
        fetchModels: (apiKey, signal) => fetchBaiModels(apiKey, signal),
        tosUrl: "https://b.ai/",
    });
    return Promise.resolve();
}
//# sourceMappingURL=bai.js.map