/**
 * Merge Gateway provider extension.
 *
 * Merge (merge.dev) is a multi-vendor LLM gateway exposing an
 * OpenAI-compatible chat shim at `https://api-gateway.merge.dev/v1/openai`
 * (chat completions across ~275 chat-capable catalog entries from OpenAI,
 * Anthropic, Google, Meta, Mistral, xAI, Qwen, DeepSeek, and more).
 *
 * Endpoints:
 *   Chat:    https://api-gateway.merge.dev/v1/openai/chat/completions
 *   Models:  https://api-gateway.merge.dev/v1/models (NATIVE Gateway API)
 *
 * Discovery uses the NATIVE Gateway catalog (not the minimal OpenAI-shim
 * /models) because it carries display names, per-vendor availability,
 * context windows, output limits, capability flags, and USD-per-million
 * pricing — see merge-models.ts.
 *
 * The catalog is keyed (anonymous /models returns 401), so models only
 * appear after MERGE_API_KEY is configured; chat uses the same key.
 *
 * Free models: nvidia/nemotron-3.5-lightning-30b-a3b is published at $0/$0
 * per million via its nvidia route and classifies free via Route A pricing
 * detection (verified live 2026-08-26). Other zero-priced entries are
 * non-chat routes (video/TTS/image/embedding) and are filtered out.
 *
 * Setup:
 *   MERGE_API_KEY=mg_...
 *   # or add merge_api_key to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear in /model selector as "merge/nvidia/nemotron-..."
 */
import { getMergeApiKey, getMergeShowPaid } from "../../config.js";
import { BASE_URL_MERGE, PROVIDER_MERGE } from "../../constants.js";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.js";
import { mergeAuth } from "./merge-auth.js";
import { fetchMergeModels } from "./merge-models.js";
export default function mergeProvider(pi) {
    registerNativeOpenAIProvider(pi, {
        providerId: PROVIDER_MERGE,
        name: "Merge Gateway",
        baseUrl: BASE_URL_MERGE,
        auth: mergeAuth,
        getApiKey: getMergeApiKey,
        getShowPaid: getMergeShowPaid,
        fetchModels: (apiKey, signal) => fetchMergeModels(apiKey, signal),
    });
    return Promise.resolve();
}
//# sourceMappingURL=merge.js.map