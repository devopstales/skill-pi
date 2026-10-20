import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
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

// Extensions shipped as npm dependencies: their name maps to a folder inside
// the agent dir's extensions/ directory. A fresh or outdated copy is replaced
// on every launch so the bundled version always wins (the user can still drop
// their own extensions into the same dir; only these folders are managed).
export const bundledExtensionPackages = [
  { name: "@devopstales/skillgrid-pi-mnemonic", folder: "mnemonic" },
];

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
  syncBundledExtensions(agentDir);
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

// Copy each npm-bundled extension into <agent-dir>/extensions/<folder>/ when
// missing or when the installed package version differs from the stamped one.
// Fail-open: a missing or broken package must never block agent startup.
export function syncBundledExtensions(agentDir, opts = {}) {
  const require = opts.require ?? createRequire(import.meta.url);
  const resolvePath = (name) => {
    const r = require.resolve(join(name, "package.json"));
    return typeof r === "string" ? r : r.resolve(join(name, "package.json"));
  };
  for (const { name, folder } of bundledExtensionPackages) {
    let manifest;
    try {
      manifest = require(join(name, "package.json"));
    } catch {
      continue;
    }
    const dest = join(agentDir, "extensions", folder);
    const stampPath = join(dest, ".skill-pi-sync.json");
    let stamp;
    try {
      stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    } catch {
      stamp = null;
    }
    if (stamp?.version === manifest.version) continue;
    try {
      const srcDir = dirname(resolvePath(name));
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(join(agentDir, "extensions"), { recursive: true });
      cpSync(srcDir, dest, { recursive: true });
      writeFileSync(
        stampPath,
        JSON.stringify({ name, version: manifest.version, syncedAt: new Date().toISOString() }, null, 2) + "\n",
      );
    } catch {
      // leave the previous copy (or nothing) in place
    }
  }
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
