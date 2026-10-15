/**
 * Requesty native provider.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store, then nudges the normal asynchronous refresh at
 * session start. Requesty's public /models endpoint is fetched without a
 * credential; chat requests use REQUESTY_API_KEY when configured. Pricing is
 * inline in the catalog, so the standard cost-based free-model detection
 * applies and `/toggle-requesty` switches between the 12-model free view and
 * the full ~670-model catalog.
 */
import { getRequestyApiKey, getRequestyShowPaid } from "../../config.js";
import { BASE_URL_REQUESTY, PROVIDER_REQUESTY } from "../../constants.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { requestyAuth } from "./requesty-auth.js";
import { fetchRequestyModels } from "./requesty-models.js";
export default function requestyProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_REQUESTY,
        name: "Requesty",
        baseUrl: BASE_URL_REQUESTY,
        auth: requestyAuth,
        getApiKey: getRequestyApiKey,
        getShowPaid: getRequestyShowPaid,
        allowUnauthenticated: true,
        fetchModels: (apiKey, signal) => fetchRequestyModels(apiKey, signal),
    });
    return Promise.resolve();
}
//# sourceMappingURL=requesty.js.map