import { PROVIDER_OPENCODE_FREE } from "../constants.js";
export const GLOB_TOOL_NAME = "glob";
/**
 * Gate names not present in Pi's default active roster (`read`, `bash`, `edit`
 * are; `glob` and `grep` are not). Added per-turn to opencode-free requests
 * only — never activated globally.
 */
export const OPENCODE_FREE_GATE_TOOLS = ["glob", "grep"];
/** Lazily load the host package; `undefined` when the host does not provide it. */
async function loadHostFindModule() {
    try {
        return (await import("@earendil-works/pi-coding-agent"));
    }
    catch {
        return undefined;
    }
}
/**
 * Register `glob` as the built-in `find` tool under a different name.
 *
 * `options` is forwarded to `createFindToolDefinition` and exists for tests,
 * which inject stub `FindOperations` so the suite never depends on a search
 * binary being installed on the host.
 *
 * @returns `true` when the tool was registered.
 */
export async function registerGlobTool(pi, cwd, options) {
    const host = await loadHostFindModule();
    const createFindToolDefinition = host?.createFindToolDefinition;
    if (!createFindToolDefinition)
        return false;
    // Stripped test doubles may not implement tool registration.
    if (!pi.registerTool)
        return false;
    const find = createFindToolDefinition(cwd, options);
    pi.registerTool({ ...find, name: GLOB_TOOL_NAME, label: GLOB_TOOL_NAME });
    return true;
}
/**
 * On opencode-free turns, add the missing gate tool names to this run's
 * selected tools. This mutates `systemPromptOptions.selectedTools` for the run
 * only (Pi rebuilds it each turn), so no other provider's request changes.
 */
export function addOpenCodeFreeGateTools(event, providerId) {
    if (providerId !== PROVIDER_OPENCODE_FREE)
        return;
    const selected = event.systemPromptOptions.selectedTools;
    for (const name of OPENCODE_FREE_GATE_TOOLS) {
        if (!selected.includes(name))
            selected.push(name);
    }
}
//# sourceMappingURL=glob-tool.js.map