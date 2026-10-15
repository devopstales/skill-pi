import { getAnyapiApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const anyapiAuth = createNativeApiKeyAuth({
    name: "AnyAPI API key",
    prompt: "AnyAPI API key",
    source: "ANYAPI_API_KEY",
    getApiKey: getAnyapiApiKey,
});
//# sourceMappingURL=anyapi-auth.js.map