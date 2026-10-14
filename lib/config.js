import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function agentDirFor(explicitDir) {
  if (explicitDir) return explicitDir;
  if (process.env.SKILL_PI_AGENT_DIR) return process.env.SKILL_PI_AGENT_DIR;
  return join(homedir(), ".skill-pi", "agent");
}

export const defaultPackages = ["npm:pi-ollama"];

export function ensureAgentDir(agentDir) {
  for (const sub of ["", "sessions", "prompts", "themes", "bin"]) {
    mkdirSync(join(agentDir, sub), { recursive: true });
  }
  const settingsPath = join(agentDir, "settings.json");
  if (!existsSync(settingsPath)) {
    writeJson(settingsPath, defaultSettings());
  }
  seedDefaultPackages(agentDir);
  const authPath = join(agentDir, "auth.json");
  if (!existsSync(authPath)) writeJson(authPath, {});
}

export function seedDefaultPackages(agentDir) {
  const settingsPath = join(agentDir, "settings.json");
  if (!existsSync(settingsPath)) return;
  const raw = readFileSync(settingsPath, "utf8");
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    return;
  }
  const current = Array.isArray(settings.packages) ? settings.packages : [];
  const missing = defaultPackages.filter((p) => !current.includes(p));
  if (missing.length === 0) return;
  settings.packages = [...current, ...missing];
  writeJson(settingsPath, settings);
}

function defaultSettings() {
  return {
    quietStartup: true,
    collapseChangelog: true,
    showHardwareCursor: true,
    packages: [],
  };
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}
