import { getXkiroApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const xkiroAuth = createNativeApiKeyAuth({
    name: "Xkiro API key",
    prompt: "Xkiro API key",
    source: "XKIRO_API_KEY",
    getApiKey: getXkiroApiKey,
});
//# sourceMappingURL=xkiro-auth.js.map