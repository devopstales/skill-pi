/**
 * GMI Cloud native provider.
 *
 * GMI Cloud exposes a single OpenAI-compatible Inference API at
 * `https://api.gmi-serving.com/v1` covering chat, vision, tools, and
 * reasoning across 200+ open and frontier models. Pi owns authentication,
 * model-store persistence, refresh scheduling, and request streaming through
 * the native provider lifecycle.
 *
 * Setup:
 *   GMI_API_KEY=...
 *   # or add gmi_api_key to ~/.pi/free.json
 */
import { getGmiApiKey, getGmiShowPaid } from "../../config.js";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { gmiAuth } from "./gmi-auth.js";
import { fetchGmiModels } from "./gmi-models.js";
export default function gmiProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_GMI,
        name: "GMI Cloud",
        baseUrl: BASE_URL_GMI,
        auth: gmiAuth,
        getApiKey: getGmiApiKey,
        getShowPaid: getGmiShowPaid,
        fetchModels: (apiKey, signal) => fetchGmiModels(apiKey, signal),
    });
    return Promise.resolve();
}
//# sourceMappingURL=gmi.js.map