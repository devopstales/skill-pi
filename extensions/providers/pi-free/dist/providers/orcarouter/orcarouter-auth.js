import { getOrcarouterApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const orcarouterAuth = createNativeApiKeyAuth({
    name: "OrcaRouter API key",
    prompt: "OrcaRouter API key",
    source: "ORCAROUTER_API_KEY",
    getApiKey: getOrcarouterApiKey,
});
//# sourceMappingURL=orcarouter-auth.js.map