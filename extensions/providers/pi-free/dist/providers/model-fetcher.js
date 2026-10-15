/**
 * Shared model fetching for OpenRouter-compatible APIs.
 * Consolidates duplicate logic from openrouter.ts and kilo-models.ts
 */
import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants.js";
import { safeEnrichModelsWithModelsDev } from "../lib/model-metadata.js";
import { fetchWithRetry, mapOpenRouterModel } from "../lib/util.js";
/**
 * Fetch models from an OpenRouter-compatible API.
 * Handles response parsing, filtering, and mapping to ProviderModelConfig.
 */
export async function fetchOpenRouterCompatibleModels(options) {
    const { baseUrl, apiKey, freeOnly = false, excludeOutputModalities, extraHeaders = {}, retries = 3, retryDelay = 1000, signal, } = options;
    const headers = {
        "Content-Type": "application/json",
        "User-Agent": "pi-free-providers",
        ...extraHeaders,
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetchWithRetry(`${baseUrl}/models`, {
        headers,
        signal: signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    }, retries, retryDelay, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json());
    if (!json.data || !Array.isArray(json.data)) {
        throw new Error("Invalid models response: missing data array");
    }
    const models = json.data
        .filter((m) => {
        // Filter out models that cannot produce text output (image/video/audio
        // generation, embedding-only, etc.). Keep models with no output
        // modality info to avoid over-filtering older endpoints.
        const outputMods = m.architecture?.output_modalities ?? [];
        if (outputMods.length > 0 && !outputMods.includes("text"))
            return false;
        // Stricter capability exclusion for providers whose free views must
        // not contain media-generation hybrids (image+text output etc.).
        if (excludeOutputModalities &&
            outputMods.some((mod) => excludeOutputModalities.includes(mod)))
            return false;
        // Filter by provider flag when available, otherwise pricing.
        if (freeOnly) {
            if (typeof m.isFree === "boolean")
                return m.isFree;
            const prompt = Number.parseFloat(m.pricing?.prompt ?? "1");
            const completion = Number.parseFloat(m.pricing?.completion ?? "1");
            if (prompt !== 0 || completion !== 0)
                return false;
        }
        return true;
    })
        .map(mapOpenRouterModel);
    return safeEnrichModelsWithModelsDev(models, {
        providerId: options.providerId,
    });
}
//# sourceMappingURL=model-fetcher.js.map