import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ConfSettingsPaths {
  global: string;
  project: string;
  local: string;
}

export function agentHome(): string {
  return path.dirname(getAgentDir());
}

export function resolveProjectRoot(cwd: string): string {
  try {
    const out = cp
      .execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
    return out ? path.resolve(out) : path.resolve(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

export function resolveProjectConfDir(cwd: string): string {
  return path.join(resolveProjectRoot(cwd), "conf.d");
}

export function getExtensionSettingsPaths(name: string, cwd: string): ConfSettingsPaths {
  const root = resolveProjectRoot(cwd);
  return {
    global: path.join(agentHome(), "conf.d", `${name}.conf`),
    project: path.join(root, "conf.d", `${name}.conf`),
    local: path.join(root, "conf.d", `${name}.local.conf`),
  };
}

export function loadExtensionSettings<T>(
  name: string,
  cwd: string,
  merge: (a: Partial<T>, b: Partial<T>) => Partial<T>,
): Partial<T> {
  const paths = getExtensionSettingsPaths(name, cwd);
  const root = resolveProjectRoot(cwd);
  const g = loadJsonSafe<T>(paths.global);
  const skillPiPath = path.join(root, ".skill-pi", "conf.d", `${name}.conf`);
  const piPath = path.join(root, ".pi", "conf.d", `${name}.conf`);
  const skillPi = loadJsonSafe<T>(skillPiPath);
  const pi = fs.existsSync(skillPiPath) ? {} : loadJsonSafe<T>(piPath);
  const p = loadJsonSafe<T>(paths.project);
  const l = loadJsonSafe<T>(paths.local);
  const skillPiAndPi = merge(skillPi, pi);
  const withUser = merge(g, skillPiAndPi);
  const withProjectConf = merge(withUser, p);
  return merge(withProjectConf, l);
}

export function loadJsonSafe<T>(filePath: string): Partial<T> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}
