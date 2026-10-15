/**
 * Typed configuration accessors for auto-fallback.
 *
 * Resolves the 9 optional `~/.pi/free.json` fields (Q12 = A) with the
 * repo-standard env > file precedence: every field also honors an env var
 * (`AUTO_FALLBACK`, `AUTO_FALLBACK_SCOPE`, `AUTO_FALLBACK_PROVIDERS`,
 * `AUTO_FALLBACK_BLACKLIST_TTL_MS`, `AUTO_FALLBACK_BLACKLIST_MAX`,
 * `FALLBACK_NOTIFY`, `FALLBACK_RESTORE`, `AUTO_FALLBACK_AUTO_CONTINUE`,
 * `AUTO_FALLBACK_AUTO_CONTINUE_MAX`), so headless/CI users can configure
 * the feature without touching JSON.
 *
 * Default state is OFF (`enabled: false`): an auto-switching feature that
 * rewrites the user's global default model (pi#1248 — setModel is sticky
 * and persists across sessions) must be opt-in, not silently forced on.
 *
 * Reading the config on every getter (rather than caching) means that
 * `/toggle-auto-fallback` writes and the next event handler read see
 * the same value without a cache-invalidation step.
 */
import { loadConfigFile } from "../../config.js";
import { createLogger } from "../logger.js";
const _logger = createLogger("auto-fallback");
const DEFAULTS = {
    enabled: false,
    scope: "provider",
    whitelistProviders: [],
    blacklistTtlMs: 10 * 60 * 1000,
    blacklistMaxStrikes: 3,
    notifyLevel: "toast",
    restoreMode: "manual",
    autoContinue: true,
    autoContinueMax: 3,
};
/** env > file boolean resolution (same precedence as config.ts resolveBool). */
function envBool(envKey, fileVal, fallback) {
    const raw = process.env[envKey];
    if (raw === "true")
        return true;
    if (raw === "false")
        return false;
    if (fileVal !== undefined)
        return fileVal === true;
    return fallback;
}
/** env > file number resolution. */
function envNumber(envKey, fileVal, fallback) {
    const raw = process.env[envKey];
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    return typeof fileVal === "number" && fileVal > 0 ? fileVal : fallback;
}
/** env > file string resolution. */
function envString(envKey, fileVal) {
    return (process.env[envKey] ||
        (typeof fileVal === "string" && fileVal.trim() ? fileVal.trim() : undefined));
}
/** env > file string[] resolution (comma-separated env value). */
function envStringList(envKey, fileVal) {
    const envRaw = process.env[envKey];
    if (envRaw !== undefined) {
        return envRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    if (Array.isArray(fileVal)) {
        const out = fileVal.filter((e) => typeof e === "string" && e.length > 0);
        if (out.length > 0)
            return out;
    }
    return undefined;
}
let defaultsLogged = false;
function logDefaultsOnce(_config) {
    if (defaultsLogged)
        return;
    const cfg = loadConfigFile();
    const hasAny = cfg.auto_fallback !== undefined ||
        cfg.auto_fallback_scope !== undefined ||
        cfg.auto_fallback_providers !== undefined ||
        cfg.auto_fallback_blacklist_ttl_ms !== undefined ||
        cfg.auto_fallback_blacklist_max !== undefined ||
        cfg.auto_fallback_auto_continue !== undefined ||
        cfg.auto_fallback_auto_continue_max !== undefined ||
        cfg.fallback_notify !== undefined ||
        cfg.fallback_restore !== undefined;
    if (hasAny) {
        // Once we see ANY field, future defaults resolution shouldn't spam
        // even if a later config update removes them again — we trust the
        // user has touched the feature.
        defaultsLogged = true;
    }
    else {
        _logger.info("auto_fallback: no user config found; feature stays OFF by default (opt in via /toggle-auto-fallback, auto_fallback: true, or AUTO_FALLBACK=true)");
        defaultsLogged = true;
    }
}
export function getAutoFallbackConfig() {
    const cfg = loadConfigFile();
    const result = {
        enabled: envBool("AUTO_FALLBACK", cfg.auto_fallback, DEFAULTS.enabled),
        scope: parseScope(envString("AUTO_FALLBACK_SCOPE", cfg.auto_fallback_scope)),
        whitelistProviders: parseWhitelist(envStringList("AUTO_FALLBACK_PROVIDERS", cfg.auto_fallback_providers)),
        blacklistTtlMs: envNumber("AUTO_FALLBACK_BLACKLIST_TTL_MS", cfg.auto_fallback_blacklist_ttl_ms, DEFAULTS.blacklistTtlMs),
        blacklistMaxStrikes: envNumber("AUTO_FALLBACK_BLACKLIST_MAX", cfg.auto_fallback_blacklist_max, DEFAULTS.blacklistMaxStrikes),
        notifyLevel: parseNotifyLevel(envString("FALLBACK_NOTIFY", cfg.fallback_notify)),
        restoreMode: parseRestoreMode(envString("FALLBACK_RESTORE", cfg.fallback_restore)),
        autoContinue: envBool("AUTO_FALLBACK_AUTO_CONTINUE", cfg.auto_fallback_auto_continue, DEFAULTS.autoContinue),
        autoContinueMax: envNumber("AUTO_FALLBACK_AUTO_CONTINUE_MAX", cfg.auto_fallback_auto_continue_max, DEFAULTS.autoContinueMax),
    };
    logDefaultsOnce(result);
    return result;
}
function parseScope(raw) {
    if (raw === "global" || raw === "whitelist")
        return raw;
    return DEFAULTS.scope;
}
function parseNotifyLevel(raw) {
    if (raw === "silent" ||
        raw === "toast" ||
        raw === "status_bar" ||
        raw === "both") {
        return raw;
    }
    return DEFAULTS.notifyLevel;
}
function parseRestoreMode(raw) {
    if (raw === "manual" ||
        raw === "auto_next_turn" ||
        raw === "auto_session_end") {
        return raw;
    }
    return DEFAULTS.restoreMode;
}
function parseWhitelist(raw) {
    if (!Array.isArray(raw))
        return DEFAULTS.whitelistProviders;
    const out = [];
    for (const entry of raw) {
        if (typeof entry === "string" && entry.length > 0)
            out.push(entry);
    }
    return out;
}
//# sourceMappingURL=config.js.map