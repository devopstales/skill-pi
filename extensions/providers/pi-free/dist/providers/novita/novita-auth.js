import { getNovitaApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const novitaAuth = createNativeApiKeyAuth({
    name: "Novita API key",
    prompt: "Novita API key",
    source: "NOVITA_API_KEY",
    getApiKey: getNovitaApiKey,
});
//# sourceMappingURL=novita-auth.js.map