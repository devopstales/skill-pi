/** Native API-key authentication for Ollama Cloud. */
import { getOllamaApiKey } from "../../config.js";
async function resolveOllamaApiKey(input) {
    const key = input.credential?.key ?? getOllamaApiKey();
    if (!key)
        return undefined;
    return {
        auth: { apiKey: key },
        source: input.credential?.key ? "stored API key" : "OLLAMA_API_KEY",
    };
}
const ollamaApiKeyAuth = {
    name: "Ollama Cloud API key",
    async login(interaction) {
        const key = await interaction.prompt({
            type: "secret",
            message: "Ollama Cloud API key",
        });
        return { type: "api_key", key };
    },
    resolve: resolveOllamaApiKey,
};
export const ollamaAuth = {
    apiKey: ollamaApiKeyAuth,
};
//# sourceMappingURL=ollama-auth.js.map