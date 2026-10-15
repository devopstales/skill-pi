import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { base } from "./pi-free/base.js";
import { registerZen } from "./zen/provider.js";
import { registerAntigravity } from "./antigravity/provider.js";

function isEnabled(name: string, disabledSet: Set<string>): boolean {
  return !disabledSet.has(name);
}

export default async function unifiedProviders(pi: ExtensionAPI) {
  await base(pi);
  const disabled = new Set((process.env.SKILL_PI_DISABLE_PROVIDERS ?? "").split(",").filter(Boolean));
  if (isEnabled("opencode-zen", disabled)) registerZen(pi);
  if (isEnabled("antigravity", disabled)) registerAntigravity(pi);
}
