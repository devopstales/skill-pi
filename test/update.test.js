import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runUpdate } from "../lib/update.js";

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "skillpi-update-"));
  mkdirSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "skill-pi-test", version: "0.1.0", type: "module" }));
  writeFileSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.2.0" }));
  return root;
}

function withStreams(fn) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = "", err = "";
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  try {
    const status = fn();
    return { status, stdout: out, stderr: err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test("runUpdate runs npm install then npm link --force in pkgRoot (in order)", () => {
  const root = makeSandbox();
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push([cmd, args.join(" "), opts.cwd]);
    return { status: 0 };
  };
  try {
    const { status } = withStreams(() => runUpdate({ spawn, pkgRoot: root }));
    assert.equal(status, 0);
    assert.deepEqual(calls.map((c) => c[1]), ["install", "link --force"]);
    assert.equal(calls[0][0], "npm");
    assert.equal(calls[1][0], "npm");
    assert.equal(calls[0][2], root);
    assert.equal(calls[1][2], root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runUpdate reports the pi version transition after install", () => {
  const root = makeSandbox();
  const piPkg = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  const spawn = (cmd, args) => {
    if (args[0] === "install") {
      const pkg = JSON.parse(readFileSync(piPkg, "utf8"));
      pkg.version = "1.3.0";
      writeFileSync(piPkg, JSON.stringify(pkg));
    }
    return { status: 0 };
  };
  try {
    const { status, stdout } = withStreams(() => runUpdate({ spawn, pkgRoot: root }));
    assert.equal(status, 0);
    assert.match(stdout, /Updated pi from 1\.2\.0 to 1\.3\.0 \(skill-pi 0\.1\.0\)/);
    assert.match(stdout, /https:\/\/pi\.dev\/changelog/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runUpdate exits non-zero with a hint when npm install fails", () => {
  const root = makeSandbox();
  try {
    const { status, stderr } = withStreams(() => runUpdate({ spawn: () => ({ status: 1 }), pkgRoot: root }));
    assert.equal(status, 1);
    assert.match(stderr, /skill-pi: update failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runUpdate reports '?' placeholders when versions cannot be read", () => {
  const root = makeSandbox();
  rmSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
  const spawn = () => ({ status: 0 });
  try {
    const { status, stdout } = withStreams(() => runUpdate({ spawn, pkgRoot: root }));
    assert.equal(status, 0);
    assert.match(stdout, /Updated pi from \? to \?/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseArgs: bare 'update' is consumed, not passed through", async () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["update"]);
  assert.equal(args.update, true);
  assert.deepEqual(args.passthrough, []);
  assert.equal(args.project, process.cwd());
});

test("parseArgs: 'update' with a project still routes to update", async () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["/tmp/foo", "update"]);
  assert.equal(args.update, true);
  assert.deepEqual(args.passthrough, []);
});

test("parseArgs: '--update' (flag form) is NOT the subcommand", async () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["--update"]);
  assert.equal(args.update, false);
  assert.deepEqual(args.passthrough, ["--update"]);
});

test("printHelp documents the update subcommand", async () => {
  const { printHelp } = await import("../bin/skill-pi.js");
  const { stdout } = withStreams(() => printHelp());
  assert.match(stdout, /skill-pi update/);
});
