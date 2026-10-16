import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readVersions(pkgRoot = defaultRoot) {
  let skillPi = "?";
  try {
    skillPi = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
  } catch {
  }
  let pi = "?";
  try {
    pi = JSON.parse(readFileSync(join(pkgRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8")).version;
  } catch {
  }
  return { skillPi, pi };
}

export function runUpdate(opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const pkgRoot = opts.pkgRoot ?? defaultRoot;
  const from = readVersions(pkgRoot);
  for (const args of [["install"], ["link", "--force"]]) {
    const res = spawn("npm", args, { cwd: pkgRoot, stdio: "inherit" });
    const code = res.status ?? 1;
    if (code !== 0) {
      process.stderr.write("skill-pi: update failed — run `npm install && npm link --force` in the skill-pi checkout.\n");
      return code;
    }
  }
  const to = readVersions(pkgRoot);
  process.stdout.write(`Updated pi from ${from.pi} to ${to.pi} (skill-pi ${to.skillPi})\n`);
  process.stdout.write(`Changelog: https://pi.dev/changelog\n`);
  return 0;
}
