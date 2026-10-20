import { pathToFileURL } from "node:url";

const shim = pathToFileURL(
  new URL("../node_modules/typebox-shim.mjs", import.meta.url).pathname,
).href;
const piShim = pathToFileURL(
  new URL("../node_modules/pi-coding-agent-shim.mjs", import.meta.url).pathname,
).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "typebox") {
    return { url: shim, shortCircuit: true };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return { url: piShim, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
