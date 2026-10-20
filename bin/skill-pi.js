#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { agentDirFor, ensureAgentDir } from "../lib/config.js";
import { brandOverlayDir } from "../lib/brand.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Resolve the entry points a subdirectory exposes, matching pi's own
// resolveExtensionEntries convention exactly: a package.json with a non-empty
// "pi.extensions" manifest wins (each declared path, relative to the dir),
// else index.ts, else index.js. Returns [] when the dir has no entry point.
function resolveDirEntryPoints(dir) {
  const manifestPath = join(dir, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const declared = manifest?.pi?.extensions;
      if (Array.isArray(declared) && declared.length > 0) {
        return declared
          .filter((p) => typeof p === "string")
          .map((p) => join(dir, p))
          .filter((p) => existsSync(p));
      }
    } catch {
      // malformed manifest; fall through to index detection
    }
  }
  if (existsSync(join(dir, "index.ts"))) return [join(dir, "index.ts")];
  if (existsSync(join(dir, "index.js"))) return [join(dir, "index.js")];
  return [];
}

// Scan an extensions directory for entry points: top-level *.ts/*.js files
// (alphabetical) plus subdirectories that carry an entry point (manifest,
// index.ts, or index.js — the same convention pi's own discovery uses). The
// wrapper enumerates files itself because --no-extensions suppresses pi's
// package-scope auto-discovery, which is exactly the isolation we want.
function collectExtensionFiles(dir) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    let isFile = entry.isFile();
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        const st = statSync(full);
        isFile = st.isFile();
        isDir = st.isDirectory();
      } catch {
        continue;
      }
    }
    if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      files.push(full);
    } else if (isDir) {
      files.push(...resolveDirEntryPoints(full));
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = {
    project: null,
    importAuthFrom: null,
    agentDir: null,
    version: false,
    update: false,
    passthrough: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--import-auth") {
      args.importAuthFrom = argv[++i] ?? null;
      if (!args.importAuthFrom) fail("--import-auth requires a source directory");
    } else if (a === "--agent-dir") {
      args.agentDir = expandHome(argv[++i] ?? null);
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
    } else if (a === "update") {
      args.update = true;
    } else if (!args.project && !a.startsWith("-")) {
      args.project = resolve(a);
    } else {
      args.passthrough.push(a);
    }
  }
  if (!args.project && !args.importAuthFrom) args.project = process.cwd();
  return args;
}

function isUpdateCommand(args) {
  return args.update === true;
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
  skill-pi update                            Update skill-pi + bundled pi (npm install + npm link --force)

Isolation:
  Global config:  ~/.skill-pi/agent (override: $SKILL_PI_AGENT_DIR or --agent-dir)
  Project config: <PROJECT>/.skill-pi — your project's .pi/ is never touched
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

  if (isUpdateCommand(args)) {
    const { runUpdate } = await import("../lib/update.js");
    process.exit(runUpdate());
  }

  if (args.importAuthFrom) {
    const { importAuth } = await import("../lib/auth.js");
    importAuth(expandHome(args.importAuthFrom), agentDirFor(args.agentDir));
    return;
  }

  const agentDir = agentDirFor(args.agentDir);
  await ensureAgentDir(agentDir);

  const overlay = brandOverlayDir(agentDir);

  // pi runs with cwd = the real project. Under ADR-0002 D2 the project config
  // dir is .skill-pi (never .pi), so no shim is needed to keep a project's .pi/
  // unused — pi reads <project>/.skill-pi directly and your .pi/ is untouched.
  const cwd = args.project;

  // --no-extensions suppresses pi's package-scope discovery (settings packages
  // + auto-discovered agent/project dirs). We re-inject the sources we own
  // explicitly: bundled extensions, then user extensions from the agent dir.
  const extensionFlags = [];
  const extensionSources = [
    join(pkgRoot, "extensions"),
    join(agentDir, "extensions"),
  ];
  for (const source of extensionSources) {
    for (const file of collectExtensionFiles(source)) {
      extensionFlags.push("--extension", file);
    }
  }
  extensionFlags.push("--no-extensions");

  // The project path is already set via the spawn `cwd` option. If it also
  // appears in passthrough (e.g. `skill-pi -- --print "ok" /path/to/project`),
  // pi would consume it as a positional working-directory override, making
  // ctx.cwd wrong in extensions. Strip it from the pi args. When `--` is the
  // first arg, parseArgs leaves args.project null (the `--` branch breaks
  // before the project check), so also strip trailing absolute-path
  // positionals — pi treats them as working-directory overrides.
  const projectArg = args.project ?? process.cwd();
  const piArgs = [];
  for (let i = 0; i < args.passthrough.length; i++) {
    const a = args.passthrough[i];
    if (a === projectArg) continue;
    // Strip trailing positionals that look like absolute paths (pi would
    // consume them as cwd overrides). Only strip if no flag follows.
    if (a.startsWith("/") && (i + 1 >= args.passthrough.length || args.passthrough[i + 1].startsWith("-"))) continue;
    piArgs.push(a);
  }

  const spawn = spawnSync(
    process.execPath,
    [cli, ...extensionFlags, ...piArgs],
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
  if (spawn.error) {
    fail(`failed to launch pi: ${spawn.error.message}`);
  }
  process.exit(spawn.status ?? 1);
}

export { parseArgs, isUpdateCommand, printHelp };

// Compare real paths, not the launch string: the binary is typically reached
// through a symlink chain (e.g. ~/.npm-global/bin -> .../lib/node_modules ->
// the git checkout), so resolve(argv[1]) is the unresolved symlink path while
// import.meta.url is the real file. realpathSync both sides so main() runs
// regardless of which link the user launched through.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
