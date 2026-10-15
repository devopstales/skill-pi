import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { base } from "./pi-free/base.js";

export default async function unifiedProviders(pi: ExtensionAPI) {
  await base(pi);
}
