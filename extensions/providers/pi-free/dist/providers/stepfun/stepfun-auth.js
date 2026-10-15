import { getStepfunApiKey } from "../../config.js";
import { createNativeApiKeyAuth } from "../../lib/native-provider.js";
/** StepFun API-key authentication for both catalog refresh and chat requests. */
export const stepfunAuth = createNativeApiKeyAuth({
    name: "StepFun API key",
    prompt: "StepFun API key",
    source: "STEPFUN_API_KEY",
    getApiKey: getStepfunApiKey,
});
//# sourceMappingURL=stepfun-auth.js.map