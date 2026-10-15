/** FastRouter's public OpenRouter-compatible model catalog. */
import { applyHidden } from "../../config.js";
import { BASE_URL_FASTROUTER, PROVIDER_FASTROUTER } from "../../constants.js";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.js";
/**
 * Fetch the complete public catalog. The key is optional for /models; it is
 * only passed when configured so public discovery works for logged-out users.
 */
export async function fetchFastrouterModels(apiKey, signal) {
    const models = await fetchOpenRouterCompatibleModels({
        providerId: PROVIDER_FASTROUTER,
        baseUrl: BASE_URL_FASTROUTER,
        apiKey: apiKey || undefined,
        signal,
        // FastRouter's free view must not contain media-generation models:
        // zero-priced image/audio hybrids (gemini-*-image, prompt-to-audio)
        // would otherwise be classified as free chat models.
        excludeOutputModalities: ["image", "audio", "video", "speech"],
    });
    return applyHidden(models, PROVIDER_FASTROUTER);
}
//# sourceMappingURL=fastrouter-models.js.map