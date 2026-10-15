/** StepFun's OpenAI-compatible model catalog. */
import { applyHidden } from "../../config.js";
import { BASE_URL_STEPFUN, PROVIDER_STEPFUN } from "../../constants.js";
import { fetchOpenAICompatibleModels } from "../../lib/util.js";
/**
 * Fetch StepFun's authenticated `/models` catalog.
 *
 * StepFun's Step Plan endpoint follows the OpenAI model-list shape. The
 * shared mapper preserves any pricing/capability metadata exposed by the
 * endpoint and applies models.dev enrichment without introducing a second
 * cache or freshness policy.
 */
export async function fetchStepfunModels(apiKey, signal) {
    const models = await fetchOpenAICompatibleModels(PROVIDER_STEPFUN, BASE_URL_STEPFUN, apiKey, {
        contextWindow: 128_000,
        maxTokens: 16_384,
    }, undefined, signal);
    return applyHidden(models, PROVIDER_STEPFUN);
}
//# sourceMappingURL=stepfun-models.js.map