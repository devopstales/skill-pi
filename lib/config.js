import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function agentDirFor(explicitDir) {
  if (explicitDir) return explicitDir;
  if (process.env.SKILL_PI_AGENT_DIR) return process.env.SKILL_PI_AGENT_DIR;
  return join(homedir(), ".skill-pi", "agent");
}

export function ensureAgentDir(agentDir) {
  for (const sub of ["", "sessions", "prompts", "themes", "bin"]) {
    mkdirSync(join(agentDir, sub), { recursive: true });
  }
  const settingsPath = join(agentDir, "settings.json");
  if (!existsSync(settingsPath)) {
    writeJson(settingsPath, defaultSettings());
  }
  const authPath = join(agentDir, "auth.json");
  if (!existsSync(authPath)) writeJson(authPath, {});
}

function defaultSettings() {
  return {
    quietStartup: true,
    collapseChangelog: true,
    showHardwareCursor: true,
  };
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}
