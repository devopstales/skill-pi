import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TOKEN = "?__piBrand";
const CHUNK = "chunk-WJUNYZC5.js";
const patchedCache = new Map();

export async function resolve(spec, ctx, nextResolve) {
  if (ctx.parentURL?.includes(TOKEN)) return nextResolve(spec, ctx);
  if (spec.endsWith(CHUNK)) {
    const r = await nextResolve(spec, ctx);
    if (r.url.endsWith(CHUNK)) {
      return { ...r, url: r.url + TOKEN, shortCircuit: true };
    }
  }
  return nextResolve(spec, ctx);
}

export async function load(url, ctx, nextLoad) {
  if (url.endsWith(CHUNK + TOKEN)) {
    const file = fileURLToPath(url.slice(0, -TOKEN.length));
    let patched = patchedCache.get(file);
    if (patched === undefined) {
      const src = await readFile(file, "utf8");
      patched = src.replace(/APP_NAME=piConfigName\|\|"pi"/g, 'APP_NAME=piConfigName||"skill-pi"');
      patchedCache.set(file, patched);
    }
    return { format: "module", source: patched, shortCircuit: true };
  }
  return nextLoad(url, ctx);
}
