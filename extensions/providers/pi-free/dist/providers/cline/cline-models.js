/**
 * Cline model fetching.
 *
 * Fetches Cline's own model catalog from api.cline.bot instead of OpenRouter.
 * Cline also exposes a recommended/free-to-try list; those models may have
 * non-zero list pricing in the catalog, so we mark recommended-free IDs (and
 * their conservative provider/date aliases) as zero-cost for pi-free's
 * free-model filter.
 */
import { applyHidden } from "../../config.js";
import { BASE_URL_CLINE, CLINE_EXTENSION_VERSION, DEFAULT_FETCH_TIMEOUT_MS, PROVIDER_CLINE, VS_CODE_VERSION, } from "../../constants.js";
import { isFreeModel } from "../../lib/registry.js";
import { withGatewayCompat } from "../../lib/native-provider.js";
import { createLogger } from "../../lib/logger.js";
import { getClineProviderHeaders } from "./cline-headers.js";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.js";
import { getProxyModelCompat } from "../../lib/provider-compat.js";
import { cleanModelName, fetchWithRetry } from "../../lib/util.js";
const _logger = createLogger("cline-models");
function buildClineFetchHeaders() {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": `Cline/${CLINE_EXTENSION_VERSION}`,
        "X-PLATFORM": "Visual Studio Code",
        "X-PLATFORM-VERSION": VS_CODE_VERSION,
        "X-CLIENT-TYPE": "VSCode Extension",
        "X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
        "X-CORE-VERSION": CLINE_EXTENSION_VERSION,
    };
}
function extractNameFromId(id) {
    const part = id.split("/")[1] ?? id;
    return part
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
/**
 * Parse pricing string to cost per million tokens.
 * Cline returns pricing as string per token (e.g. "0.0001" or "0").
 */
function parsePricing(pricingStr) {
    if (!pricingStr || pricingStr === "0")
        return 0;
    const parsed = Number.parseFloat(pricingStr);
    return Number.isNaN(parsed) ? 0 : parsed * 1_000_000;
}
function modalityIncludes(modality, needle) {
    if (Array.isArray(modality))
        return modality.includes(needle);
    return typeof modality === "string" && modality.includes(needle);
}
function hasTextOutput(info) {
    const outputMods = info.architecture?.output_modalities;
    if (Array.isArray(outputMods) && outputMods.length > 0) {
        return outputMods.includes("text");
    }
    return modalityIncludes(info.architecture?.modality, "text");
}
function supportsImages(info) {
    const inputMods = info.architecture?.input_modalities;
    if (Array.isArray(inputMods) && inputMods.includes("image"))
        return true;
    return modalityIncludes(info.architecture?.modality, "image");
}
function modelFromRecommended(model) {
    const name = model.name?.trim() || extractNameFromId(model.id);
    return {
        id: model.id,
        name: `${cleanModelName(name)} (Cline)`,
        reasoning: false,
        input: ["text"],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: 1_000_000,
        maxTokens: 65_536,
        _pricingKnown: true,
    };
}
// Cline's recommended-models `free` list is the authoritative free-to-try
// source, and both it and the catalog use provider-qualified IDs. Match
// exactly: fuzzy aliasing (e.g. stripping date suffixes) turned genuinely
// paid dated variants like `deepseek/deepseek-v4-flash-0731` into free
// models that then fail with 402 insufficient credits at request time.
function modelFromCatalog(info, freeToTryIds) {
    const isReasoning = Boolean(info.supported_parameters?.includes("include_reasoning") ||
        info.supported_parameters?.includes("reasoning"));
    const isFreeToTry = freeToTryIds.has(info.id);
    const inputCost = isFreeToTry ? 0 : parsePricing(info.pricing?.prompt);
    const outputCost = isFreeToTry ? 0 : parsePricing(info.pricing?.completion);
    const cacheRead = isFreeToTry
        ? 0
        : parsePricing(info.pricing?.input_cache_read);
    const cacheWrite = isFreeToTry
        ? 0
        : parsePricing(info.pricing?.input_cache_write);
    const isFree = inputCost === 0 && outputCost === 0;
    const cleanName = info.name
        ? cleanModelName(info.name)
        : extractNameFromId(info.id);
    return {
        id: info.id,
        name: `${cleanName} (Cline)${isFree ? "" : " 💰"}`,
        reasoning: isReasoning,
        input: supportsImages(info) ? ["text", "image"] : ["text"],
        cost: {
            input: inputCost,
            output: outputCost,
            cacheRead,
            cacheWrite,
        },
        contextWindow: info.context_length ?? info.top_provider?.context_length ?? 128_000,
        maxTokens: info.top_provider?.max_completion_tokens ?? 8_192,
        ...(getProxyModelCompat({ id: info.id, name: info.name })
            ? { compat: getProxyModelCompat({ id: info.id, name: info.name }) }
            : {}),
        _pricingKnown: info.pricing !== null && info.pricing !== undefined,
    };
}
async function fetchClineRecommendedFreeModels() {
    const response = await fetchWithRetry(`${BASE_URL_CLINE}/ai/cline/recommended-models`, { headers: buildClineFetchHeaders() }, 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok)
        return [];
    const json = (await response.json());
    return Array.isArray(json.free) ? json.free.filter((m) => m?.id) : [];
}
async function fetchClineCatalogModels() {
    const response = await fetchWithRetry(`${BASE_URL_CLINE}/ai/cline/models`, { headers: buildClineFetchHeaders() }, 3, 1000, DEFAULT_FETCH_TIMEOUT_MS);
    if (!response.ok)
        throw new Error(`Failed to fetch Cline models: ${response.status}`);
    const json = (await response.json());
    if (!Array.isArray(json.data)) {
        throw new Error("Invalid Cline models response: missing data array");
    }
    return json.data;
}
/**
 * Fetch models from Cline.
 * @param freeOnly - If true, return only zero-cost/free-to-try models
 */
async function fetchClineModels(freeOnly = false) {
    const [catalogModels, recommendedFreeModels] = await Promise.all([
        fetchClineCatalogModels(),
        fetchClineRecommendedFreeModels().catch(() => []),
    ]);
    const recommendedFreeIds = new Set(recommendedFreeModels.map((m) => m.id));
    const models = [];
    const seen = new Set();
    for (const info of catalogModels) {
        if (!hasTextOutput(info))
            continue;
        const model = modelFromCatalog(info, recommendedFreeIds);
        models.push(model);
        seen.add(model.id);
    }
    // The recommended/free-to-try endpoint can lead the full catalog. Include
    // those exact IDs so newly promoted models (e.g. alibaba/qwen3.7-plus) show up.
    for (const model of recommendedFreeModels) {
        if (seen.has(model.id))
            continue;
        models.push(modelFromRecommended(model));
        seen.add(model.id);
    }
    const filtered = freeOnly
        ? models.filter((m) => m.cost.input === 0 && m.cost.output === 0)
        : models;
    return applyHidden(await safeEnrichModelsWithModelsDev(filtered, {
        providerId: PROVIDER_CLINE,
    }), PROVIDER_CLINE);
}
// =============================================================================
// Native provider catalog (createProvider object form)
// =============================================================================
/**
 * Fetch the full Cline catalog, split into `{ all, free }` using the shared
 * adaptive free detection. The catalog is public (no credential required).
 *
 * Never throws: on a total failure both arrays are empty so callers can retain
 * their previous list (poisoning guard) and recover on a later refresh. Honors
 * the shared abort signal between fetch and split.
 */
export async function fetchClineCatalog(options) {
    let all;
    try {
        all = await fetchClineModels(false);
    }
    catch (error) {
        // Genuine fetch failures must stay diagnosable (abort is handled below
        // without logging, per convention #15) — log and retain via empty arrays.
        _logger.warn("Cline catalog fetch failed; retaining previous list", {
            error: error instanceof Error ? error.message : String(error),
        });
        all = [];
    }
    if (options?.signal?.aborted) {
        return { all: [], free: [] };
    }
    const free = all.filter((m) => isFreeModel({ ...m, provider: PROVIDER_CLINE }, all));
    return { all, free };
}
/**
 * Convert a fetched ProviderModelConfig into the concrete pi-ai
 * `Model<"openai-completions">` shape a native provider's getModels() returns.
 * Adds the provider id, the standard OpenAI Chat Completions wire api, and the
 * gateway baseUrl that the legacy registerProvider config form used to supply
 * implicitly. Cline's endpoint speaks vanilla OpenAI Chat Completions (#433).
 */
function toClineModel(m) {
    return withGatewayCompat({
        ...m,
        api: "openai-completions",
        provider: PROVIDER_CLINE,
        // The legacy registration supplied a single provider-level baseUrl;
        // every Cline model shares the Cline gateway.
        baseUrl: BASE_URL_CLINE,
        // pi-ai merges only the MODEL's headers into requests (not
        // provider.headers) — stamp the shared Cline identity record so the
        // gateway sees a genuine Cline client (see cline-headers.ts).
        headers: getClineProviderHeaders(),
    });
}
/** Convert a batch of model configs to native Model objects. */
export function toClineModels(models) {
    return models.map(toClineModel);
}
//# sourceMappingURL=cline-models.js.map