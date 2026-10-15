import { saveConfig } from "../config.js";
export function createToggleState({ providerId, initialShowPaid, configKey = `${providerId}_show_paid`, save = saveConfig, initialModels, }) {
    let stored = initialModels ?? { free: [], all: [] };
    let currentMode = initialShowPaid ? "all" : "free";
    function resolveMode(mode) {
        if (mode === "all") {
            if (stored.all.length > 0) {
                return { mode: "all", models: stored.all };
            }
            return { mode: "free", models: stored.free };
        }
        // Strict: a free view with no free models resolves to an EMPTY free
        // view, never to the paid catalog. Falling back to "all" here
        // silently violated an explicit free-only choice (global or
        // per-provider): a provider with zero free models hides from the
        // picker instead of leaking paid models. Flipping to "all" stays
        // available through an explicit toggle.
        return { mode: "free", models: stored.free };
    }
    function persist(mode) {
        save({ [configKey]: mode === "all" });
    }
    function applyMode(mode, apply) {
        const resolved = resolveMode(mode);
        currentMode = resolved.mode;
        if (apply)
            apply(resolved.models);
        return resolved;
    }
    return {
        setModels(next) {
            stored = next;
            const resolved = resolveMode(currentMode);
            currentMode = resolved.mode;
            return stored;
        },
        getStored() {
            return stored;
        },
        getCurrentMode() {
            return currentMode;
        },
        getCurrentModels() {
            return resolveMode(currentMode).models;
        },
        applyCurrent(apply) {
            return applyMode(currentMode, apply);
        },
        applyMode,
        toggle(apply) {
            const nextMode = currentMode === "all" ? "free" : "all";
            const resolved = applyMode(nextMode, apply);
            persist(resolved.mode);
            return resolved;
        },
    };
}
//# sourceMappingURL=toggle-state.js.map