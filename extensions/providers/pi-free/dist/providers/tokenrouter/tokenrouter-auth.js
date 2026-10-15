/** Native API-key authentication for TokenRouter. */
import { getTokenrouterApiKey } from "../../config.js";
async function resolveTokenRouterApiKey(input) {
    const key = input.credential?.key ?? getTokenrouterApiKey();
    if (!key)
        return undefined;
    return {
        auth: { apiKey: key },
        source: input.credential?.key ? "stored API key" : "TOKENROUTER_API_KEY",
    };
}
const tokenRouterApiKeyAuth = {
    name: "TokenRouter API key",
    async login(interaction) {
        const key = await interaction.prompt({
            type: "secret",
            message: "TokenRouter API key",
        });
        return { type: "api_key", key };
    },
    resolve: resolveTokenRouterApiKey,
};
export const tokenRouterAuth = {
    apiKey: tokenRouterApiKeyAuth,
};
//# sourceMappingURL=tokenrouter-auth.js.map