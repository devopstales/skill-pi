import { spawn } from "node-pty";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { emulate } from "./term-emul.mjs";
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function collect(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isFile() && (e.name.endsWith(".ts")||e.name.endsWith(".js"))) files.push(full);
    else if (e.isDirectory()) {
      const mp = join(full, "package.json");
      if (existsSync(mp)) { try { const m = JSON.parse(readFileSync(mp, "utf8")); const d = m?.pi?.extensions; if (Array.isArray(d)&&d.length){ d.map((p)=>join(full,p)).filter((p)=>existsSync(p)).forEach((p)=>files.push(p)); continue; } } catch {} }
      if (existsSync(join(full, "index.ts"))) files.push(join(full, "index.ts"));
      else if (existsSync(join(full, "index.js"))) files.push(join(full, "index.js"));
    }
  }
  return files;
}
const extFlags = [];
for (const f of collect(join(pkgRoot, "extensions"))) extFlags.push("--extension", f);
const COLS=160, ROWS=40;
const proj = mkdtempSync(join(tmpdir(), "sktpi-settle-proj-"));
const agentDir = mkdtempSync(join(tmpdir(), "sktpi-settle-agent-"));
writeFileSync(join(agentDir, "models.json"), JSON.stringify({
  providers: { vllm: { baseUrl: "http://192.168.104.70:8000/v1", api: "openai-completions", apiKey: "x", models: [{ id: "qwen3.8-uncensored", name: "qwen3.8-uncensored", contextWindow: 32768 }] } },
}, null, 2));
execFileSync("git", ["init", "-b", "main"], { cwd: proj });
execFileSync("git", ["config", "user.email", "t@t"], { cwd: proj });
execFileSync("git", ["config", "user.name", "t"], { cwd: proj });
writeFileSync(join(proj, "a.txt"), "x\n");
execFileSync("git", ["add", "a.txt"], { cwd: proj });
execFileSync("git", ["commit", "-m", "init"], { cwd: proj });
const sessionId = randomUUID();
const e1 = randomUUID().slice(0,8), e2 = randomUUID().slice(0,8);
const sessionDir = join(agentDir, "sessions");
mkdirSync(sessionDir, { recursive: true });
const todoState = ["Todo plan (current work). Keep this list accurate with the todo tool as work moves.","- [1] Create file b.txt (pending)","- [2] Verify b.txt content (in progress)","- [3] Wrap up (pending)"].join("\n");
const jsonl = [
  JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: proj }),
  JSON.stringify({ type: "thinking_level_change", id: e1, parentId: null, timestamp: new Date().toISOString(), thinkingLevel: "off" }),
  JSON.stringify({ type: "custom_message", id: e2, parentId: e1, customType: "pi-todo-state", content: todoState, display: false, timestamp: new Date().toISOString() }),
];
const sessionFile = join(sessionDir, `seed_${sessionId}.jsonl`);
writeFileSync(sessionFile, jsonl.join("\n") + "\n");
const pty = spawn(
  process.execPath,
  [join(pkgRoot, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
   ...extFlags, "--no-extensions", "--model", "vllm/qwen3.8-uncensored", "--session", sessionFile, "Just say ok, do not use any tools."],
  { name: "xterm-256color", cols: COLS, rows: ROWS, cwd: proj,
    env: { ...process.env, TERM: "xterm-256color", PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" } },
);
let out = "";
pty.onData((d) => (out += d));
// Let it run, then poll: send "y"+enter periodically to accept any permission, wait for settle
await new Promise((r) => setTimeout(r, 16000));
pty.kill();
const grid = emulate(out, COLS, ROWS);
let todoCards = 0, railTodo = false, mainTodo = false;
for (let r = 0; r < ROWS; r++) {
  const line = grid[r].join("");
  if (line.includes("Todo ·")) {
    todoCards++;
    // rail is on the right (col >= 98), main is left
    const firstCol = line.indexOf("Todo ·");
    if (firstCol >= 90) railTodo = true; else mainTodo = true;
  }
}
console.log("TODO cards:", todoCards, "| inRail:", railTodo, "| inMain:", mainTodo);
console.log("=== FINAL SCREEN (right 64 cols per line) ===");
for (let r = 0; r < ROWS; r++) {
  const line = grid[r].join("").replace(/\s+$/,"");
  if (line.trim()) console.log(String(r).padStart(2), line.slice(-64));
}
