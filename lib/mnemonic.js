import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_URL = "http://127.0.0.1:7438";
const DEFAULT_BIN = "mnemonic";
const DEFAULT_LOG = join(homedir(), ".skillgrid", "mnemonic", "serve.log");
const SETTLE_ATTEMPTS = 15;
const SETTLE_INTERVAL_MS = 200;

export function resolveMnemonicUrl() {
  return process.env.SKILLGRID_MNEMONIC_HTTP_URL || DEFAULT_URL;
}

export function ensureMnemonicServer(opts = {}) {
  const {
    fetch: doFetch = fetch,
    spawn: doSpawn = spawn,
    bin = DEFAULT_BIN,
    url = resolveMnemonicUrl(),
    logFile = DEFAULT_LOG,
    warn = (msg) => process.stderr.write(`skill-pi: ${msg}\n`),
    poll = (ms) => new Promise((r) => setTimeout(r, ms)),
    settleAttempts = SETTLE_ATTEMPTS,
    settleIntervalMs = SETTLE_INTERVAL_MS,
  } = opts;

  const healthUrl = new URL("/health", url).href;

  async function healthy() {
    try {
      const res = await doFetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function start() {
    try {
      const out = openSync(logFile, "a");
      doSpawn(bin, ["serve"], { detached: true, stdio: ["ignore", out, out] });
    } catch {
      return;
    }
    for (let i = 0; i < settleAttempts; i++) {
      await poll(settleIntervalMs);
      if (await healthy()) return;
    }
  }

  return (async () => {
    if (await healthy()) return "ok";
    try {
      await start();
    } catch (err) {
      warn(`mnemonic server spawn failed: ${err.message}; memory tools will be unavailable`);
      return "unavailable";
    }
    if (await healthy()) return "spawned";
    warn(`mnemonic server is not answering at ${url}; memory tools will be unavailable`);
    return "unavailable";
  })();
}
