#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { agentDirFor, ensureAgentDir } from "../lib/config.js";
import { resolveShimCwd } from "../lib/shim.js";
import { brandOverlayDir } from "../lib/brand.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledExtensionFiles = [join(pkgRoot, "extensions")];

function parseArgs(argv) {
  const args = {
    project: null,
    importAuthFrom: null,
    agentDir: null,
    noShim: false,
    version: false,
    passthrough: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--import-auth") {
      args.importAuthFrom = argv[++i] ?? null;
      if (!args.importAuthFrom) fail("--import-auth requires a source directory");
    } else if (a === "--agent-dir") {
      args.agentDir = expandHome(argv[++i] ?? null);
    } else if (a === "--no-shim") {
      args.noShim = true;
    } else if (a === "--project") {
      args.project = resolve(argv[++i] ?? null);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version" || a === "-v") {
      args.version = true;
    } else if (a === "--") {
      args.passthrough.push(...argv.slice(i + 1));
      break;
    } else if (!args.project && !a.startsWith("-")) {
      args.project = resolve(a);
    } else {
      args.passthrough.push(a);
    }
  }
  if (!args.project && !args.importAuthFrom) args.project = process.cwd();
  return args;
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function fail(msg) {
  process.stderr.write(`skill-pi: ${msg}\n`);
  process.exit(2);
}

function piPackageDir() {
  return join(
    dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
    "..",
  );
}

async function printVersion() {
  const { version } = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  let piVersion = "?";
  try {
    piVersion = (await import("@earendil-works/pi-coding-agent")).VERSION;
  } catch {
    // package missing; keep the placeholder
  }
  console.log(`skill-pi ${version} (wraps pi-coding-agent ${piVersion})`);
}

function printHelp() {
  console.log(`skill-pi — isolated pi-based coding agent

Usage:
  skill-pi [PROJECT] [pi args...]            Launch the agent for PROJECT (default: cwd)
  skill-pi --import-auth DIR                 Copy auth.json + models.json from DIR (default ~/.pi/agent)
  skill-pi --agent-dir DIR [pi args...]      Override the agent directory
  skill-pi --no-shim [PROJECT] [pi args...]  Run in PROJECT directly (share its .pi/ project config)

Isolation:
  Global config:  ~/.skill-pi/agent (override: $SKILL_PI_AGENT_DIR or --agent-dir)
  Project config: shim dir ~/.skill-pi/work/<hash>/.pi — your project's .pi/ is never touched
  Sessions/auth:  fully separate from pi (~/.pi/agent)

Pass everything after the project (or after --) straight through to pi:
  skill-pi /path/to/repo -c
  skill-pi --print "summarize this repo"
`);
}

function resolvePiCli() {
  const cli = join(piPackageDir(), "dist", "bundle", "cli.js");
  if (!existsSync(cli)) {
    fail(
      `bundled pi CLI not found at ${cli}; the skill-pi install is incomplete. ` +
        "Run `npm install` in the skill-pi project.",
    );
  }
  return cli;
}

async function main() {
  const cli = resolvePiCli();

  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    await printVersion();
    return;
  }

  if (args.importAuthFrom) {
    const { importAuth } = await import("../lib/auth.js");
    importAuth(expandHome(args.importAuthFrom), agentDirFor(args.agentDir));
    return;
  }

  const agentDir = agentDirFor(args.agentDir);
  ensureAgentDir(agentDir);

  const overlay = brandOverlayDir(agentDir);

  let cwd = args.project;
  if (!args.noShim) {
    cwd = resolveShimCwd(cwd);
  }

  const extensionFlags = [];
  for (const file of bundledExtensionFiles) {
    if (existsSync(file)) extensionFlags.push("--extension", file);
  }

  const spawn = spawnSync(
    process.execPath,
    [cli, ...extensionFlags, ...args.passthrough],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_PACKAGE_DIR: overlay,
      },
    },
  );
  process.exit(spawn.status ?? 1);
}

main();
