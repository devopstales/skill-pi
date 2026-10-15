/**
 * Ollama Cloud usage data plane: fetch and format /api/usage.
 *
 * PORTED from fgrehm/pi-ollama-cloud (`usage.ts`, MIT License,
 * Copyright (c) 2025 Fernando Grehm) — the /api/usage endpoint is
 * undocumented and could change or disappear. Self-contained: no
 * dependency on provider registration or model fetching.
 */
import { BASE_URL_OLLAMA, DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.js";
import { fetchWithRetry, withSignal } from "../../lib/util.js";
// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/** Validate a single usage limit: a 0-1 fraction plus per-model request counts. */
function isUsageLimit(data) {
    if (data == null || typeof data !== "object")
        return false;
    const d = data;
    return (typeof d.usage === "number" &&
        Array.isArray(d.models) &&
        d.models.every((m) => m != null &&
            typeof m === "object" &&
            typeof m.name === "string" &&
            typeof m.request_count === "number"));
}
/** Validate a parsed /api/usage response: must have session and weekly limits. */
function isUsageResponse(data) {
    if (data == null || typeof data !== "object")
        return false;
    const d = data;
    return (d.limits != null &&
        typeof d.limits === "object" &&
        isUsageLimit(d.limits.session) &&
        isUsageLimit(d.limits.weekly));
}
// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
/**
 * Fetch Ollama Cloud usage from the undocumented /api/usage endpoint.
 * The caller resolves the API key and passes it in.
 */
export async function fetchUsage(apiKey, signal) {
    const response = await fetchWithRetry(`${BASE_URL_OLLAMA}/api/usage`, withSignal({
        headers: { Authorization: `Bearer ${apiKey}` },
    }, signal), 1, 1_000, DEFAULT_FETCH_TIMEOUT_MS);
    if (response.status === 404) {
        throw new Error("Ollama Cloud usage failed: the /api/usage endpoint is unavailable (status 404). " +
            "It is undocumented and may have changed.");
    }
    if (!response.ok) {
        throw new Error(`Ollama Cloud usage failed with HTTP ${response.status}`);
    }
    const data = (await response.json());
    if (!isUsageResponse(data)) {
        throw new Error("Ollama Cloud usage failed: unexpected response shape from the API.");
    }
    return data;
}
// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
/** Clamp a 0-1 usage fraction to a 0-100 percentage. */
function usagePercent(usage) {
    if (!Number.isFinite(usage))
        return 0;
    return Math.min(Math.max(Math.round(usage * 100), 0), 100);
}
/** Format usage for the /ollama-cloud-usage command output. */
export function formatUsage(data) {
    const lines = ["Ollama Cloud usage:"];
    const sessionPct = usagePercent(data.limits.session.usage);
    lines.push(`  Session (5h): ${sessionPct}%`);
    for (const m of data.limits.session.models) {
        lines.push(`    - ${m.name}: ${m.request_count} request${m.request_count === 1 ? "" : "s"}`);
    }
    const weeklyPct = usagePercent(data.limits.weekly.usage);
    lines.push(`  Weekly (7d): ${weeklyPct}%`);
    for (const m of data.limits.weekly.models) {
        lines.push(`    - ${m.name}: ${m.request_count} request${m.request_count === 1 ? "" : "s"}`);
    }
    if (typeof data.activity?.cost === "string") {
        lines.push(`  Activity (4wk): $${data.activity.cost}`);
    }
    return lines.join("\n");
}
/** Render a 10-character quota bar for a 0-100 percentage. */
function quotaBar(pct) {
    const filled = Math.min(Math.max(Math.floor(pct / 10), 0), 10);
    return `▕${"█".repeat(filled)}${"░".repeat(10 - filled)}▏`;
}
/** Color a single usage segment by how close it is to the cap. */
function colorSegment(theme, label, pct) {
    const color = pct >= 80 ? "error" : pct >= 60 ? "warning" : "success";
    return theme.fg(color, `${label} ${quotaBar(pct)} ${pct}%`);
}
/**
 * Compact one-line usage for the footer status bar, colored by usage level.
 * The endpoint exposes reset periods (5h/7d) but not exact timestamps, so the
 * color reflects the usage fraction rather than pace.
 */
export function formatUsageStatusColored(theme, data) {
    const session = usagePercent(data.limits.session.usage);
    const weekly = usagePercent(data.limits.weekly.usage);
    return `${colorSegment(theme, "5h", session)} ${colorSegment(theme, "7d", weekly)}`;
}
//# sourceMappingURL=ollama-usage.js.map