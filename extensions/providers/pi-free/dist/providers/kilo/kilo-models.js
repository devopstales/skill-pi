/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */
import { applyHidden } from "../../config.js";
import { PROVIDER_KILO } from "../../constants.js";
import { isFreeModel } from "../../lib/registry.js";
import { withGatewayCompat } from "../../lib/native-provider.js";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.js";
const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;
/**
 * Honest pi-free identity headers, stamped on every Kilo model. pi-ai merges
 * only the MODEL's headers into requests (not provider.headers), so the
 * provider-level block was inert; see toKiloModel(). The genuine Kilo client
 * sends "Kilo CLI" / "opencode-kilo-provider" — adopting that identity is
 * tracked in the repo issue tracker; the gateway treats these as attribution
 * metadata and accepts requests without them.
 */
const KILO_IDENTITY_HEADERS = Object.freeze({
    "X-KILOCODE-EDITORNAME": "Pi",
    "User-Agent": "pi-free-providers",
});
// =============================================================================
// Compat shaping
// =============================================================================
/** Kilo Gateway compat overrides, borrowed from pi-kilo-provider. */
const KILO_COMPAT = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    supportsStrictMode: false,
    thinkingFormat: "openrouter",
    maxTokensField: "max_tokens",
};
/** Apply Kilo-specific compat overrides while preserving provider/model values. */
export function applyKiloCompat(models) {
    return models.map((m) => ({
        ...m,
        compat: {
            ...KILO_COMPAT,
            ...m.compat,
        },
    }));
}
// =============================================================================
// Fetch
// =============================================================================
async function fetchKiloModels(options) {
    const models = await fetchOpenRouterCompatibleModels({
        providerId: PROVIDER_KILO,
        baseUrl: KILO_GATEWAY_BASE,
        apiKey: options?.token,
        freeOnly: options?.freeOnly,
    });
    return applyHidden(models, PROVIDER_KILO);
}
/**
 * Fetch the full Kilo catalog (CI-enhanced + compat-shaped), falling back to a
 * free-only fetch when the authenticated catalog is unavailable. Returns the
 * catalog split into `{ all, free }` using the shared adaptive free detection.
 *
 * Never throws: on a total failure both arrays are empty so callers can register
 * an empty (dynamic) provider and recover on a later refresh.
 */
export async function fetchKiloCatalog(options) {
    let all;
    try {
        all = await fetchKiloModels({ token: options?.token, freeOnly: false });
    }
    catch {
        try {
            all = await fetchKiloModels({ token: options?.token, freeOnly: true });
        }
        catch {
            all = [];
        }
    }
    if (options?.signal?.aborted) {
        return { all: [], free: [] };
    }
    const free = all.filter((m) => isFreeModel({ ...m, provider: PROVIDER_KILO }, all));
    return { all, free };
}
// =============================================================================
// Mapping to pi-ai Model
// =============================================================================
/**
 * Convert a fetched/mapped ProviderModelConfig into the concrete pi-ai
 * `Model<"openai-completions">` shape a native provider's getModels() returns.
 * Adds the provider id, wire api, and gateway baseUrl that the legacy
 * registerProvider config form used to supply implicitly.
 */
function toKiloModel(m) {
    return withGatewayCompat({
        ...m,
        api: "openai-completions",
        provider: PROVIDER_KILO,
        baseUrl: m.baseUrl ?? KILO_GATEWAY_BASE,
        headers: KILO_IDENTITY_HEADERS,
    });
}
/**
 * Re-stamp identity headers on models restored from Pi's models store — a
 * store snapshot written before the headers existed (or by another client)
 * would otherwise reach the wire headerless (same pattern as Cline's
 * normalizeStoredClineModels).
 */
export function normalizeStoredKiloModels(models) {
    return models.map((m) => ({ ...m, headers: KILO_IDENTITY_HEADERS }));
}
/** Convert a batch of model configs to native Model objects. */
export function toKiloModels(models) {
    return models.map(toKiloModel);
}
//# sourceMappingURL=kilo-models.js.map