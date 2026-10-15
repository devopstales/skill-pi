/**
 * Qoder native Provider implementation.
 *
 * Qoder's catalog is a static curated list because its former catalog endpoint
 * is unavailable. Pi owns the models-store lifecycle: offline refresh restores
 * the last catalog, while an allowed online refresh republishes the static
 * catalog and persists it. No legacy cache freshness or startup network work is
 * performed here.
 */
import { BASE_URL_QODER, PROVIDER_QODER } from "../../constants.js";
import { filterNativeModels, refreshNativeProviderModels, } from "../../lib/native-provider.js";
import { enhanceWithCI } from "../../provider-helper.js";
import { qoderAuth } from "./auth.js";
import { isQoderFreeModel, staticModels } from "./models.js";
import { streamQoder } from "./stream.js";
function toQoderModel(model) {
    return {
        ...model,
        api: "qoder-api",
        provider: PROVIDER_QODER,
        baseUrl: BASE_URL_QODER,
    };
}
function toQoderModels(models) {
    return models.map(toQoderModel);
}
function staticCatalog() {
    const all = toQoderModels(enhanceWithCI(staticModels, PROVIDER_QODER));
    return { all, free: all.filter((model) => isQoderFreeModel(model)) };
}
export function createQoderProvider() {
    const stored = { free: [], all: [] };
    function ingest(all) {
        const models = toQoderModels(enhanceWithCI(all, PROVIDER_QODER));
        stored.all = models;
        stored.free = models.filter((model) => isQoderFreeModel(model));
    }
    const initial = staticCatalog();
    stored.all = initial.all;
    stored.free = initial.free;
    async function refreshModels(context) {
        // Shared skeleton: restore → allowNetwork gate → abort checks → fetch →
        // empty-retain → persist, with the M1 counters recorded centrally.
        await refreshNativeProviderModels(PROVIDER_QODER, context, (storedModels) => {
            stored.all = storedModels;
            stored.free = storedModels.filter((model) => isQoderFreeModel(model));
        }, async () => {
            // Qoder has no supported catalog endpoint. Re-publish the curated
            // catalog through Pi's store instead of maintaining a second
            // cache/freshness policy.
            return staticCatalog().all;
        }, (catalog) => {
            stored.all = catalog;
            stored.free = catalog.filter((model) => isQoderFreeModel(model));
        });
    }
    const provider = {
        id: PROVIDER_QODER,
        name: "Qoder",
        baseUrl: BASE_URL_QODER,
        headers: { "User-Agent": "pi-free-providers" },
        auth: qoderAuth,
        getModels: () => (stored.all.length > 0 ? stored.all : stored.free),
        filterModels: (models) => filterNativeModels(PROVIDER_QODER, models, {
            freeModels: stored.free,
        }),
        refreshModels,
        stream: (model, context, options) => streamQoder(model, context, options),
        streamSimple: (model, context, options) => streamQoder(model, context, options),
    };
    return { provider, stored, ingest };
}
//# sourceMappingURL=qoder-provider.js.map