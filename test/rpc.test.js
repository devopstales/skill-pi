import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const bin = join(pkgRoot, "..", "bin", "skill-pi.js");

function rpcProbe(project, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [bin, project, "--mode", "rpc", "--no-session"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout; captured: " + buf.slice(0, 500)));
    }, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes('"command":"get_state"') && buf.includes('"success":true')) {
        clearTimeout(timer);
        child.kill();
        resolve(buf);
      }
    });
    child.stderr.on("data", (d) => {
      buf += d.toString();
      if (/error/i.test(d.toString()) && !buf.includes("get_state")) {
        clearTimeout(timer);
        child.kill();
        reject(new Error("spawn error: " + buf.slice(0, 500)));
      }
    });
    child.on("exit", (code) => {
      if (!buf.includes("get_state")) {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${buf.slice(0, 500)}`));
      }
    });
    child.stdin.write(JSON.stringify({ type: "get_state" }) + "\n");
  });
}

test("rpc mode runs pi from the shim dir", async () => {
  const project = mkdtempSync(join(tmpdir(), "skillpi-rpc-proj-"));
  writeFileSync(join(project, "AGENTS.md"), "test project");
  const out = await rpcProbe(project, {
    SKILL_PI_AGENT_DIR: mkdtempSync(join(tmpdir(), "skillpi-rpc-agent-")),
    SKILL_PI_WORK_DIR: mkdtempSync(join(tmpdir(), "skillpi-rpc-work-")),
  });
  const parsed = JSON.parse(out.split("\n").find((l) => l.includes("get_state")));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.messageCount, 0);
});
