/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi/free.json
 *
 * All exported values are getter functions so that runtime changes
 * (e.g. after toggle-{provider}) are visible immediately.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { PROVIDER_ANYAPI, PROVIDER_BAI, PROVIDER_ORCAROUTER, PROVIDER_XKIRO, PROVIDER_CLINE, PROVIDER_FASTROUTER, PROVIDER_REQUESTY, PROVIDER_STEPFUN, PROVIDER_GMI, PROVIDER_AGNES, PROVIDER_KILO, PROVIDER_OLLAMA, PROVIDER_OPENCODE, PROVIDER_OPENCODE_FREE, PROVIDER_OPENCODE_GO, PROVIDER_OPENROUTER, PROVIDER_QODER, PROVIDER_ROUTEWAY, PROVIDER_OPENGATEWAY, PROVIDER_TOKENROUTER, PROVIDER_ZENMUX, PROVIDER_LLM7, PROVIDER_DEEPINFRA, PROVIDER_SAMBANOVA, PROVIDER_NOVITA, PROVIDER_VENICE, PROVIDER_INFRON, PROVIDER_MERGE, PROVIDER_COMMANDCODE, } from "./constants.js";
// SAFETY: This re-export is intentional — every provider module imports its
// `PROVIDER_*` constant via `from "../../config.ts"` (see providers/kilo/kilo.ts,
// providers/gmi/gmi.ts, etc.). Collapsing the import path into a single barrel
// here keeps the import surface stable when constants move, and avoids forcing
// every provider to add a second import line for `./constants.ts`. The cost
// is that this file looks like a barrel — it isn't; it's the single source of
// truth for runtime config (env vars, ~/.pi/free.json resolution, defaults)
// and the provider-id constants happen to live alongside it.
// Only CLINE and KILO are re-exported — they are the two ids consumed from
// this module (kilo.ts, tests/config.test.ts); everything else imports from
// ./constants.ts directly.
export { PROVIDER_CLINE, PROVIDER_KILO } from "./constants.js";
import { createLogger } from "./lib/logger.js";
import { ensureDir, PI_DATA_DIR, resolveAgentDir } from "./lib/paths.js";
function safeJsonReviver(_key, value) {
    if (_key === "__proto__" || _key === "constructor") {
        return undefined;
    }
    return value;
}
const _logger = createLogger("config");
const CONFIG_TEMPLATE = {
    nvidia_api_key: "",
    ollama_api_key: "",
    zenmux_api_key: "",
    llm7_api_key: "",
    deepinfra_api_key: "",
    sambanova_api_key: "",
    novita_api_key: "",
    venice_api_key: "",
    infron_api_key: "",
    merge_api_key: "",
    commandcode_api_key: "",
    routeway_api_key: "",
    opengateway_api_key: "",
    fastrouter_api_key: "",
    requesty_api_key: "",
    stepfun_api_key: "",
    gmi_api_key: "",
    agnes_api_key: "",
    tokenrouter_api_key: "",
    anyapi_api_key: "",
    bai_api_key: "",
    orcarouter_api_key: "",
    xkiro_api_key: "",
    kilo_api_key: "",
    cline_api_key: "",
    kilo_free_only: false,
    hidden_models: [],
    free_only: true,
    kilo_show_paid: false,
    ollama_show_paid: false,
    cline_show_paid: false,
    zenmux_show_paid: false,
    llm7_show_paid: false,
    deepinfra_show_paid: false,
    sambanova_show_paid: false,
    novita_show_paid: false,
    venice_show_paid: false,
    infron_show_paid: false,
    merge_show_paid: false,
    commandcode_show_paid: false,
    routeway_show_paid: false,
    opengateway_show_paid: false,
    fastrouter_show_paid: false,
    requesty_show_paid: false,
    stepfun_show_paid: true,
    gmi_show_paid: true,
    agnes_show_paid: false,
    tokenrouter_show_paid: false,
    anyapi_show_paid: false,
    bai_show_paid: false,
    orcarouter_show_paid: false,
    xkiro_show_paid: false,
    openrouter_show_paid: false,
    opencode_show_paid: false,
    opencode_free_show_paid: false,
    opencode_go_show_paid: false,
    qoder_show_paid: false,
    // Auto-fallback defaults (lib/auto-fallback/config.ts reads these).
    auto_fallback: false,
    auto_fallback_scope: "provider",
    auto_fallback_providers: [],
    auto_fallback_blacklist_ttl_ms: 600000, // 10 minutes
    auto_fallback_blacklist_max: 3,
    fallback_notify: "toast",
    fallback_restore: "manual",
    // Legacy-host bridge is opt-in (see oh_my_pi_compat above).
    oh_my_pi_compat: false,
};
const CONFIG_PATH = join(PI_DATA_DIR, "free.json");
// Memoize the parsed config: re-read+parse only when the file's mtime changes.
// loadConfigFile() is called on every config getter (dozens of times at
// startup); this avoids repeated readFileSync + JSON.parse of the same file.
// Every write path uses writeFileSync (which bumps mtime), so the mtime check
// auto-invalidates after saveConfig()/updateConfig()/ensureConfigFile().
let cachedConfig = null;
let cachedConfigMtime = -1;
function ensureConfigFile() {
    try {
        ensureDir(PI_DATA_DIR);
        if (existsSync(CONFIG_PATH)) {
            let existing;
            try {
                existing = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
            }
            catch {
                // File exists but is corrupt — back it up and write a fresh
                // template so the extension can start. The original bytes are
                // preserved in the timestamped backup for recovery.
                backupCorruptConfigFile();
                writeFileSync(CONFIG_PATH, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, "utf8");
                restrictConfigFilePermissions();
                _logger.warn("Config file was corrupt and has been reset from template; backup preserved", { path: CONFIG_PATH });
                return;
            }
            // Always tighten permissions on startup, even if contents are
            // unchanged — older installs may have a world-readable file.
            restrictConfigFilePermissions();
            // Merge with template to add any missing keys, preserving existing values
            const merged = { ...CONFIG_TEMPLATE, ...existing };
            if (JSON.stringify(merged) !== JSON.stringify(existing)) {
                writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
                restrictConfigFilePermissions();
            }
        }
        else {
            writeFileSync(CONFIG_PATH, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, "utf8");
            restrictConfigFilePermissions();
        }
    }
    catch (err) {
        _logger.warn("Could not create config file", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
/**
 * Restrict `~/.pi/free.json` to owner read/write (0600). The file may
 * contain API keys for paid providers, so it must never be world-readable.
 * Best-effort: if chmod is not supported on the platform/filesystem,
 * log a warning and continue (the keys are still safe inside the user's
 * home directory).
 */
function restrictConfigFilePermissions() {
    try {
        chmodSync(CONFIG_PATH, 0o600);
    }
    catch (err) {
        _logger.warn("Could not restrict config file permissions to 0600", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
function backupCorruptConfigFile() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${CONFIG_PATH}.bak-${timestamp}`;
        copyFileSync(CONFIG_PATH, backupPath);
        restrictConfigFilePermissionsForPath(backupPath);
        _logger.warn("Config file is corrupt; a backup was created before the next write.", { path: CONFIG_PATH, backupPath });
    }
    catch (err) {
        _logger.warn("Could not back up corrupt config file", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
function restrictConfigFilePermissionsForPath(path) {
    try {
        chmodSync(path, 0o600);
    }
    catch (err) {
        _logger.warn("Could not restrict config backup permissions to 0600", {
            path,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
export function loadConfigFile() {
    // Return the memoized parse when the file hasn't changed on disk.
    // Use a single stat result for both the hit check and the cached mtime to
    // reduce the TOCTOU window between the check and the read.
    let mtime;
    try {
        mtime = statSync(CONFIG_PATH).mtimeMs;
        if (cachedConfig !== null && mtime === cachedConfigMtime) {
            // Return a frozen copy so callers cannot mutate the shared cache.
            return Object.freeze(cachedConfig);
        }
    }
    catch {
        // stat failed (e.g. file removed) — fall through to read+parse below
        cachedConfig = null;
    }
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"), safeJsonReviver);
        cachedConfig = parsed;
        cachedConfigMtime = mtime ?? -1;
        return Object.freeze(parsed);
    }
    catch (err) {
        cachedConfig = null;
        cachedConfigMtime = -1;
        if (err instanceof SyntaxError) {
            backupCorruptConfigFile();
            _logger.warn("Config file is corrupt (invalid JSON) — returning empty config; a backup was created", {
                path: CONFIG_PATH,
                error: err.message,
            });
        }
        else {
            _logger.error("Could not read config file — returning empty config", {
                path: CONFIG_PATH,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return Object.freeze({});
    }
}
/**
 * Read the raw config file content without merging with template.
 * Returns the file content as string, or undefined if unreadable.
 */
function readRawConfigFile() {
    try {
        return readFileSync(CONFIG_PATH, "utf8");
    }
    catch (err) {
        _logger.warn("Could not read config file", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
    }
}
ensureConfigFile();
// Resolve each value: env var takes priority over config file.
function resolve(envKey, fileVal) {
    return process.env[envKey] || (fileVal?.trim() ? fileVal : undefined);
}
// Resolve boolean flag: env var takes priority, then config file.
function resolveBool(envKey, fileVal) {
    const envValue = process.env[envKey];
    if (envValue === "true")
        return true;
    if (envValue === "false")
        return false;
    return fileVal === true;
}
const PROVIDER_META = [
    { id: PROVIDER_KILO, prefix: "KILO", showPaidKey: "kilo_show_paid" },
    { id: PROVIDER_CLINE, prefix: "CLINE", showPaidKey: "cline_show_paid" },
    { id: PROVIDER_ZENMUX, prefix: "ZENMUX", showPaidKey: "zenmux_show_paid" },
    { id: PROVIDER_LLM7, prefix: "LLM7", showPaidKey: "llm7_show_paid" },
    {
        id: PROVIDER_DEEPINFRA,
        prefix: "DEEPINFRA",
        showPaidKey: "deepinfra_show_paid",
    },
    {
        id: PROVIDER_SAMBANOVA,
        prefix: "SAMBANOVA",
        showPaidKey: "sambanova_show_paid",
    },
    { id: PROVIDER_NOVITA, prefix: "NOVITA", showPaidKey: "novita_show_paid" },
    { id: PROVIDER_VENICE, prefix: "VENICE", showPaidKey: "venice_show_paid" },
    { id: PROVIDER_INFRON, prefix: "INFRON", showPaidKey: "infron_show_paid" },
    { id: PROVIDER_MERGE, prefix: "MERGE", showPaidKey: "merge_show_paid" },
    {
        id: PROVIDER_COMMANDCODE,
        prefix: "COMMANDCODE",
        showPaidKey: "commandcode_show_paid",
    },
    {
        id: PROVIDER_ROUTEWAY,
        prefix: "ROUTEWAY",
        showPaidKey: "routeway_show_paid",
    },
    {
        id: PROVIDER_OPENGATEWAY,
        prefix: "OPENGATEWAY",
        showPaidKey: "opengateway_show_paid",
    },
    {
        id: PROVIDER_TOKENROUTER,
        prefix: "TOKENROUTER",
        showPaidKey: "tokenrouter_show_paid",
    },
    { id: PROVIDER_ANYAPI, prefix: "ANYAPI", showPaidKey: "anyapi_show_paid" },
    { id: PROVIDER_BAI, prefix: "BAI", showPaidKey: "bai_show_paid" },
    {
        id: PROVIDER_ORCAROUTER,
        prefix: "ORCAROUTER",
        showPaidKey: "orcarouter_show_paid",
    },
    { id: PROVIDER_XKIRO, prefix: "XKIRO", showPaidKey: "xkiro_show_paid" },
    {
        id: PROVIDER_FASTROUTER,
        prefix: "FASTROUTER",
        showPaidKey: "fastrouter_show_paid",
    },
    {
        id: PROVIDER_REQUESTY,
        prefix: "REQUESTY",
        showPaidKey: "requesty_show_paid",
    },
    {
        id: PROVIDER_STEPFUN,
        prefix: "STEPFUN",
        showPaidKey: "stepfun_show_paid",
    },
    {
        id: PROVIDER_GMI,
        prefix: "GMI",
        showPaidKey: "gmi_show_paid",
    },
    {
        id: PROVIDER_AGNES,
        prefix: "AGNES",
        showPaidKey: "agnes_show_paid",
    },
    { id: PROVIDER_OLLAMA, prefix: "OLLAMA", showPaidKey: "ollama_show_paid" },
    {
        id: PROVIDER_OPENROUTER,
        prefix: "OPENROUTER",
        showPaidKey: "openrouter_show_paid",
    },
    {
        id: PROVIDER_OPENCODE,
        prefix: "OPENCODE",
        showPaidKey: "opencode_show_paid",
    },
    {
        id: PROVIDER_OPENCODE_FREE,
        prefix: "OPENCODE_FREE",
        showPaidKey: "opencode_free_show_paid",
    },
    {
        id: PROVIDER_OPENCODE_GO,
        prefix: "OPENCODE_GO",
        showPaidKey: "opencode_go_show_paid",
    },
    { id: PROVIDER_QODER, prefix: "QODER", showPaidKey: "qoder_show_paid" },
];
const PROVIDER_META_BY_ID = new Map(PROVIDER_META.map((m) => [m.id, m]));
/**
 * Generic show_paid resolver backed by PROVIDER_META. Returns false
 * for unknown provider IDs (matches the previous switch default).
 */
function resolveShowPaidForProvider(providerId) {
    const meta = PROVIDER_META_BY_ID.get(providerId);
    if (!meta)
        return false;
    const cfg = loadConfigFile();
    const fileVal = cfg[meta.showPaidKey];
    return resolveBool(`${meta.prefix}_SHOW_PAID`, fileVal);
}
export function getModelViewOverride(providerId) {
    const explicit = loadConfigFile().model_view_overrides?.[providerId];
    if (explicit === "free" || explicit === "all")
        return explicit;
    const meta = PROVIDER_META_BY_ID.get(providerId);
    if (!meta)
        return undefined;
    const envVal = process.env[`${meta.prefix}_SHOW_PAID`];
    if (envVal === "true")
        return "all";
    if (envVal === "false")
        return "free";
    if (loadConfigFile()[meta.showPaidKey] === true)
        return "all";
    return undefined;
}
/**
 * Record an explicit per-provider view choice. Merges into the sparse
 * `model_view_overrides` map (never clobbers other providers' choices —
 * saveConfig's shallow merge would) and drops the provider's legacy
 * `{id}_show_paid` key so two sources can never disagree afterwards.
 * Serialised through updateConfig's lock like every other RMW write.
 */
export async function setModelViewOverride(providerId, view) {
    const meta = PROVIDER_META_BY_ID.get(providerId);
    await updateConfig((current) => {
        const patch = {
            model_view_overrides: {
                ...current.model_view_overrides,
                [providerId]: view,
            },
        };
        // Erase the legacy snake_case key alongside the sparse-map write
        // so the two representations can never disagree (explicit branch
        // instead of a conditional spread).
        if (meta)
            patch[meta.showPaidKey] = undefined;
        return patch;
    });
}
/**
 * Delete every per-provider view choice — the sparse map plus all legacy
 * `{id}_show_paid` keys — so every provider follows the global free-only
 * default again. Used by /toggle-free: without this, a stale explicit
 * choice keeps fighting the global flag on every new session (#510).
 * JSON.stringify drops undefined values, so the merged write removes the
 * keys from free.json; the mtime bump invalidates the memoized parse.
 */
export async function clearModelViewOverrides() {
    const cleared = { model_view_overrides: undefined };
    for (const meta of PROVIDER_META_BY_ID.values()) {
        cleared[meta.showPaidKey] = undefined;
    }
    await saveConfig(cleared);
}
// =============================================================================
// Per-provider paid-model flags (getters so toggles reflect immediately)
// =============================================================================
export function getKiloShowPaid() {
    return resolveBool("KILO_SHOW_PAID", loadConfigFile().kilo_show_paid);
}
export function getClineShowPaid() {
    return resolveBool("CLINE_SHOW_PAID", loadConfigFile().cline_show_paid);
}
export function getZenmuxShowPaid() {
    return resolveBool("ZENMUX_SHOW_PAID", loadConfigFile().zenmux_show_paid);
}
export function getLlm7ShowPaid() {
    return resolveBool("LLM7_SHOW_PAID", loadConfigFile().llm7_show_paid);
}
export function getDeepinfraShowPaid() {
    // Default to the free-only view like every other public-catalog freemium
    // provider (Novita has the same trial-credit posture and defaults free).
    return resolveBool("DEEPINFRA_SHOW_PAID", loadConfigFile().deepinfra_show_paid);
}
export function getSambanovaShowPaid() {
    return resolveBool("SAMBANOVA_SHOW_PAID", loadConfigFile().sambanova_show_paid);
}
export function getNovitaShowPaid() {
    return resolveBool("NOVITA_SHOW_PAID", loadConfigFile().novita_show_paid);
}
export function getVeniceShowPaid() {
    return resolveBool("VENICE_SHOW_PAID", loadConfigFile().venice_show_paid);
}
export function getInfronShowPaid() {
    return resolveBool("INFRON_SHOW_PAID", loadConfigFile().infron_show_paid);
}
export function getMergeShowPaid() {
    return resolveBool("MERGE_SHOW_PAID", loadConfigFile().merge_show_paid);
}
export function getCommandCodeShowPaid() {
    return resolveBool("COMMANDCODE_SHOW_PAID", loadConfigFile().commandcode_show_paid);
}
export function getRoutewayShowPaid() {
    return resolveBool("ROUTEWAY_SHOW_PAID", loadConfigFile().routeway_show_paid);
}
export function getOpengatewayShowPaid() {
    return resolveBool("OPENGATEWAY_SHOW_PAID", loadConfigFile().opengateway_show_paid);
}
export function getTokenrouterShowPaid() {
    return resolveBool("TOKENROUTER_SHOW_PAID", loadConfigFile().tokenrouter_show_paid);
}
export function getAnyapiShowPaid() {
    return resolveBool("ANYAPI_SHOW_PAID", loadConfigFile().anyapi_show_paid);
}
export function getBaiShowPaid() {
    return resolveBool("BAI_SHOW_PAID", loadConfigFile().bai_show_paid);
}
export function getOrcarouterShowPaid() {
    return resolveBool("ORCAROUTER_SHOW_PAID", loadConfigFile().orcarouter_show_paid);
}
export function getXkiroShowPaid() {
    return resolveBool("XKIRO_SHOW_PAID", loadConfigFile().xkiro_show_paid);
}
export function getFastrouterShowPaid() {
    return resolveBool("FASTROUTER_SHOW_PAID", loadConfigFile().fastrouter_show_paid);
}
export function getRequestyShowPaid() {
    return resolveBool("REQUESTY_SHOW_PAID", loadConfigFile().requesty_show_paid);
}
export function getStepfunShowPaid() {
    return resolveBool("STEPFUN_SHOW_PAID", loadConfigFile().stepfun_show_paid ?? true);
}
export function getGmiShowPaid() {
    return resolveBool("GMI_SHOW_PAID", loadConfigFile().gmi_show_paid ?? true);
}
export function getAgnesShowPaid() {
    return resolveBool("AGNES_SHOW_PAID", loadConfigFile().agnes_show_paid);
}
export function getOllamaShowPaid() {
    return resolveBool("OLLAMA_SHOW_PAID", loadConfigFile().ollama_show_paid);
}
export function getOpenrouterShowPaid() {
    return resolveBool("OPENROUTER_SHOW_PAID", loadConfigFile().openrouter_show_paid);
}
export function getOpencodeShowPaid() {
    return resolveBool("OPENCODE_SHOW_PAID", loadConfigFile().opencode_show_paid);
}
export function getOpencodeFreeShowPaid() {
    return resolveBool("OPENCODE_FREE_SHOW_PAID", loadConfigFile().opencode_free_show_paid);
}
export function getOpencodeGoShowPaid() {
    return resolveBool("OPENCODE_GO_SHOW_PAID", loadConfigFile().opencode_go_show_paid);
}
export function getProviderShowPaid(providerId) {
    return resolveShowPaidForProvider(providerId);
}
// =============================================================================
// Global free-only mode
// =============================================================================
export function getFreeOnly() {
    return resolveBool("PI_FREE_ONLY", loadConfigFile().free_only);
}
export function getKiloFreeOnly() {
    return resolveBool("PI_FREE_KILO_FREE_ONLY", loadConfigFile().kilo_free_only);
}
/**
 * Force the legacy two-argument provider bridge for hosts without native
 * Provider registration (Oh My Pi). Normally unnecessary — the host is
 * auto-detected; this override covers OMP API drift and other legacy-only
 * hosts. Never enable on stock Pi.
 */
export function isOhMyPiCompat() {
    return resolveBool("OH_MY_PI_COMPAT", loadConfigFile().oh_my_pi_compat);
}
// =============================================================================
// API Keys (getters so runtime config changes are visible)
// =============================================================================
export function getNvidiaApiKey() {
    return resolve("NVIDIA_API_KEY", loadConfigFile().nvidia_api_key);
}
export function getZenmuxApiKey() {
    return resolve("ZENMUX_API_KEY", loadConfigFile().zenmux_api_key);
}
export function getLlm7ApiKey() {
    return resolve("LLM7_API_KEY", loadConfigFile().llm7_api_key);
}
export function getDeepinfraApiKey() {
    return resolve("DEEPINFRA_TOKEN", loadConfigFile().deepinfra_api_key);
}
export function getSambanovaApiKey() {
    return resolve("SAMBANOVA_API_KEY", loadConfigFile().sambanova_api_key);
}
export function getNovitaApiKey() {
    return resolve("NOVITA_API_KEY", loadConfigFile().novita_api_key);
}
export function getVeniceApiKey() {
    return resolve("VENICE_API_KEY", loadConfigFile().venice_api_key);
}
export function getInfronApiKey() {
    return resolve("INFRON_API_KEY", loadConfigFile().infron_api_key);
}
export function getMergeApiKey() {
    return resolve("MERGE_API_KEY", loadConfigFile().merge_api_key);
}
export function getCommandCodeApiKey() {
    return resolve("COMMAND_CODE_API_KEY", loadConfigFile().commandcode_api_key);
}
export function getRoutewayApiKey() {
    return resolve("ROUTEWAY_API_KEY", loadConfigFile().routeway_api_key);
}
export function getOpengatewayApiKey() {
    return resolve("OPENGATEWAY_API_KEY", loadConfigFile().opengateway_api_key);
}
export function getFastrouterApiKey() {
    return resolve("FASTROUTER_API_KEY", loadConfigFile().fastrouter_api_key);
}
export function getRequestyApiKey() {
    return resolve("REQUESTY_API_KEY", loadConfigFile().requesty_api_key);
}
export function getStepfunApiKey() {
    return resolve("STEPFUN_API_KEY", loadConfigFile().stepfun_api_key);
}
export function getGmiApiKey() {
    return resolve("GMI_API_KEY", loadConfigFile().gmi_api_key);
}
export function getAgnesApiKey() {
    return resolve("AGNES_API_KEY", loadConfigFile().agnes_api_key);
}
export function getTokenrouterApiKey() {
    return resolve("TOKENROUTER_API_KEY", loadConfigFile().tokenrouter_api_key);
}
export function getAnyapiApiKey() {
    return resolve("ANYAPI_API_KEY", loadConfigFile().anyapi_api_key);
}
export function getBaiApiKey() {
    return resolve("BAI_API_KEY", loadConfigFile().bai_api_key);
}
export function getOrcarouterApiKey() {
    return resolve("ORCAROUTER_API_KEY", loadConfigFile().orcarouter_api_key);
}
export function getXkiroApiKey() {
    return resolve("XKIRO_API_KEY", loadConfigFile().xkiro_api_key);
}
export function getKiloApiKey() {
    return resolve("KILO_API_KEY", loadConfigFile().kilo_api_key);
}
export function getClineApiKey() {
    return resolve("CLINE_API_KEY", loadConfigFile().cline_api_key);
}
export function getOllamaApiKey() {
    return resolve("OLLAMA_API_KEY", loadConfigFile().ollama_api_key);
}
/**
 * Read an API key from ~/.pi/agent/auth.json.
 * Pi stores built-in provider keys there (opencode, openrouter, etc.).
 * Falls back to env var if auth.json is missing or key not found.
 */
function readAuthJsonKey(providerId, envVar) {
    // Check env var first (fast path)
    const envVal = process.env[envVar];
    if (envVal)
        return envVal;
    // Check auth.json
    try {
        const authPath = join(resolveAgentDir(), "auth.json");
        if (!existsSync(authPath))
            return undefined;
        const raw = readFileSync(authPath, "utf8");
        const auth = JSON.parse(raw, safeJsonReviver);
        const entry = auth[providerId];
        if (entry?.key?.trim())
            return entry.key;
    }
    catch {
        // auth.json missing or corrupt — silently skip
    }
    return undefined;
}
/**
 * OpenRouter key — pi's built-in provider reads from ~/.pi/agent/auth.json.
 * pi-free checks env var first, then auth.json.
 */
export function getOpenrouterApiKey() {
    return readAuthJsonKey("openrouter", "OPENROUTER_API_KEY");
}
/** OpenCode key — pi's built-in provider. Read from env or auth.json. */
export function getOpencodeApiKey() {
    // Try "opencode-free" key first (e.g. /login opencode-free), then "opencode"
    // and "opencode-go" — all share the same Zen API key.
    return (readAuthJsonKey("opencode-free", "OPENCODE_API_KEY") ??
        readAuthJsonKey("opencode", "OPENCODE_API_KEY") ??
        readAuthJsonKey("opencode-go", "OPENCODE_API_KEY"));
}
// =============================================================================
// Hidden models (re-reads config on every call)
// =============================================================================
/**
 * Apply hidden models filter with provider scoping.
 * Hidden models can be specified as:
 *   - "model-id" (global, applies to all providers - deprecated)
 *   - "provider/model-id" (provider-specific, preferred)
 */
export function applyHidden(models, providerId) {
    const hidden = new Set(loadConfigFile().hidden_models ?? []);
    if (hidden.size === 0)
        return models;
    return models.filter((m) => {
        // Check provider-scoped ID (preferred format: "provider/model-id")
        if (providerId && hidden.has(`${providerId}/${m.id}`)) {
            return false;
        }
        // Check global ID (legacy format, still supported for backward compat)
        if (hidden.has(m.id)) {
            return false;
        }
        return true;
    });
}
// =============================================================================
// Persistence
// =============================================================================
export async function saveConfig(updates) {
    const release = await _configLock.acquire();
    try {
        // Read the raw file content — never use loadConfigFile() here because
        // if the file is unparsable, loadConfigFile() returns {} which would
        // cause us to write a partial config and WIPE all existing keys.
        const raw = readRawConfigFile();
        if (raw === undefined) {
            // File doesn't exist or can't be read — start from template
            const merged = { ...CONFIG_TEMPLATE, ...updates };
            writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
            restrictConfigFilePermissions();
            _logger.info("Config saved (new file)", {
                path: CONFIG_PATH,
                keys: Object.keys(updates),
            });
            return;
        }
        let base;
        try {
            base = JSON.parse(raw, safeJsonReviver);
        }
        catch (parseErr) {
            // File exists but is corrupt. Back it up first, then write a fresh
            // config so the user's original bytes are preserved for recovery.
            backupCorruptConfigFile();
            base = { ...CONFIG_TEMPLATE };
            _logger.warn("Config file was corrupt; a backup was created and the next save will overwrite it", {
                path: CONFIG_PATH,
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
        }
        const merged = { ...base, ...updates };
        writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        restrictConfigFilePermissions();
        _logger.info("Config saved", {
            path: CONFIG_PATH,
            keys: Object.keys(updates),
        });
    }
    catch (err) {
        _logger.error("Failed to save config", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    finally {
        release();
    }
}
/**
 * Serialise all config RMW operations to prevent concurrent updates
 * from clobbering each other (e.g. two provider probes finishing at the
 * same time both writing hidden_models and losing the other's update).
 */
class ConfigLock {
    promise = Promise.resolve();
    async acquire() {
        let release = () => { };
        const newPromise = new Promise((unlock) => {
            release = unlock;
        });
        const previous = this.promise;
        this.promise = previous.then(() => newPromise);
        await previous;
        return release;
    }
}
const _configLock = new ConfigLock();
/**
 * Atomically read-modify-write the config file. The updater function
 * receives the current parsed config and returns the partial updates to
 * merge. Concurrent calls are serialised by an internal lock.
 *
 * If the config file is corrupt, a backup is created first and the updater
 * is applied to a fresh template (the original bytes are preserved for
 * recovery).
 */
export async function updateConfig(updater) {
    const release = await _configLock.acquire();
    try {
        const raw = readRawConfigFile();
        if (raw === undefined) {
            // File doesn't exist — start from template, apply updater once
            const updated = updater({ ...CONFIG_TEMPLATE });
            const merged = { ...CONFIG_TEMPLATE, ...updated };
            writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
            restrictConfigFilePermissions();
            _logger.info("Config updated (new file)", {
                path: CONFIG_PATH,
                keys: Object.keys(updated),
            });
            return;
        }
        let existing;
        try {
            existing = JSON.parse(raw, safeJsonReviver);
        }
        catch (parseErr) {
            // File exists but is corrupt. Back it up first, then continue with
            // the template as the base so the requested update can proceed.
            backupCorruptConfigFile();
            existing = { ...CONFIG_TEMPLATE };
            _logger.warn("Config file was corrupt; a backup was created and the update will overwrite it", {
                path: CONFIG_PATH,
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
        }
        const updated = updater(existing);
        const merged = { ...existing, ...updated };
        writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        restrictConfigFilePermissions();
        _logger.info("Config updated", {
            path: CONFIG_PATH,
            keys: Object.keys(updated),
        });
    }
    catch (err) {
        _logger.error("Failed to update config", {
            path: CONFIG_PATH,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    finally {
        release();
    }
}
// =============================================================================
//# sourceMappingURL=config.js.map