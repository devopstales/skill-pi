import { DEFAULT_FETCH_TIMEOUT_MS, URL_MODELS_DEV } from "../constants.js";
import { createLogger } from "./logger.js";
import { loadPiAiEntry } from "./pi-ai-loader.js";
import { getProxyModelCompat } from "./provider-compat.js";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const MODELS_DEV_CACHE_TTL_MS = 5 * 60 * 1000;
const MODELS_DEV_RETRIES = 3;
const MODELS_DEV_RETRY_DELAY_MS = 250;
const MODELS_DEV_PROVIDER_ALIASES = {
    together: "togetherai",
    novita: "novita-ai",
};
const _logger = createLogger("model-metadata");
let catalogCache;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function clearModelsDevMetaCache() {
    catalogCache = undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function fetchModelsDevCatalog() {
    let lastError;
    for (let attempt = 1; attempt <= MODELS_DEV_RETRIES; attempt++) {
        try {
            const response = await fetch(URL_MODELS_DEV, {
                headers: { "User-Agent": "pi-free-providers" },
                signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
            });
            if (response.ok) {
                return (await response.json());
            }
            lastError = new Error(`HTTP ${response.status} ${response.statusText}`.trim());
        }
        catch (error) {
            lastError = error;
        }
        if (attempt < MODELS_DEV_RETRIES) {
            await sleep(MODELS_DEV_RETRY_DELAY_MS);
        }
    }
    _logger.warn("Failed to fetch models.dev metadata", {
        error: errorMessage(lastError),
    });
    return {};
}
function getModelsDevCatalogCache() {
    const now = Date.now();
    if (catalogCache && catalogCache.expiresAt > now) {
        return catalogCache;
    }
    const cache = {
        expiresAt: now + MODELS_DEV_CACHE_TTL_MS,
        promise: Promise.resolve({}),
        indexes: new WeakMap(),
    };
    cache.promise = fetchModelsDevCatalog().catch((error) => {
        if (catalogCache === cache)
            catalogCache = undefined;
        _logger.warn("Failed to load models.dev metadata", {
            error: errorMessage(error),
        });
        return {};
    });
    catalogCache = cache;
    return cache;
}
function collectAllModels(catalog) {
    const allModels = {};
    for (const [providerKey, provider] of Object.entries(catalog)) {
        for (const [modelId, model] of Object.entries(provider.models ?? {})) {
            allModels[`${provider.id ?? providerKey}/${modelId}`] = model;
        }
    }
    return allModels;
}
function hasModels(models) {
    return models !== undefined && Object.keys(models).length > 0;
}
function findProviderModels(catalog, providerId) {
    const ids = new Set([providerId, MODELS_DEV_PROVIDER_ALIASES[providerId]].filter((id) => Boolean(id)));
    for (const id of ids) {
        const directModels = catalog[id]?.models;
        if (hasModels(directModels))
            return directModels;
    }
    for (const provider of Object.values(catalog)) {
        if (provider?.id && ids.has(provider.id) && hasModels(provider.models)) {
            return provider.models;
        }
    }
    return undefined;
}
export async function fetchModelsDevMeta(providerId) {
    const cache = getModelsDevCatalogCache();
    const catalog = await cache.promise;
    if (providerId) {
        const scopedModels = findProviderModels(catalog, providerId);
        if (scopedModels)
            return scopedModels;
    }
    return (cache.allModels ??= collectAllModels(catalog));
}
function normalizeModelKey(id) {
    return id
        .toLowerCase()
        .replace(/^~/, "")
        .replace(/:free$/, "")
        .replace(/-free$/, "");
}
function buildModelMetaIndex(meta) {
    const index = new Map();
    for (const [key, model] of Object.entries(meta)) {
        for (const value of [key, model.id, key.split("/").pop()]) {
            if (value)
                index.set(normalizeModelKey(value), model);
        }
    }
    return index;
}
function getModelMetaIndex(meta) {
    const cache = catalogCache;
    if (!cache)
        return buildModelMetaIndex(meta);
    const cached = cache.indexes.get(meta);
    if (cached)
        return cached;
    const index = buildModelMetaIndex(meta);
    cache.indexes.set(meta, index);
    return index;
}
function findModelDevMeta(index, modelId) {
    const id = normalizeModelKey(modelId);
    return index.get(id) ?? index.get(id.split("/").pop() ?? id);
}
function isTextOnly(input) {
    return input.length === 1 && input[0] === "text";
}
function costLooksLikeFallback(cost) {
    return (cost.input === 0 &&
        cost.output === 0 &&
        cost.cacheRead === 0 &&
        cost.cacheWrite === 0);
}
function costFromModelsDev(cost) {
    if (!cost)
        return undefined;
    return {
        input: cost.input / 1_000_000,
        output: cost.output / 1_000_000,
        cacheRead: (cost.cache_read ?? 0) / 1_000_000,
        cacheWrite: (cost.cache_write ?? 0) / 1_000_000,
    };
}
function thinkingMapFromReasoningOptions(options) {
    const effort = options?.find((option) => option.type === "effort");
    if (!effort?.values?.length)
        return undefined;
    const values = new Set(effort.values);
    return {
        off: values.has("none") ? "none" : null,
        minimal: values.has("minimal") ? "minimal" : null,
        low: values.has("low") ? "low" : null,
        medium: values.has("medium") ? "medium" : null,
        high: values.has("high") ? "high" : null,
        xhigh: values.has("xhigh") ? "xhigh" : values.has("max") ? "max" : null,
    };
}
function identityFromMeta(model, meta) {
    return {
        id: [model.id, meta.id, meta.family, meta.provider]
            .filter(Boolean)
            .join(" "),
        name: [model.name, meta.name].filter(Boolean).join(" "),
        family: meta.family,
        provider: meta.provider,
    };
}
function mergeCompat(existing, derived) {
    if (!existing)
        return derived;
    if (!derived)
        return existing;
    return { ...derived, ...existing };
}
function enrichModel(model, ctx) {
    const modelMeta = findModelDevMeta(ctx.index, model.id);
    if (!modelMeta)
        return model;
    const contextWindow = modelMeta.limit && ctx.fallbackContextWindows.has(model.contextWindow)
        ? modelMeta.limit.context
        : model.contextWindow;
    const maxTokens = modelMeta.limit && ctx.fallbackMaxTokens.has(model.maxTokens)
        ? modelMeta.limit.output
        : model.maxTokens;
    const input = ctx.enrichInput &&
        isTextOnly(model.input) &&
        modelMeta.modalities?.input?.includes("image")
        ? ["text", "image"]
        : model.input;
    const reasoning = ctx.enrichReasoning && modelMeta.reasoning === true
        ? true
        : model.reasoning;
    const thinkingLevelMap = ctx.enrichReasoning && model.thinkingLevelMap === undefined
        ? thinkingMapFromReasoningOptions(modelMeta.reasoning_options)
        : model.thinkingLevelMap;
    const cost = ctx.enrichCost === "fallback-only" && costLooksLikeFallback(model.cost)
        ? (costFromModelsDev(modelMeta.cost) ?? model.cost)
        : model.cost;
    const compat = ctx.enrichCompat
        ? mergeCompat(model.compat, getProxyModelCompat(identityFromMeta(model, modelMeta)))
        : model.compat;
    const modelsDevMetadata = {
        id: modelMeta.id,
        name: modelMeta.name,
        ...(modelMeta.family ? { family: modelMeta.family } : {}),
        ...(modelMeta.provider ? { provider: modelMeta.provider } : {}),
    };
    return {
        ...model,
        contextWindow,
        maxTokens,
        input,
        reasoning,
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        cost,
        ...(compat ? { compat } : {}),
        modelsDev: modelsDevMetadata,
    };
}
/**
 * Fill Pi-usable model fields from models.dev when provider APIs only expose
 * generic defaults. Fail-open: network/API failures leave models unchanged.
 */
export async function enrichModelsWithModelsDev(models, options = {}) {
    if (models.length === 0)
        return models;
    let meta;
    try {
        meta = await fetchModelsDevMeta(options.providerId);
    }
    catch (error) {
        _logger.warn("Failed to load models.dev metadata", {
            providerId: options.providerId,
            error: errorMessage(error),
        });
        return models;
    }
    if (Object.keys(meta).length === 0)
        return models;
    const ctx = {
        index: getModelMetaIndex(meta),
        fallbackContextWindows: new Set(options.fallbackContextWindows ?? [DEFAULT_CONTEXT_WINDOW, 4096]),
        fallbackMaxTokens: new Set(options.fallbackMaxTokens ?? [DEFAULT_MAX_TOKENS, 4096]),
        enrichInput: options.enrichInput ?? true,
        enrichReasoning: options.enrichReasoning ?? true,
        enrichCost: options.enrichCost ?? "never",
        enrichCompat: options.enrichCompat ?? true,
    };
    return models.map((model) => {
        try {
            return enrichModel(model, ctx);
        }
        catch (error) {
            _logger.warn("Failed to enrich model from models.dev metadata", {
                modelId: model.id,
                error: errorMessage(error),
            });
            return model;
        }
    });
}
export async function safeEnrichModelsWithModelsDev(models, options = {}) {
    try {
        return await enrichModelsWithModelsDev(models, options);
    }
    catch {
        return models;
    }
}
let builtinModelsModulePromise;
/**
 * Single-flight cached dynamic import of Pi's build-time native catalog.
 * The module is heavy and only needed on the models.dev enrichment fallback
 * paths, so it must never be imported eagerly at startup.
 */
function loadBuiltinModelsModule() {
    if (!builtinModelsModulePromise) {
        builtinModelsModulePromise = loadPiAiEntry("providers/all").catch((error) => {
            // Do not cache failures: a transient load error must not break
            // every later fallback lookup.
            builtinModelsModulePromise = undefined;
            throw error;
        });
    }
    return builtinModelsModulePromise;
}
function getNativeCatalogModels(providerId) {
    return loadBuiltinModelsModule()
        .then(({ getBuiltinModels }) => {
        return getBuiltinModels(providerId);
    })
        .catch(() => []);
}
function hasZeroTokenCost(cost) {
    return (cost.input === 0 &&
        cost.output === 0 &&
        cost.cacheRead === 0 &&
        cost.cacheWrite === 0);
}
/**
 * Mark dynamic models whose IDs are known to be free in Pi's native catalog.
 * Some OpenCode endpoints omit pricing, but `big-pickle` is free without a
 * `-free` suffix. Preserve that authoritative native signal for dynamic
 * discovery while leaving unknown models on the normal name-based path.
 */
export async function applyNativeFreeMetadata(models, providerId) {
    const nativeById = new Map((await getNativeCatalogModels(providerId)).map((model) => [
        model.id,
        model,
    ]));
    return models.map((model) => {
        const native = nativeById.get(model.id);
        if (!native || !hasZeroTokenCost(native.cost))
            return model;
        return { ...model, _freeKnown: true, _isFree: true };
    });
}
/**
 * Preserve Pi's per-model protocol metadata when a dynamic endpoint only
 * returns model IDs. This prevents a live catalog refresh from flattening
 * Anthropic, Responses, and Google models into one OpenAI-compatible route.
 */
export async function applyNativeProtocolMetadata(models, providerId) {
    const nativeById = new Map((await getNativeCatalogModels(providerId)).map((model) => [
        model.id,
        model,
    ]));
    return models.map((model) => {
        const native = nativeById.get(model.id);
        if (!native)
            return model;
        const compat = native.compat || model.compat
            ? { ...native.compat, ...model.compat }
            : undefined;
        return {
            ...model,
            ...(native.api ? { api: native.api } : {}),
            ...(native.baseUrl ? { baseUrl: native.baseUrl } : {}),
            ...(compat ? { compat } : {}),
        };
    });
}
//# sourceMappingURL=model-metadata.js.map