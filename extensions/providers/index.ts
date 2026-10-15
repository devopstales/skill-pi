import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { base } from "./pi-free/base.js";
import { registerZen } from "./zen/provider.js";
import { registerAntigravity } from "./antigravity/provider.js";

export default async function unifiedProviders(pi: ExtensionAPI) {
  await base(pi);
  registerZen(pi);
  registerAntigravity(pi);
}
