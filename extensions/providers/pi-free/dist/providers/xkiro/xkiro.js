/**
 * Xkiro provider extension.
 *
 * Xkiro (https://xkiro.com) is an OpenAI-compatible gateway. It exposes the
 * catalog at /v1/models and routes chat requests through
 * /v1/chat/completions.
 *
 * The catalog carries an authoritative `access_tier` per model ("free",
 * "paid", "premium") plus `capabilities` ({ vision, tools, reasoning }),
 * `context_length`, and `max_output_tokens`. Prices are quoted per million
 * tokens and are converted to per-token costs for the pi model record.
 * Free models include `deepseek/deepseek-v4.1-flash:free`,
 * `qwen/qwen3.5-397b-a17b:free`, and the `minimax/*:free` family.
 *
 * Note: catalog pricing is not the whole access story — the gateway can
 * paywall individual models per key/plan server-side (observed with a trial
 * key on paid entries), so chat failures on paid models are expected
 * without a funded plan.
 *
 * Setup:
 *   XKIRO_API_KEY=sk-xt-...
 *   # or add xkiro_api_key to ~/.pi/free.json
 */
import { applyHidden, getXkiroApiKey, getXkiroShowPaid } from "../../config.js";
import { BASE_URL_XKIRO, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_XKIRO, } from "../../constants.js";
import { createLogger } from "../../lib/logger.js";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.js";
import { getProxyModelCompat, isLikelyReasoningModel, } from "../../lib/provider-compat.js";
import { cleanModelName, fetchWithRetry, withSignal } from "../../lib/util.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { xkiroAuth } from "./xkiro-auth.js";
const _logger = createLogger("xkiro");
const XKIRO_METADATA_VERSION = 1;
/** Xkiro quotes prices per million tokens; pi records per-token costs. */
const XKIRO_PRICE_DIVISOR = 1_000_000;
function hasPricing(model) {
    const pricing = model.pricing;
    if (!pricing)
        return false;
    return ((pricing.input !== null && pricing.input !== undefined) ||
        (pricing.output !== null && pricing.output !== undefined) ||
        (pricing.cache_read !== null && pricing.cache_read !== undefined) ||
        (pricing.cache_write !== null && pricing.cache_write !== undefined));
}
/**
 * Detect Xkiro's free models. The catalog's `access_tier` is authoritative;
 * the `-free` label and zero pricing are fallbacks for entries that omit it.
 */
export function isXkiroFreeModel(model) {
    if (model.access_tier === "free")
        return true;
    if (model.access_tier === "paid" ||
        model.access_tier === "premium" ||
        model.access_tier === "enterprise") {
        return false;
    }
    const label = `${model.id} ${model.display_name ?? ""}`.toLowerCase();
    if (/\bfree\b/.test(label))
        return true;
    if (!hasPricing(model))
        return false;
    return (Number(model.pricing?.input ?? NaN) === 0 &&
        Number(model.pricing?.output ?? NaN) === 0);
}
function isTextChatModel(model) {
    if (!model.id)
        return false;
    if (model.modality !== undefined &&
        model.modality !== null &&
        model.modality !== "chat") {
        return false;
    }
    return true;
}
export function mapXkiroModel(model) {
    const name = cleanModelName(model.display_name ?? model.id);
    const pricingKnown = hasPricing(model);
    const freeKnown = model.access_tier === "free" ||
        model.access_tier === "paid" ||
        model.access_tier === "premium" ||
        model.access_tier === "enterprise" ||
        /\bfree\b/i.test(`${model.id} ${model.display_name ?? ""}`) ||
        (pricingKnown && isXkiroFreeModel(model));
    const reasoning = model.capabilities?.reasoning === true ||
        isLikelyReasoningModel({ id: model.id, name });
    const vision = model.capabilities?.vision === true;
    return {
        id: model.id,
        name,
        reasoning,
        ...(reasoning && { thinkingLevelMap: { off: "none" } }),
        input: vision ? ["text", "image"] : ["text"],
        cost: {
            input: (model.pricing?.input ?? 0) / XKIRO_PRICE_DIVISOR,
            output: (model.pricing?.output ?? 0) / XKIRO_PRICE_DIVISOR,
            cacheRead: (model.pricing?.cache_read ?? 0) / XKIRO_PRICE_DIVISOR,
            cacheWrite: (model.pricing?.cache_write ?? 0) / XKIRO_PRICE_DIVISOR,
        },
        contextWindow: model.context_length ?? 4096,
        maxTokens: model.max_output_tokens ?? 4096,
        compat: getProxyModelCompat({ id: model.id, name }),
        _pricingKnown: pricingKnown,
        ...(freeKnown && {
            _freeKnown: true,
            _isFree: isXkiroFreeModel(model),
        }),
    };
}
async function fetchXkiroModels(apiKey, signal) {
    const response = await fetchWithRetry(`${BASE_URL_XKIRO}/models`, withSignal({
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
    }, signal), 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok) {
        throw new Error(`Xkiro API error: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json());
    const models = (json.data ?? []).flatMap((model) => {
        if (!isTextChatModel(model))
            return [];
        return [mapXkiroModel(model)];
    });
    _logger.info(`[xkiro] Fetched ${models.length} text models`);
    const enriched = await safeEnrichModelsWithModelsDev(models);
    return applyHidden(enriched.map((model) => ({
        ...model,
        _xkiroMetadataVersion: XKIRO_METADATA_VERSION,
    })), PROVIDER_XKIRO);
}
export default function xkiroProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_XKIRO,
        name: "Xkiro",
        baseUrl: BASE_URL_XKIRO,
        auth: xkiroAuth,
        getApiKey: getXkiroApiKey,
        getShowPaid: getXkiroShowPaid,
        fetchModels: (apiKey, signal) => fetchXkiroModels(apiKey, signal),
        tosUrl: "https://xkiro.com/terms",
        suppressTosWhenKey: true,
    });
    return Promise.resolve();
}
//# sourceMappingURL=xkiro.js.map