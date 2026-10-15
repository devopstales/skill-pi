import { getDeepinfraApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const deepinfraAuth = createNativeApiKeyAuth({
    name: "DeepInfra API key",
    prompt: "DeepInfra API key",
    source: "DEEPINFRA_TOKEN",
    getApiKey: getDeepinfraApiKey,
});
//# sourceMappingURL=deepinfra-auth.js.map