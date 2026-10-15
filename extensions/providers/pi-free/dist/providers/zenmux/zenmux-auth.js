/** Native API-key authentication for ZenMux. */
import { getZenmuxApiKey } from "../../config.js";
/**
 * Without a stored credential or ambient key, resolve() returns undefined
 * and Pi hides the provider from /model (#530): a visible-but-unchattable
 * catalog is clutter, not discovery — the gateway rejects unauthenticated
 * requests, so nothing here works logged out.
 */
async function resolveZenmuxApiKey(input) {
    const key = input.credential?.key ?? getZenmuxApiKey();
    if (!key) {
        return undefined;
    }
    return {
        auth: { apiKey: key },
        source: input.credential?.key ? "stored API key" : "ZENMUX_API_KEY",
    };
}
const zenmuxApiKeyAuth = {
    name: "ZenMux API key",
    async login(interaction) {
        const key = await interaction.prompt({
            type: "secret",
            message: "ZenMux API key",
        });
        return { type: "api_key", key };
    },
    resolve: resolveZenmuxApiKey,
};
export const zenmuxAuth = {
    apiKey: zenmuxApiKeyAuth,
};
//# sourceMappingURL=zenmux-auth.js.map