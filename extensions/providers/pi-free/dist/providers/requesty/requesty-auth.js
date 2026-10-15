/**
 * Requesty native authentication.
 *
 * Without a stored credential or ambient key, resolve() returns undefined
 * and Pi hides the provider from /model (#530): the public catalog is
 * visible but chat needs a key — the gateway rejects unauthenticated
 * completions — so a logged-out listing is clutter, not discovery.
 */
import { getRequestyApiKey } from "../../config.js";
async function resolveRequestyApiKey(input) {
    const key = input.credential?.key ?? getRequestyApiKey();
    if (!key) {
        return undefined;
    }
    return {
        auth: { apiKey: key },
        source: input.credential?.key ? "stored API key" : "REQUESTY_API_KEY",
    };
}
const requestyApiKeyAuth = {
    name: "Requesty API key",
    async login(interaction) {
        const key = await interaction.prompt({
            type: "secret",
            message: "Requesty API key",
        });
        return { type: "api_key", key };
    },
    resolve: resolveRequestyApiKey,
};
export const requestyAuth = {
    apiKey: requestyApiKeyAuth,
};
//# sourceMappingURL=requesty-auth.js.map