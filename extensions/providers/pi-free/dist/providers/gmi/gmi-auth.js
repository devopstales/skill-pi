import { getGmiApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
/** GMI Cloud API-key authentication for both catalog refresh and chat requests. */
export const gmiAuth = createNativeApiKeyAuth({
    name: "GMI Cloud API key",
    prompt: "GMI Cloud API key",
    source: "GMI_API_KEY",
    getApiKey: getGmiApiKey,
});
//# sourceMappingURL=gmi-auth.js.map