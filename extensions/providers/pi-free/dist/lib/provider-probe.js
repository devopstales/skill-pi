/**
 * Generic Provider Probe Helper
 *
 * Provides a reusable auto-probe factory for providers whose free model
 * availability may change over time (expired promotions, rate limits,
 * server spin-down).
 *
 * Usage:
 *   const probe = createProviderProbe({
 *     providerId: "deepinfra",
 *     probeModel: async (apiKey, modelId) => { ... return "ok"|"broken"|"unknown"; },
 *   });
 *   const broken = await probe.run(apiKey, models);
 *   // broken is a string[] of model IDs that returned "broken"
 *
 * The helper handles:
 *   - Batching probe requests (default batchSize=5)
 *   - Probe-cache integration (skip recently-probed models, persist results)
 *   - Auto-hiding broken models in config (provider-scoped)
 *   - Re-registration after hiding
 */
import { updateConfig } from "../config.js";
import { createLogger } from "./logger.js";
import { fetchWithTimeout } from "./util.js";
import { areAllModelsFresh, getModelsDueForProbe, recordModelProbeResults, } from "./probe-cache.js";
const _logger = createLogger("provider-probe");
// =============================================================================
// Factory
// =============================================================================
/** Build the standard one-token probe used by OpenAI-compatible gateways. */
export function createOpenAIAvailabilityProbe(providerId, baseUrl) {
    return createProviderProbe({
        providerId,
        probeModel: async (apiKey, modelId) => {
            try {
                const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        "User-Agent": "pi-free-providers",
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: [{ role: "user", content: "hi" }],
                        max_tokens: 1,
                    }),
                }, 10_000);
                return response.status === 404 || response.status >= 500
                    ? "broken"
                    : "ok";
            }
            catch {
                return "unknown";
            }
        },
    });
}
export function createProviderProbe(options) {
    const { providerId, probeModel, batchSize = 5, autoHide = true } = options;
    const run = async (apiKey, models, opts = {}) => {
        const { useCache = false, onBroken } = opts;
        // Determine which models need probing
        const modelIdsToProbe = useCache
            ? new Set(getModelsDueForProbe(providerId, models.map((m) => m.id)))
            : undefined;
        const probeCandidates = modelIdsToProbe
            ? models.filter((m) => modelIdsToProbe.has(m.id))
            : models;
        if (probeCandidates.length === 0) {
            _logger.info(`[probe] ${providerId}: probe cache is fresh`);
            return [];
        }
        _logger.info(`[probe] ${providerId}: probing ${probeCandidates.length} models (batch ${batchSize})`);
        // Batch probes
        const broken = [];
        const cacheableResults = [];
        for (let i = 0; i < probeCandidates.length; i += batchSize) {
            const batch = probeCandidates.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async (m) => {
                const status = await probeModel(apiKey, m.id);
                return { id: m.id, status };
            }));
            for (const r of results) {
                if (r.status === "broken")
                    broken.push(r.id);
                if (r.status !== "unknown") {
                    cacheableResults.push({ modelId: r.id, status: r.status });
                }
            }
        }
        // Persist probe results to cache
        await recordModelProbeResults(providerId, cacheableResults);
        if (broken.length === 0) {
            _logger.info(`[probe] ${providerId}: all models accessible`);
            return [];
        }
        // Optional auto-hide — use updateConfig for atomic RMW to prevent
        // concurrent probes from clobbering each other's hidden_models.
        if (autoHide) {
            await updateConfig((cfg) => {
                const existingHidden = new Set(cfg.hidden_models ?? []);
                for (const id of broken)
                    existingHidden.add(`${providerId}/${id}`);
                return { hidden_models: Array.from(existingHidden) };
            });
            _logger.info(`[probe] ${providerId}: auto-hidden ${broken.length} broken models`);
        }
        onBroken?.(broken);
        _logger.info(`[probe] ${providerId}: found ${broken.length} broken models`);
        return broken;
    };
    const autoProbeHandler = (apiKey, models, onBroken) => {
        let done = false;
        return () => {
            if (done)
                return;
            done = true;
            // Skip scheduling entirely if every model was probed recently.
            // Without this check the handler fires on every session_start and
            // only then discovers the cache is fresh inside run().
            if (areAllModelsFresh(providerId, models.map((m) => m.id))) {
                _logger.info(`[probe] ${providerId}: auto-probe cache is fresh`);
                return;
            }
            _logger.info(`[probe] Starting lazy auto-probe for ${providerId}...`);
            return run(apiKey, models, { useCache: true, onBroken })
                .then(() => undefined)
                .catch((err) => {
                _logger.warn(`[probe] ${providerId}: auto-probe failed`, {
                    error: err instanceof Error ? err.message : String(err),
                });
                throw err;
            });
        };
    };
    return { run, autoProbeHandler };
}
//# sourceMappingURL=provider-probe.js.map