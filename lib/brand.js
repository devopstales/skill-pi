import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OVERLAY_NAME = "pi-brand";

export function brandOverlayDir(agentDir) {
  const overlay = join(agentDir, OVERLAY_NAME);
  mkdirSync(overlay, { recursive: true });
  writeFileSync(
    join(overlay, "package.json"),
    JSON.stringify({ name: OVERLAY_NAME, piConfig: { name: "skill-pi" } }, null, 2) + "\n",
  );
  return overlay;
}

export function brandEnv(agentDir) {
  return { PI_CODING_AGENT_DIR: agentDir };
}
