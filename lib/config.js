import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function agentDirFor(explicitDir) {
  if (explicitDir) return explicitDir;
  if (process.env.SKILL_PI_AGENT_DIR) return process.env.SKILL_PI_AGENT_DIR;
  return join(homedir(), ".skill-pi", "agent");
}

// No default provider packages are seeded. --no-extensions suppresses
// package-scope discovery anyway (ADR-0001), so a seeded package would be
// loaded-then-suppressed — dead weight. The unified-providers change
// (2026-10-14-unified-providers) will bundle cloud providers as an explicit
// extension; local providers (e.g. Ollama) are user-dropped into
// <agent-dir>/extensions/ and load via the wrapper's explicit enumeration.
export const defaultPackages = [];

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
