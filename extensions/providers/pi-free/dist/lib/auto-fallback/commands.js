/**
 * Slash-command surface for auto-fallback.
 *
 * Registers three commands on the ExtensionAPI (Q17 = B):
 *
 *   - `/toggle-auto-fallback`  — flip the on/off switch (persists).
 *   - `/free-fallback-history` — show this-session switch log.
 *   - `/reset-fallback-blacklist` — clear the in-memory blacklist.
 *
 * Command registration is decoupled from the {@link createAutoFallback}
 * factory so tests can drive commands without standing up the full
 * auto-fallback pipeline.
 */
import { saveConfig } from "../../config.js";
import { getAutoFallbackConfig } from "./config.js";
export function registerAutoFallbackCommands(pi, deps) {
    pi.registerCommand("toggle-auto-fallback", {
        description: "Toggle automatic fallback to another free model when the current one errors",
        handler: async (_args, ctx) => {
            const cfg = getAutoFallbackConfig();
            const next = !cfg.enabled;
            // Persist synchronously (saveConfig is async but the handler
            // signature is async — we await it so the on-disk state matches
            // the toast before the user takes another action).
            await saveConfig({ auto_fallback: next });
            ctx.ui.notify(next
                ? "Auto-fallback: ON — failing free models will be auto-switched"
                : "Auto-fallback: OFF", "info");
        },
    });
    pi.registerCommand("free-fallback-history", {
        description: "Show auto-fallback switch history for the current session",
        handler: async (_args, ctx) => {
            const history = deps.getHistory();
            if (history.length === 0) {
                ctx.ui.notify("No auto-fallback switches this session.", "info");
                return;
            }
            const cfg = getAutoFallbackConfig();
            const lines = ["🛟 Auto-fallback history:", ""];
            if (!cfg.enabled) {
                lines.push("(currently disabled)", "");
            }
            else if (deps.isExhausted()) {
                lines.push("(exhausted — all free candidates tried)", "");
            }
            for (const entry of history) {
                const when = formatClock(entry.at);
                const recovery = entry.recovered ? "✓ recovered" : "↻ still trying";
                lines.push(`${when}  ${entry.fromKey} → ${entry.toKey}  [${entry.reason}]  ${recovery}`);
            }
            // Include the blacklist snapshot so the user can see WHY each
            // model was excluded at the last selection.
            const blacklist = deps.blacklist.snapshot();
            if (blacklist.size > 0) {
                lines.push("", "Blacklist:");
                for (const [key, record] of blacklist) {
                    lines.push(`  ${key}: ${record.count}× (${record.reasons.join(", ") || "no reason recorded"})`);
                }
            }
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
    pi.registerCommand("reset-fallback-blacklist", {
        description: "Clear the auto-fallback in-memory blacklist (unban every model)",
        handler: async (_args, ctx) => {
            const cleared = deps.blacklist.clearAll();
            ctx.ui.notify(cleared > 0
                ? `Auto-fallback: cleared ${cleared} blacklist ${cleared === 1 ? "entry" : "entries"}`
                : "Auto-fallback: blacklist was already empty", "info");
        },
    });
}
function formatClock(ts) {
    try {
        return new Date(ts).toLocaleTimeString();
    }
    catch {
        return String(ts);
    }
}
//# sourceMappingURL=commands.js.map