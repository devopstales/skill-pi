import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function shimBase() {
  if (process.env.SKILL_PI_WORK_DIR) return process.env.SKILL_PI_WORK_DIR;
  return join(homedir(), ".skill-pi", "work");
}

/**
 * Build a shim working directory that owns an empty `.pi/` project-config
 * directory, with the real project mounted inside as a symlink.
 *
 *   <base>/<hash>/
 *     .pi/         marker dir -> pi's project discovery finds nothing real
 *     project ->   <real project>
 *
 * Running pi with this as cwd keeps the real project's .pi/ untouched.
 */
export function resolveShimCwd(project) {
  const target = resolve(project);
  const hash = createHash("sha256").update(target).digest("hex").slice(0, 12);
  const shim = join(shimBase(), hash);
  const marker = join(shim, ".pi");
  const link = join(shim, "project");

  mkdirSync(marker, { recursive: true });
  if (!existsSync(link)) {
    symlinkSync(target, link);
  } else {
    const current = readlinkSync(link);
    if (resolve(dirname(link), current) !== target) {
      rmSync(link);
      symlinkSync(target, link);
    }
  }
  return shim;
}

export function listShims() {
  const base = shimBase();
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(base, d.name))
    .filter((shim) => {
      try {
        return existsSync(join(shim, "project"));
      } catch {
        return false;
      }
    });
}
