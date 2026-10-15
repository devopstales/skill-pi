import { getAgnesApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
/** Agnes AI API-key authentication for both catalog refresh and chat requests. */
export const agnesAuth = createNativeApiKeyAuth({
    name: "Agnes AI API key",
    prompt: "Agnes AI API key",
    source: "AGNES_API_KEY",
    getApiKey: getAgnesApiKey,
});
//# sourceMappingURL=agnes-auth.js.map