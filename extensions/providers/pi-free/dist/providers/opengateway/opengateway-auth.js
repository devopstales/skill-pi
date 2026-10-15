import { getOpengatewayApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
export const opengatewayAuth = createNativeApiKeyAuth({
    name: "OpenGateway API key",
    prompt: "OpenGateway API key",
    source: "OPENGATEWAY_API_KEY",
    getApiKey: getOpengatewayApiKey,
});
//# sourceMappingURL=opengateway-auth.js.map