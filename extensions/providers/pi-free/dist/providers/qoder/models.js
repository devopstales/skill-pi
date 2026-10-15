/**
 * Qoder model definitions and cache management.
 *
 * Qoder operates on a credits-based pricing model:
 *   - Community Edition (free): basic models with daily message limits
 *   - Pro / Pro+ / Ultra (paid): premium models via monthly credits
 *   - Time-bound promos: Qoder periodically drops a premium model's credit
 *     rate to 0.0x (e.g. Qwen3.8-Flash, Sep 18-30 2026). Those are captured
 *     in PROMO_FREE_MODELS with an exclusive expiry so the free flag lapses
 *     automatically — no follow-up commit needed to re-hide them.
 *
 * The dynamic model list API is currently unavailable on International
 * (center.qoder.sh/algo/api/v2/model/list exists but requires COSY request
 * signing; api2-v2 exposes no public catalog endpoint — both probed
 * 2026-09-25). We keep a static curated list and classify models as
 * basic (free tier), promo-free (time-bound), or premium (paid credits)
 * by model ID. IDs are cross-checked against independent integrations
 * (opencode-qoder plugin, qoderwork gateway plugin) and, where the account
 * holds quota, against live chat-completions probes.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../lib/logger.js";
const _logger = createLogger("qoder");
// ─── Cache ───────────────────────────────────────────────────────────────────
const CACHE_PATH = join(homedir(), ".pi", "agent", "qoder-models-cache.json");
const ZERO_COST = Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
});
// ─── Basic (free-tier) model IDs ─────────────────────────────────────────────
// These are the Qoder-branded router models available on Community Edition.
// Named models (DeepSeek, Qwen, GLM, Kimi, MiniMax) are premium and cost credits.
// This set is the single source of truth for basic-model classification.
const BASIC_MODEL_IDS = new Set([
    "auto",
    "ultimate",
    "performance",
    "efficient",
    "lite",
]);
// ─── Static model list ───────────────────────────────────────────────────────
/**
 * Static model definitions for Qoder.
 * Basic models (free tier) are identified by membership in BASIC_MODEL_IDS.
 * Time-bound promo models are listed in PROMO_FREE_MODELS with an expiry.
 * Premium models consume credits and require a paid plan (or event credits).
 *
 * Named-model IDs are cross-checked against the opencode-qoder plugin
 * catalog and the qoderwork gateway plugin's static fallback (both list
 * qmodel_preview, qmodel_latest, q36fmodel, dfmodel, deepseek-hermes,
 * gm51model, and kmodel_latest as live IDs). Display names follow those
 * sources; Qoder publishes no public International catalog to confirm them
 * against, so they ship as premium (toggle-visible, never free-default).
 */
export const staticModels = [
    {
        id: "auto",
        name: "Qoder Auto",
        reasoning: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "ultimate",
        name: "Qoder Ultimate",
        reasoning: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1_000_000,
        maxTokens: 32_768,
    },
    {
        id: "performance",
        name: "Qoder Performance",
        reasoning: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1_000_000,
        maxTokens: 32_768,
    },
    {
        id: "efficient",
        name: "Qoder Efficient",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "lite",
        name: "Qoder Lite",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "qmodel",
        name: "Qwen3.7 Plus (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1_000_000,
        maxTokens: 32_768,
    },
    {
        id: "dmodel",
        name: "DeepSeek V4 Pro (Qoder)",
        reasoning: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1_000_000,
        maxTokens: 32_768,
    },
    {
        id: "kmodel",
        name: "Kimi K2.6 (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 256_000,
        maxTokens: 32_768,
    },
    {
        id: "mmodel",
        name: "MiniMax M3 (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1_000_000,
        maxTokens: 32_768,
    },
    {
        id: "qmodel_preview",
        name: "Qwen3.8-Max Preview (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "qmodel_latest",
        name: "Qwen3.7 Max (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "q36fmodel",
        name: "Qwen3.6 Flash (Qoder)",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "dfmodel",
        name: "DeepSeek V4 Flash (Qoder)",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "deepseek-hermes",
        name: "DeepSeek Hermes (Qoder)",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "gm51model",
        name: "GLM 5.2 (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180_000,
        maxTokens: 32_768,
    },
    {
        id: "kmodel_latest",
        name: "Kimi Latest (Qoder)",
        reasoning: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 256_000,
        maxTokens: 32_768,
    },
];
// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Check if a model is a basic (free-tier) model. */
export function isBasicModel(model) {
    return BASIC_MODEL_IDS.has(model.id);
}
/**
 * Premium models temporarily at a 0.0x credit rate. The free flag lapses
 * automatically at `freeUntil` (evaluated when the catalog is built, so a
 * refresh after expiry re-hides the model with no code change). An
 * unparseable date never matches — a typo fails closed to premium.
 *
 * Currently empty: Qoder's Qwen3.8-Flash 0.0x promo (Sep 18-30 2026,
 * docs.qoder.com/events/flashoffer) has no verified api2-v2 model id yet.
 * The gateway gates quota before resolving model ids, so a zero-credit
 * account cannot distinguish valid from invalid ids via chat probes
 * (probed 2026-09-25: every id, real or bogus, returns 402 quota
 * exceeded). Add the entry once the serving id is confirmed on a funded
 * account — see tests/qoder-promo.test.ts for the contract.
 */
export const PROMO_FREE_MODELS = [];
export function isPromoFreeModel(id, nowMs = Date.now(), promos = PROMO_FREE_MODELS) {
    return promos.some((promo) => promo.id === id && nowMs < Date.parse(promo.freeUntil));
}
/**
 * Full free check: standing basic tier plus any live time-bound promo.
 * This is the predicate the provider's free/premium split must use;
 * isBasicModel alone misses promo windows.
 */
export function isQoderFreeModel(model, nowMs = Date.now(), promos = PROMO_FREE_MODELS) {
    return isBasicModel(model) || isPromoFreeModel(model.id, nowMs, promos);
}
// ─── Stream metadata cache ───────────────────────────────────────────────────
/**
 * The legacy cache is consulted only for optional stream metadata. It is not a
 * model catalog or freshness source; catalogs are restored/persisted by Pi.
 */
function isCacheStale() {
    if (!existsSync(CACHE_PATH))
        return true;
    try {
        const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
        if (!data || typeof data.updatedAt !== "number")
            return true;
        return Date.now() - data.updatedAt > 3_600_000; // 1 hour
    }
    catch (err) {
        _logger.warn("Failed to check Qoder cache staleness; treating as stale", {
            error: err instanceof Error ? err.message : String(err),
        });
        return true;
    }
}
/**
 * Get the cached model config for a specific model key.
 * Used to determine per-model settings (reasoning, max tokens, etc.) at stream time.
 */
export function getCachedModelConfig(modelKey) {
    if (existsSync(CACHE_PATH) && !isCacheStale()) {
        try {
            const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
            if (data?.configs?.[modelKey]) {
                return data.configs[modelKey];
            }
        }
        catch (err) {
            _logger.warn("Failed to read Qoder model config cache", {
                modelKey,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return null;
}
//# sourceMappingURL=models.js.map