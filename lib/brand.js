import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OVERLAY_NAME = "pi-brand";

/**
 * Resolve the directory of the bundled @earendil-works/pi-coding-agent package
 * (the parent of its dist/).
 */
export function piPackageRoot() {
  return join(
    dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
    "..",
  );
}

/**
 * Build the brand overlay: a package.json that RE-EXPORTS the real pi package
 * (inheriting name, version, bin, exports, …) with only piConfig overridden to
 * brand the app "skill-pi" and point the project config dir at `.skill-pi`
 * (ADR-0002 D2: skill-pi never loads a project's `.pi`).
 *
 * Why re-export rather than a bare {piConfig} file: pi derives its asset paths
 * (themes, docs, changelog) from getPackageDir(), which PI_PACKAGE_DIR pins to
 * this overlay. A package.json-only overlay has no dist/ or docs/, so those
 * lookups ENOENT (the dark.json theme error). Re-exporting keeps VERSION/name
 * correct; linkOverlayAssets() then symlinks the real dist/ + docs/ in so the
 * paths resolve. The overlay stays a real directory (not a symlink back into
 * node_modules) so getPackageDir() does not walk back and drop piConfig.
 */
export function brandOverlayDir(agentDir) {
  const overlay = join(agentDir, OVERLAY_NAME);
  mkdirSync(overlay, { recursive: true });
  let reexport;
  try {
    const real = JSON.parse(readFileSync(join(piPackageRoot(), "package.json"), "utf8"));
    reexport = { ...real, piConfig: { ...(real.piConfig ?? {}), name: "skill-pi", configDir: ".skill-pi" } };
  } catch {
    reexport = { name: OVERLAY_NAME, piConfig: { name: "skill-pi", configDir: ".skill-pi" } };
  }
  writeFileSync(join(overlay, "package.json"), JSON.stringify(reexport, null, 2) + "\n");
  linkOverlayAssets(agentDir);
  return overlay;
}

/**
 * Symlink the real pi package's asset dirs/files into the overlay so
 * getPackageDir()-relative lookups (getThemesDir, getDocsPath, getChangelogPath,
 * …) resolve to the real package's copies. Idempotent: an existing link that
 * already targets the right place is left alone.
 */
export function linkOverlayAssets(agentDir) {
  const overlay = join(agentDir, OVERLAY_NAME);
  let realRoot;
  try {
    realRoot = piPackageRoot();
  } catch {
    return;
  }
  const assets = ["dist", "docs", "schemas", "examples", "CHANGELOG.md", "README.md"];
  for (const name of assets) {
    const target = join(realRoot, name);
    if (!existsSync(target)) continue;
    const link = join(overlay, name);
    try {
      if (currentTarget(link) === target) continue;
      rmSync(link, { force: true });
      symlinkSync(target, link);
    } catch {
      // link write failed; asset path falls back to a (missing) overlay copy
    }
  }
}

function currentTarget(link) {
  try {
    return resolve(dirname(link), readlinkSync(link));
  } catch {
    return null;
  }
}

export function brandEnv(agentDir) {
  return { PI_CODING_AGENT_DIR: agentDir };
}
