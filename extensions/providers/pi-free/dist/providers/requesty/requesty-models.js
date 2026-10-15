/**
 * Requesty's public model catalog (router.requesty.ai/v1/models).
 *
 * The schema is Requesty-specific — flat `input_price`/`output_price` numbers,
 * a `context_window` field, and `supports_*` capability flags — so it is
 * mapped here instead of through the shared OpenRouter-compatible fetcher.
 * Pricing is exposed inline for every model, which feeds pi-free's
 * cost-based free-model detection (Route A) without any curated list.
 */
import { applyHidden } from "../../config.js";
import { BASE_URL_REQUESTY, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_REQUESTY, } from "../../constants.js";
import { createLogger } from "../../lib/logger.js";
import { fetchWithRetry, withSignal } from "../../lib/util.js";
const _logger = createLogger("requesty-models");
/** Fallback context window for entries that omit `context_window`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}
/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for non-chat endpoints and unusable entries rather than guessing.
 */
export function mapRequestyModel(entry) {
    if (typeof entry.id !== "string" || entry.id.length === 0)
        return undefined;
    // The /models endpoint also serves image-generation and other api types;
    // only chat completions are usable as an agent model.
    if (entry.api !== "chat")
        return undefined;
    // NVIDIA NIM guard classifiers are served through the chat surface but
    // cannot hold a conversation.
    if (entry.id.includes("content-safety"))
        return undefined;
    const inputPrice = asNumber(entry.input_price);
    const outputPrice = asNumber(entry.output_price);
    return {
        id: entry.id,
        name: entry.id,
        reasoning: entry.supports_reasoning === true,
        input: entry.supports_vision === true ? ["text", "image"] : ["text"],
        cost: {
            input: inputPrice ?? 0,
            output: outputPrice ?? 0,
            cacheRead: asNumber(entry.cached_price) ?? 0,
            cacheWrite: asNumber(entry.caching_price) ?? 0,
        },
        contextWindow: asNumber(entry.context_window) ?? FALLBACK_CONTEXT_WINDOW,
        maxTokens: asNumber(entry.max_output_tokens) || 4_096,
    };
}
/**
 * Fetch the complete public catalog. The key is optional for /models; it is
 * only passed when configured so public discovery works for logged-out users.
 */
export async function fetchRequestyModels(apiKey, signal) {
    const headers = {
        Accept: "application/json",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetchWithRetry(`${BASE_URL_REQUESTY}/models`, withSignal({
        headers,
    }, signal), 1, 1_000, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok) {
        throw new Error(`Requesty catalog returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const entries = payload &&
        typeof payload === "object" &&
        Array.isArray(payload.data)
        ? payload.data
        : [];
    const models = [];
    for (const entry of entries) {
        const mapped = mapRequestyModel(entry);
        if (mapped)
            models.push(mapped);
    }
    if (models.length === 0) {
        _logger.warn("Requesty catalog returned no usable chat models");
    }
    return applyHidden(models, PROVIDER_REQUESTY);
}
//# sourceMappingURL=requesty-models.js.map