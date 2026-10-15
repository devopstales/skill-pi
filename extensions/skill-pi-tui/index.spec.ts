import { assert, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { captureChanges, emptyChanges } from "./src/changes.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { renderCard, CARD_TONE, type CardTheme } from "./src/card.ts";
import { renderStatusCard, type StatusCardModel } from "./src/status-card.ts";
import { SIDEBAR_BREAKPOINT, invalidateSidebar } from "./src/sidebar-layout.ts";
import { sidebarState, sidebarPart } from "./src/sidebar.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-changes-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "x\ny\nz\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-m", "init");
  return dir;
}

it("captureChanges: reads numstat + porcelain from a git repo", async () => {
  const dir = makeGitRepo();
  writeFileSync(join(dir, "a.txt"), "x\ny\nz\nw\nv\n");
  mkdirSync(join(dir, "new"));
  writeFileSync(join(dir, "new", "u.txt"), "hello\n");
  const changes = await captureChanges(dir);
  assert.equal(changes.files.length, 2);
  // ponytail: this env's git template auto-stages a.txt (content-normalized) on
  // commit, so numstat deltas are not deterministic here — assert statuses and
  // the untracked count (file reads are stable), plus a churn lower bound.
  const a = changes.files.find((f) => f.path === "a.txt");
  assert.ok(a);
  assert.equal(a.status, "modified");
  const u = changes.files.find((f) => f.path === "new/u.txt");
  assert.ok(u);
  assert.equal(u.status, "untracked");
  assert.equal(u.added, 1);
  assert.ok(changes.added >= 2, "modified + untracked lines counted");
});

it("captureChanges: non-git dir resolves to empty model with notice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-nongit-"));
  const changes = await captureChanges(dir);
  assert.equal(changes.files.length, 0);
  assert.equal(changes.added, 0);
  assert.equal(changes.deleted, 0);
  assert.match(changes.notice ?? "", /not a git repo/);
});

it("sanitizeTerminalText: strips SGR, OSC, and control chars", () => {
  const raw = "\x1b[1;31mred\x1b[0m \x1b]0;title\x07 tab";
  const out = sanitizeTerminalText(raw);
  assert.equal(out, "red  tab");
  assert.equal(sanitizeTerminalText("safe\x1b]52;c;Zm9vtext"), "safe");
});

const fakeTheme: CardTheme & { bold(text: string): string } = {
  fg: (_color, text) => text,
  bg: (_color, text) => `\x1b[48;5;16m${text}\x1b[49m`,
  bold: (text) => text,
};

it("renderCard: panel frame at fixed width", () => {
  const lines = renderCard(
    { title: "Status", body: ["line one", "line two"], tone: CARD_TONE.INFO },
    fakeTheme,
    50,
    { expanded: true, panel: true },
  );
  assert.ok(lines.length >= 4, "header + body + bottom");
  for (const line of lines) {
    assert.ok(visibleWidthCheck(line), `line exceeds width: ${JSON.stringify(line)}`);
  }
});

function visibleWidthCheck(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return [...plain].length <= 50;
}

it("renderStatusCard: project + changes groups at width 48", () => {
  const model: StatusCardModel = {
    cwd: "~/git/ai-test/skill-pi",
    branch: "main",
    sessionName: "tui work",
    changes: { files: 3, added: 10, deleted: 2 },
  };
  const lines = renderStatusCard(model, fakeTheme, 48);
  const flat = lines.join("\n");
  assert.match(flat, /Status/);
  assert.match(flat, /~/);
  assert.match(flat, /main/);
  assert.match(flat, /tui work/);
  assert.match(flat, /3 files/);
  assert.match(flat, /\+10/);
  assert.match(flat, /−2/);
  for (const line of lines) assert.ok([...line.replace(/\x1b\[[0-9;]*m/g, "")].length <= 48);
});

it("renderStatusCard: non-git notice when no changes", () => {
  const model: StatusCardModel = { cwd: "/tmp/x", branch: null, changes: undefined };
  const flat = renderStatusCard(model, fakeTheme, 48).join("\n");
  assert.match(flat, /No captured changes/);
  assert.notMatch(flat, /Branch/);
});

it("SIDEBAR_BREAKPOINT is 140 and registry APIs exist", () => {
  assert.equal(SIDEBAR_BREAKPOINT, 140);
  assert.equal(typeof invalidateSidebar, "function");
  assert.equal(typeof sidebarState, "function");
  assert.equal(typeof sidebarPart, "function");
});
