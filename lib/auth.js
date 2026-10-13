import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function importAuth(fromDir, toDir) {
  const src = resolve(fromDir);
  if (!existsSync(join(src, "auth.json"))) {
    throw new Error(`no auth.json in ${src}`);
  }
  mkdirSync(toDir, { recursive: true });
  const copied = [];
  for (const file of ["auth.json", "models.json"]) {
    const from = join(src, file);
    if (existsSync(from)) {
      copyFileSync(from, join(toDir, file));
      copied.push(file);
    }
  }
  console.log(`skill-pi: copied ${copied.join(", ")} to ${toDir}`);
  if (!copied.includes("models.json")) {
    console.log("skill-pi: note: models.json not found in source; custom providers must be added to " + join(toDir, "models.json"));
  }
}
