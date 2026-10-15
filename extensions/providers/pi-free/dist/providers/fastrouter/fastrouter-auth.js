/**
 * FastRouter native authentication.
 *
 * FastRouter's model catalog is public, so native auth must resolve even when
 * no key is configured. Chat requests still use the configured key (and the
 * gateway rejects unauthenticated requests when one is required).
 */
import { getFastrouterApiKey } from "../../config.js";
async function resolveFastrouterApiKey(input) {
    const key = input.credential?.key ?? getFastrouterApiKey();
    if (!key) {
        return { auth: {}, source: "public catalog (no account)" };
    }
    return {
        auth: { apiKey: key },
        source: input.credential?.key ? "stored API key" : "FASTROUTER_API_KEY",
    };
}
const fastrouterApiKeyAuth = {
    name: "FastRouter API key",
    async login(interaction) {
        const key = await interaction.prompt({
            type: "secret",
            message: "FastRouter API key",
        });
        return { type: "api_key", key };
    },
    resolve: resolveFastrouterApiKey,
};
export const fastrouterAuth = {
    apiKey: fastrouterApiKeyAuth,
};
//# sourceMappingURL=fastrouter-auth.js.map