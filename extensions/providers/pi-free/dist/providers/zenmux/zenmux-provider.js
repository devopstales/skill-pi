import { getZenmuxApiKey } from "../../config.js";
import { BASE_URL_ZENMUX, PROVIDER_ZENMUX } from "../../constants.js";
import { filterNativeModels, refreshNativeProviderModels, } from "../../lib/native-provider.js";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.js";
import { isFreeModel } from "../../lib/registry.js";
import { enhanceWithCI } from "../../provider-helper.js";
import { zenmuxAuth } from "./zenmux-auth.js";
import { fetchZenmuxCatalog, toZenmuxModels } from "./zenmux-models.js";
function credentialToken(credential) {
    if (!credential)
        return getZenmuxApiKey();
    if (credential.type === "api_key") {
        return credential.key ?? getZenmuxApiKey();
    }
    return getZenmuxApiKey();
}
export function createZenmuxProvider() {
    const streams = lazyOpenAICompletionsApi();
    const stored = { free: [], all: [] };
    function prepare(all, free) {
        return {
            all: toZenmuxModels(enhanceWithCI(all)),
            free: toZenmuxModels(enhanceWithCI(free)),
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
        await refreshNativeProviderModels(PROVIDER_ZENMUX, context, (storedModels) => {
            stored.all = storedModels;
            stored.free = storedModels.filter((model) => isFreeModel({ ...model, provider: PROVIDER_ZENMUX }, storedModels));
        }, async () => {
            const { all, free } = await fetchZenmuxCatalog({
                token: credentialToken(context.credential),
                signal: context.signal,
            });
            const next = prepare(all, free);
            fetchedFree = next.free;
            return next.all;
        }, (next) => {
            stored.all = next;
            stored.free = fetchedFree;
        });
    }
    const provider = {
        id: PROVIDER_ZENMUX,
        name: "ZenMux",
        baseUrl: BASE_URL_ZENMUX,
        headers: {
            "User-Agent": "pi-free-providers",
        },
        auth: zenmuxAuth,
        getModels: () => (stored.all.length > 0 ? stored.all : stored.free),
        filterModels: (models) => filterNativeModels(PROVIDER_ZENMUX, models, {
            freeModels: stored.free,
        }),
        refreshModels,
        stream: (model, context, options) => streams.stream(model, context, options),
        streamSimple: (model, context, options) => streams.streamSimple(model, context, options),
    };
    return { provider, stored, ingest };
}
//# sourceMappingURL=zenmux-provider.js.map