/**
 * Cline native provider — the createProvider object form.
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
 *       allowNetwork:true  → fetch the PUBLIC catalog (no credential needed),
 *                            persist via context.store.write, honor context.signal
 *
 * Wire api: Cline's endpoint (https://api.cline.bot/api/v1/chat/completions)
 * speaks vanilla OpenAI Chat Completions, so models use the standard
 * `"openai-completions"` api and both `stream`/`streamSimple` delegate to the
 * lazy compat bridge (`lazyOpenAICompletionsApi()`), like every other
 * OpenAI-compatible native provider. The Cline identity headers (including the
 * rotating `X-Task-ID`) live on a single shared mutable record (see
 * cline-headers.ts); pi-ai merges only the MODEL's `headers` into requests
 * (`Models.getAuth`), so the record is stamped on every Cline model — and
 * `rotateClineTaskId()` keeps working by mutating that same object, no
 * re-registration needed.
 *
 * Public catalog: the model list needs no credential, so `refreshModels`
 * fetches without `context.credential`. (Cline's auth resolves even when
 * unconfigured — see cline-auth.ts — so Pi still drives refresh for
 * logged-out users, preserving the legacy "models before /login" behavior.)
 *
 * Stored-store migration: users' model stores contain models with the retired
 * `cline-xml-tools` api until their next successful network refresh. Restore
 * normalizes those entries to `openai-completions` + the Cline baseUrl so the
 * first session after upgrade dispatches a real api.
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
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.js";
import { createLogger } from "../../lib/logger.js";
import { isFreeModel } from "../../lib/registry.js";
import { filterNativeModels, refreshNativeProviderModels, } from "../../lib/native-provider.js";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.js";
import { enhanceWithCI } from "../../provider-helper.js";
import { clineAuth } from "./cline-auth.js";
import { buildClineHeaders, getClineProviderHeaders, rotateClineTaskId, } from "./cline-headers.js";
import { fetchClineCatalog, toClineModels } from "./cline-models.js";
const _logger = createLogger("cline-provider");
/** Api Cline models used before the OpenAI-compatible migration (#433). */
export const LEGACY_CLINE_API = "cline-xml-tools";
/** Mn2 (#437): warn once per process when legacy-api store entries are normalized. */
let _clineNormalizeWarned = false;
/** Test seam: reset the once-per-process normalize warning (mirrors the compat-loader seam). */
export function __resetClineNormalizeWarnForTests() {
    _clineNormalizeWarned = false;
}
// Cline identity headers now live in cline-headers.ts; this module re-exports
// the two public accessors so existing imports keep working.
export { buildClineHeaders, rotateClineTaskId };
/**
 * Normalize models restored from Pi's models store. Until the next successful
 * network refresh, users' stores still contain models with the retired
 * `cline-xml-tools` api; rewrite those to `openai-completions` + the Cline
 * baseUrl so the first session after upgrade dispatches a real api.
 */
export function normalizeStoredClineModels(models) {
    return models.map((model) => {
        const api = model.api;
        // SAFETY: the store widens full Model objects to ProviderModelConfig;
        // every other field passes through untouched, so restoring the native
        // Model shape is lossless apart from the two fields rewritten below.
        return {
            ...model,
            api: api === LEGACY_CLINE_API ? "openai-completions" : api,
            baseUrl: BASE_URL_CLINE,
            // Re-point at the live shared record: a restored model's serialized
            // headers would be a stale snapshot, and rotation must keep working.
            headers: getClineProviderHeaders(),
        };
    });
}
/**
 * Build the Cline native provider. All mutable catalog state lives in the returned
 * closure so the extension factory can wire toggles against a single source of
 * truth.
 */
export function createClineProvider() {
    const streams = lazyOpenAICompletionsApi();
    // Display-ready catalogs (CI-enhanced + converted to Model). Typed as
    // StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle; the
    // runtime values are full Model objects, which are assignable.
    const stored = { free: [], all: [] };
    function prepare(all, free) {
        return {
            all: toClineModels(enhanceWithCI(all)),
            free: toClineModels(enhanceWithCI(free)),
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
        await refreshNativeProviderModels(PROVIDER_CLINE, context, 
        // Covers BOTH the Pi 0.84+ `context.stored` snapshot and the legacy
        // `context.store` read path (restoreNativeProviderModels branches
        // internally): rewrite retired `cline-xml-tools` entries in either.
        (storedModels) => {
            // Mn2 (#437): the cline-xml-tools → openai-completions migration is
            // silent today; warn ONCE per process when any model was normalized
            // (the store keeps legacy entries until a network refresh rewrites
            // it, so per-restore warning would spam every session).
            if (!_clineNormalizeWarned) {
                const legacyCount = storedModels.filter((model) => model.api === LEGACY_CLINE_API).length;
                if (legacyCount > 0) {
                    _clineNormalizeWarned = true;
                    _logger.warn(`Restored ${legacyCount} Cline model(s) with retired ${LEGACY_CLINE_API} api; normalized to openai-completions`, { count: legacyCount });
                }
            }
            const normalized = normalizeStoredClineModels(storedModels);
            stored.all = normalized;
            stored.free = normalized.filter((model) => isFreeModel({ ...model, provider: PROVIDER_CLINE }, normalized));
        }, async () => {
            // Online: fetch the public catalog (no credential required).
            const { all, free } = await fetchClineCatalog({
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
        id: PROVIDER_CLINE,
        name: "Cline",
        baseUrl: BASE_URL_CLINE,
        // Shared mutable record: rotateClineTaskId() mutates it in place; every
        // model carries the same object as its headers (see cline-headers.ts).
        headers: getClineProviderHeaders(),
        auth: clineAuth,
        getModels: () => (stored.all.length > 0 ? stored.all : stored.free),
        filterModels: (models) => filterNativeModels(PROVIDER_CLINE, models, {
            freeModels: stored.free,
        }),
        refreshModels,
        stream: (model, context, options) => streams.stream(model, context, options),
        streamSimple: (model, context, options) => streams.streamSimple(model, context, options),
    };
    return { provider, stored, ingest };
}
//# sourceMappingURL=cline-provider.js.map