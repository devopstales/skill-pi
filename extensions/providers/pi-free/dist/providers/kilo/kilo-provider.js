/**
 * Kilo native provider — the createProvider object form.
 *
 * Builds a pi-ai `Provider` object that pi-free registers via
 * `pi.registerProvider(provider)` (the >=0.81 single-argument overload). Pi then
 * owns credential refresh, background model refresh (4h throttle, abortable), and
 * offline initialization:
 *
 *   - native `auth` (apiKey + oauth) persisted to ~/.pi/agent/auth.json
 *   - sync `getModels()` returning the complete catalog; Pi applies `filterModels`
 *   - `refreshModels(context)`:
 *       allowNetwork:false → restore from context.store only (fast offline init)
 *       allowNetwork:true  → fetch with context.credential, persist via
 *                            context.store.write, honor context.signal
 *
 * The object is assembled directly against the public `Provider` interface (the
 * exact shape `createProvider()` returns) rather than through the `createProvider`
 * helper: that helper unconditionally merges its stored dynamic overlay on top of
 * the static baseline on every refresh. The complete catalog stays in
 * `getModels()` and the shared `filterModels` policy selects the current view
 * while still using the native store and auth.
 *
 * Pi owns refresh throttling and the `force` flag (`pi update --models`); this
 * module performs no freshness gating of its own so the two never double-throttle.
 */
import { getKiloApiKey, getKiloFreeOnly } from "../../config.js";
import { PROVIDER_KILO } from "../../constants.js";
import { isFreeModel } from "../../lib/registry.js";
import { filterNativeModels, refreshNativeProviderModels, } from "../../lib/native-provider.js";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.js";
import { enhanceWithCI } from "../../provider-helper.js";
import { kiloAuth } from "./kilo-auth.js";
import { applyKiloCompat, fetchKiloCatalog, KILO_GATEWAY_BASE, normalizeStoredKiloModels, toKiloModels, } from "./kilo-models.js";
/** Resolve the bearer token from the effective credential Pi passes us. */
function credentialToken(credential) {
    if (!credential)
        return getKiloApiKey();
    if (credential.type === "oauth")
        return credential.access;
    if (credential.type === "api_key")
        return credential.key ?? getKiloApiKey();
    return getKiloApiKey();
}
/**
 * Build the Kilo native provider. All mutable catalog state lives in the returned
 * closure so the extension factory can wire toggles against a single source of
 * truth.
 */
export function createKiloProvider() {
    const streams = lazyOpenAICompletionsApi();
    // Display-ready catalogs (CI-enhanced + compat-shaped + converted to Model).
    // Typed as StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle;
    // the runtime values are full Model objects, which are assignable.
    const stored = { free: [], all: [] };
    function prepare(all, free) {
        return {
            all: toKiloModels(enhanceWithCI(applyKiloCompat(all))),
            free: toKiloModels(enhanceWithCI(applyKiloCompat(free))),
        };
    }
    function ingest(all, free) {
        const next = prepare(all, free);
        stored.all = next.all;
        stored.free = next.free;
    }
    async function refreshModels(context) {
        // Free split of the most recent fetch, kept beside the flat list the
        // shared helper passes through (see the fetch callback below).
        let fetchedFree = [];
        // Shared skeleton: restore → allowNetwork gate → abort checks → fetch →
        // empty-retain → persist, with the M1 counters recorded centrally.
        await refreshNativeProviderModels(PROVIDER_KILO, context, (storedModels) => {
            // Re-stamp identity headers — a store snapshot written before the
            // headers existed would otherwise reach the wire headerless.
            const normalized = normalizeStoredKiloModels(storedModels);
            stored.all = normalized;
            stored.free = normalized.filter((model) => isFreeModel({ ...model, provider: PROVIDER_KILO }, storedModels));
        }, async () => {
            // Online: fetch a fresh catalog with the resolved+refreshed credential.
            const { all, free } = await fetchKiloCatalog({
                token: credentialToken(context.credential),
                signal: context.signal,
            });
            const next = prepare(all, free);
            // The shared helper's fetch callback returns one flat list; keep the
            // catalog's own free split alongside it for onFetched below.
            fetchedFree = next.free;
            return next.all;
        }, (next) => {
            stored.all = next;
            stored.free = fetchedFree;
        });
    }
    const provider = {
        id: PROVIDER_KILO,
        name: "Kilo",
        baseUrl: KILO_GATEWAY_BASE,
        // Identity headers are stamped per-model (KILO_IDENTITY_HEADERS in
        // kilo-models.ts) — pi-ai merges only model.headers into requests, so
        // a provider-level block here would be silently inert.
        auth: kiloAuth,
        getModels: () => (stored.all.length > 0 ? stored.all : stored.free),
        filterModels: (models) => filterNativeModels(PROVIDER_KILO, models, {
            freeModels: stored.free,
            forceFree: getKiloFreeOnly(),
        }),
        refreshModels,
        stream: (model, context, options) => streams.stream(model, context, options),
        streamSimple: (model, context, options) => streams.streamSimple(model, context, options),
    };
    return { provider, stored, ingest };
}
//# sourceMappingURL=kilo-provider.js.map