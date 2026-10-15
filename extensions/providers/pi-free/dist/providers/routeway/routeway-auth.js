import { getRoutewayApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const routewayAuth = createNativeApiKeyAuth({
    name: "Routeway API key",
    prompt: "Routeway API key",
    source: "ROUTEWAY_API_KEY",
    getApiKey: getRoutewayApiKey,
});
//# sourceMappingURL=routeway-auth.js.map