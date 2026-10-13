import { fileURLToPath } from "node:url";

export function brandPreloadPath() {
  return fileURLToPath(new URL("./brand-preload.cjs", import.meta.url));
}
