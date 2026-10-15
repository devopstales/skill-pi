/**
 * FastRouter native provider.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store, then nudges the normal asynchronous refresh at
 * session start. FastRouter's public /models endpoint is fetched without a
 * credential; chat requests use FASTROUTER_API_KEY when configured.
 */
import { getFastrouterApiKey, getFastrouterShowPaid } from "../../config.js";
import { BASE_URL_FASTROUTER, PROVIDER_FASTROUTER } from "../../constants.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { fastrouterAuth } from "./fastrouter-auth.js";
import { fetchFastrouterModels } from "./fastrouter-models.js";
export default function fastrouterProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_FASTROUTER,
        name: "FastRouter",
        baseUrl: BASE_URL_FASTROUTER,
        auth: fastrouterAuth,
        getApiKey: getFastrouterApiKey,
        getShowPaid: getFastrouterShowPaid,
        allowUnauthenticated: true,
        fetchModels: (apiKey, signal) => fetchFastrouterModels(apiKey, signal),
    });
    return Promise.resolve();
}
//# sourceMappingURL=fastrouter.js.map