/**
 * AnyAPI provider extension.
 *
 * AnyAPI is an OpenAI-compatible gateway with a free plan and a catalog of
 * explicitly free models. It exposes the catalog at /v1/models and routes
 * chat requests through /v1/chat/completions.
 *
 * Setup:
 *   ANYAPI_API_KEY=...
 *   # or add anyapi_api_key to ~/.pi/free.json
 */
import { applyHidden, getAnyapiApiKey, getAnyapiShowPaid, } from "../../config.js";
import { BASE_URL_ANYAPI, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_ANYAPI, } from "../../constants.js";
import { createLogger } from "../../lib/logger.js";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.js";
import { fetchWithRetry, mapOpenRouterModel, withSignal, } from "../../lib/util.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { anyapiAuth } from "./anyapi-auth.js";
const _logger = createLogger("anyapi");
const ANYAPI_METADATA_VERSION = 1;
function hasPricing(model) {
    return ((model.pricing?.prompt !== null && model.pricing?.prompt !== undefined) ||
        (model.pricing?.completion !== null &&
            model.pricing?.completion !== undefined) ||
        (model.pricing?.input_cache_read !== null &&
            model.pricing?.input_cache_read !== undefined) ||
        (model.pricing?.input_cache_write !== null &&
            model.pricing?.input_cache_write !== undefined));
}
function normalizePrice(value) {
    return value === null || value === undefined ? null : String(value);
}
/**
 * Detect AnyAPI's explicitly free model labels without treating every model
 * with omitted pricing as free. The API may also expose an authoritative flag
 * or zero pricing, both of which are handled here.
 */
export function isAnyApiFreeModel(model) {
    if (typeof model.isFree === "boolean")
        return model.isFree;
    const label = `${model.id} ${model.name ?? ""}`.toLowerCase();
    if (/\bfree\b/.test(label))
        return true;
    if (!hasPricing(model))
        return false;
    const input = Number(model.pricing?.prompt);
    const output = Number(model.pricing?.completion);
    return input === 0 && output === 0;
}
export function mapAnyApiModel(model) {
    const name = model.name ?? model.id;
    const pricingKnown = hasPricing(model);
    const freeKnown = typeof model.isFree === "boolean" ||
        /\bfree\b/i.test(`${model.id} ${name}`) ||
        (pricingKnown && isAnyApiFreeModel(model));
    const tags = model.tags ?? [];
    const supportsReasoning = tags.includes("reasoning") || tags.includes("chat_completions:reasoning");
    const supportsVision = tags.includes("vision") || tags.includes("chat_completions:vision");
    const mapped = mapOpenRouterModel({
        ...model,
        name,
        supported_parameters: model.supported_parameters ?? (supportsReasoning ? ["reasoning"] : []),
        architecture: model.architecture ?? {
            input_modalities: supportsVision ? ["text", "image"] : ["text"],
            output_modalities: ["text"],
        },
        pricing: model.pricing
            ? {
                prompt: normalizePrice(model.pricing.prompt),
                completion: normalizePrice(model.pricing.completion),
                input_cache_read: normalizePrice(model.pricing.input_cache_read),
                input_cache_write: normalizePrice(model.pricing.input_cache_write),
            }
            : undefined,
    });
    return {
        ...mapped,
        _pricingKnown: pricingKnown,
        ...(freeKnown && {
            _freeKnown: true,
            _isFree: isAnyApiFreeModel(model),
        }),
    };
}
function isTextModel(model) {
    const outputModalities = model.architecture?.output_modalities ?? [];
    if (outputModalities.length > 0 && !outputModalities.includes("text")) {
        return false;
    }
    const tags = model.tags;
    if (!tags || tags.length === 0)
        return true;
    return tags.some((tag) => tag.startsWith("chat_completions:"));
}
async function fetchAnyApiModels(apiKey, signal) {
    const response = await fetchWithRetry(`${BASE_URL_ANYAPI}/models`, withSignal({
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
    }, signal), 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok) {
        throw new Error(`AnyAPI API error: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json());
    const models = (json.data ?? []).flatMap((model) => {
        if (!model.id || !isTextModel(model))
            return [];
        return [mapAnyApiModel(model)];
    });
    _logger.info(`[anyapi] Fetched ${models.length} text models`);
    // AnyAPI's /models response omits context and output limits for its
    // catalog. Use the global models.dev catalog so canonical model IDs such
    // as qwen/qwen3-coder:free do not fall back to the generic 4096-token
    // defaults in mapOpenRouterModel. The AnyAPI-scoped models.dev entry only
    // contains a small paid subset and does not cover the free catalog.
    const enriched = await safeEnrichModelsWithModelsDev(models);
    return applyHidden(enriched.map((model) => ({
        ...model,
        _anyapiMetadataVersion: ANYAPI_METADATA_VERSION,
    })), PROVIDER_ANYAPI);
}
export default function anyapiProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_ANYAPI,
        name: "AnyAPI",
        baseUrl: BASE_URL_ANYAPI,
        auth: anyapiAuth,
        getApiKey: getAnyapiApiKey,
        getShowPaid: getAnyapiShowPaid,
        fetchModels: (apiKey, signal) => fetchAnyApiModels(apiKey, signal),
        tosUrl: "https://anyapi.ai/terms-of-service",
        suppressTosWhenKey: true,
    });
    return Promise.resolve();
}
//# sourceMappingURL=anyapi.js.map