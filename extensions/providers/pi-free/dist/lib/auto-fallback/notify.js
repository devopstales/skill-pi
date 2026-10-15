/**
 * Rate-limited user-facing notifications for auto-fallback.
 *
 * Implements Q31 = B: 5-minute aggregation window. If multiple switches
 * happen in the window, the user sees ONE summary toast (e.g.
 *   "Auto-fallback: tried 5 free models in last 5min, currently on X"
 * ) instead of N rapid-fire toasts. The status bar gets a persistent
 * `🛟 Fallback active` indicator that survives between switches.
 *
 * Why aggregation matters in practice: a quota outage across a provider
 * can chain through dozens of providers in seconds. Without this, the
 * user gets a notification flood.
 *
 * The notifier does NOT decide which model to switch to — only how to
 * present the decision. It is fed events from {@link createAutoFallback}
 * via `recordSwitch(...)`.
 */
import { safeNotify, safeSetStatus } from "../stale-ctx.js";
export function createNotifier(getCtx, options) {
    const windowMs = options.windowMs ?? 5 * 60 * 1000;
    const statusKey = options.statusKey ?? "fallback";
    const buffer = [];
    let windowStart = Date.now();
    let activeSince = null;
    function rotateWindow(now) {
        if (now - windowStart >= windowMs) {
            // Emit a summary for the just-closed window (if anything happened).
            emitSummary();
            buffer.length = 0;
            windowStart = now;
        }
    }
    function emitSummary() {
        if (options.level === "silent")
            return;
        if (buffer.length === 0)
            return;
        const ctx = getCtx();
        if (!ctx)
            return;
        // Distinct providers + models tried in the window.
        const triedKeys = new Set();
        for (const r of buffer) {
            triedKeys.add(r.fromKey);
            triedKeys.add(r.toKey);
        }
        const last = buffer.at(-1);
        const message = buffer.length === 1
            ? `Auto-fallback: ${last?.fromKey} → ${last?.toKey} (${last?.reason ?? "unknown"})`
            : `Auto-fallback: tried ${triedKeys.size} free models in last ${formatWindowMs(windowMs)}, currently on ${last?.toKey ?? "?"}`;
        if (options.level === "toast" || options.level === "both") {
            // Best-effort: ctx may belong to a replaced session (#509).
            safeNotify(ctx, message, "info");
        }
        // The status bar is updated by recordSwitch below — emitSummary()
        // never clears it (clearStatus is called explicitly on success).
    }
    function updateStatusBar() {
        if (options.level === "silent")
            return;
        const ctx = getCtx();
        if (!ctx)
            return;
        if (options.level === "toast")
            return;
        // "status_bar" or "both"
        const label = activeSince
            ? `🛟 Fallback active (since ${formatClock(activeSince)})`
            : "🛟 Fallback active";
        // Best-effort: ctx may belong to a replaced session (#509).
        safeSetStatus(ctx, statusKey, label);
    }
    return {
        recordSwitch(record) {
            const ctx = getCtx();
            if (!ctx)
                return;
            rotateWindow(record.at);
            buffer.push(record);
            activeSince = activeSince ?? record.at;
            updateStatusBar();
            // Toast for the FIRST switch only — subsequent switches roll
            // into the window summary. This keeps the user informed on the
            // first hit while avoiding a notification flood on sustained
            // outages. If the window closes, the next switch is a new "first".
            if (buffer.length === 1) {
                if (options.level === "toast" || options.level === "both") {
                    // Best-effort: ctx may belong to a replaced session (#509).
                    safeNotify(ctx, `Auto-fallback: ${record.fromKey} → ${record.toKey} (${record.reason})`, "info");
                }
            }
        },
        clearStatus() {
            const ctx = getCtx();
            if (!ctx)
                return;
            if (options.level !== "silent") {
                // Best-effort: ctx may belong to a replaced session (#509).
                safeSetStatus(ctx, statusKey, undefined);
            }
            activeSince = null;
            buffer.length = 0;
            windowStart = Date.now();
        },
    };
    // Unused export — suppress lint about unused parameter
    function formatClock(ts) {
        try {
            return new Date(ts).toLocaleTimeString();
        }
        catch {
            return String(ts);
        }
    }
    // (rotateWindow calls emitSummary at window close, not on every switch;
    // the buffer is also cleared on success via clearStatus.)
}
function formatWindowMs(ms) {
    if (ms < 60_000)
        return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000)
        return `${Math.round(ms / 60_000)}min`;
    return `${Math.round(ms / 3_600_000)}h`;
}
//# sourceMappingURL=notify.js.map