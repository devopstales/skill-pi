import { getSambanovaApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const sambanovaAuth = createNativeApiKeyAuth({
    name: "SambaNova API key",
    prompt: "SambaNova API key",
    source: "SAMBANOVA_API_KEY",
    getApiKey: getSambanovaApiKey,
});
//# sourceMappingURL=sambanova-auth.js.map