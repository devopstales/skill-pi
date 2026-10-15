import { getBaiApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const baiAuth = createNativeApiKeyAuth({
    name: "B.AI API key",
    prompt: "B.AI API key",
    source: "BAI_API_KEY",
    getApiKey: getBaiApiKey,
});
//# sourceMappingURL=bai-auth.js.map