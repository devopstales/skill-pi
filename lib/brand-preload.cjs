// Loader hooks for the pi CLI: rebrand APP_NAME from "pi" to "skill-pi" in
// all messages (error hints, help text, self-update instructions).
// The chunk filename is not part of pi's public API; if a future release
// renames it, the hook degrades gracefully and pi prints "pi" again.
const { register } = require("node:module");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

register(
  pathToFileURL(path.join(__dirname, "brand-hooks.mjs")),
  pathToFileURL(__filename),
);
