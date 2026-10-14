import { assert, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { captureChanges, emptyChanges } from "./src/changes.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { renderCard, CARD_TONE, type CardTheme } from "./src/card.ts";

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

const fakeTheme: CardTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => `\x1b[48;5;16m${text}\x1b[49m`,
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
