import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

export async function ensureAgentDir(agentDir) {
  for (const sub of ["", "sessions", "prompts", "themes", "bin"]) {
    mkdirSync(join(agentDir, sub), { recursive: true });
  }
  const settingsPath = join(agentDir, "settings.json");
  if (existsSync(settingsPath) && !await isHealthySettings(settingsPath)) {
    quarantineSettings(settingsPath);
  }
  if (!existsSync(settingsPath)) {
    writeJson(settingsPath, defaultSettings());
  }
  seedDefaultPackages(agentDir);
  const authPath = join(agentDir, "auth.json");
  if (!existsSync(authPath)) writeJson(authPath, {});
}

// A corrupt or schema-invalid settings.json makes pi's SettingsManager set
// globalSettingsLoadError at startup, after which every settings save is a
// silent no-op (model default changes revert). Quarantine the bad file and
// reseed so pi can read a healthy file and persist future changes.
async function isHealthySettings(settingsPath) {
  let raw;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  try {
    const [{ SettingsSchema }, { Compile }] = await Promise.all([
      importPiSettingsSchema(),
      importTypeboxCompile(),
    ]);
    return Compile(SettingsSchema).Check(parsed);
  } catch {
    return true;
  }
}

function quarantineSettings(settingsPath) {
  try {
    copyFileSync(settingsPath, join(dirname(settingsPath), "settings.json.bak"));
    unlinkSync(settingsPath);
  } catch {
    // Best effort: if the copy or remove fails, seeding below recreates the
    // path when it is gone and leaves the unreadable file alone when it is not.
  }
}

let cachedSettingsSchema;
function importPiSettingsSchema() {
  if (!cachedSettingsSchema) {
    const piRoot = join(
      PKG_ROOT,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "core",
      "settings-schema.js",
    );
    cachedSettingsSchema = import("file://" + piRoot);
  }
  return cachedSettingsSchema;
}

let cachedTypeboxCompile;
function importTypeboxCompile() {
  if (!cachedTypeboxCompile) {
    const root = join(
      PKG_ROOT,
      "node_modules",
      "typebox",
      "build",
      "compile",
      "index.mjs",
    );
    cachedTypeboxCompile = import("file://" + root);
  }
  return cachedTypeboxCompile;
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
