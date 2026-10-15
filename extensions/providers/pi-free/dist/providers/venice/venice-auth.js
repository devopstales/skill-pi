/**
 * Venice AI API-key authentication.
 *
 * The model catalog (api.venice.ai/api/v1/models) is public, so keyless
 * resolution returns a truthy anonymous result and Pi's model refresh still
 * populates the catalog. Chat requests use the configured key; the gateway
 * rejects unauthenticated completions.
 */
import { getVeniceApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
/** Venice AI API-key authentication for both catalog refresh and chat requests. */
export const veniceAuth = createNativeApiKeyAuth({
    name: "Venice API key",
    prompt: "Venice API key",
    source: "VENICE_API_KEY",
    getApiKey: getVeniceApiKey,
});
//# sourceMappingURL=venice-auth.js.map