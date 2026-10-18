import { assert, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  buildFooterContent,
  shortHostname,
  type FooterConfig,
  type FooterState,
} from "./src/footer.ts";
import { emptyGitStatus, readGitStatus } from "./src/git.ts";
import { detectNerdFont, resolveGlyphs, resolveIconMode } from "./src/icons.ts";
import { clearRuntimeCache, readRuntimeInfo } from "./src/runtime.ts";
import { getModelMeta, getUsageTotals, invalidateUsageCache, type ModelMeta } from "./src/state.ts";
import {
  fitSegmentsByPriority,
  sanitizeStatusPreservingStyles,
  stripAnsi,
  truncateBranch,
  truncatePath,
} from "./src/utils.ts";

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

it("reads Git status from a nested repository directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "sktpi-git-"));
  const nested = join(root, "packages", "app");
  try {
    execFileSync("git", ["init", "-b", "nested-repo-test"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init"], { cwd: root });
    require("node:fs").mkdirSync(nested, { recursive: true });
    assert.equal((await readGitStatus(nested)).branch, "nested-repo-test");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("branch truncation preserves the branch prefix", () => {
  // ponytail: truncation is character-based in the port source — the width-based
  // CJK case lives in truncatePath, which is tested separately.
  assert.equal(truncateBranch("fix/cwd-footer-truncation", 20), "fix/cwd-footer-tr...");
  assert.equal(truncateBranch("main", 20), "main");
});

it("cwd path truncation keeps head and tail segments", () => {
  assert.equal(truncatePath("~/projects/pi-open-tui", 30), "~/projects/pi-open-tui");
  assert.equal(truncatePath("~/projects/pi-open-tui", 18), "~/.../pi-open-tui");
});

it("fitSegmentsByPriority drops lowest priority first", () => {
  const out = fitSegmentsByPriority(
    [
      { text: "aaaaaaaaaa", priority: 0 },
      { text: "b", priority: 1 },
      { text: "cccccccccc", priority: 2 },
    ],
    12,
  );
  assert.ok(!out.includes("aaaaaaaaaa"));
  assert.ok(out.includes("b"));
  assert.ok(out.includes("cccccccccc"));
});

it("sanitizeStatusPreservingStyles keeps SGR, drops other escapes", () => {
  const colored = "\x1b[31mred\x1b[0m ok";
  assert.equal(sanitizeStatusPreservingStyles(colored), colored);
  assert.equal(sanitizeStatusPreservingStyles("a\x1b]0;title\x07b"), "a b");
  assert.equal(stripAnsi("\x1b[1mbold\x1b[0m"), "bold");
});

it("icons resolve per mode and runtime symbols degrade", () => {
  const ascii = resolveGlyphs("ascii");
  assert.equal(ascii.git, "*");
  assert.equal(ascii.done, "+");
  assert.equal(resolveIconMode("ascii"), "ascii");
  assert.equal(typeof detectNerdFont(), "boolean");
});

it("readRuntimeInfo detects nodejs in a package.json dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-runtime-"));
  try {
    require("node:fs").writeFileSync(join(dir, "package.json"), "{}");
    clearRuntimeCache();
    const info = await readRuntimeInfo(dir);
    assert.equal(info?.name, "nodejs");
  } finally {
    clearRuntimeCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("readRuntimeInfo returns null outside a project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-runtime-empty-"));
  try {
    clearRuntimeCache();
    assert.equal(await readRuntimeInfo(dir), null);
  } finally {
    clearRuntimeCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

const fakeCtx = {
  sessionManager: {
    getCwd: () => process.cwd(),
    getSessionName: () => "test-session",
    getEntries: () => [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, cacheRead: 25, cacheWrite: 5, cost: { total: 0.01 } },
        },
      },
      { type: "compaction", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } },
    ],
  },
  model: { provider: "anthropic", id: "claude-sonnet", name: "claude-sonnet", reasoning: true },
  getContextUsage: () => ({ tokens: 36000, contextWindow: 200000, percent: 18 }),
} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

it("getUsageTotals sums assistant + compaction usage", () => {
  invalidateUsageCache();
  const totals = getUsageTotals(fakeCtx);
  assert.equal(totals.input, 115);
  assert.equal(totals.output, 55);
  assert.equal(totals.cacheRead, 25);
  assert.equal(totals.latestCacheHitRate, (25 / 130) * 100);
  assert.ok(Math.abs(totals.cost - 0.011) < 1e-9);
});

it("getModelMeta surfaces provider, model, and effort", () => {
  const meta = getModelMeta(fakeCtx, () => "high", true);
  assert.equal(meta.provider, "Anthropic");
  assert.equal(meta.model, "claude-sonnet");
  assert.equal(meta.effort, "high");
});

it("buildFooterContent assembles left/right lines at fixed width", () => {
  const state: FooterState = {
    ...emptyGitStatus(),
    branch: "main",
    runtime: { name: "nodejs", version: "24.0.0" },
    workingSince: undefined,
    lastDoneIn: undefined,
  };
  const config = {
    segments: {
      cwd: true,
      hostname: false,
      sessionName: false,
      gitBranch: true,
      gitStatus: true,
      runtime: true,
      context: false,
      tokens: true,
      cost: true,
      extensionStatuses: true,
      capitalizeProviderName: true,
    },
    iconMode: "ascii" as const,
  };
  const meta: ModelMeta = { provider: "Anthropic", model: "claude-sonnet", effort: undefined };
  const footerData = { getExtensionStatuses: () => new Map([["todo", "3 open"]]), onBranchChange: () => () => {} };
  const { mainLines, extensionLines } = buildFooterContent(fakeCtx, state, config, meta, theme, footerData, 140);
  assert.equal(mainLines.length, 2);
  const flat = mainLines.join("\n");
  assert.ok(flat.includes("main"), "git branch on line 1");
  assert.ok(flat.includes("claude-sonnet"), "model on line 2");
  assert.ok(flat.includes("nodejs"), "runtime symbol on line 1");
  assert.equal(extensionLines.length, 1);
  assert.ok(extensionLines[0].includes("3 open"));
});

it("buildFooterContent: zone-aware context bar with 40/70 thresholds", () => {
  const state: FooterState = { ...emptyGitStatus(), runtime: null, workingSince: undefined, lastDoneIn: undefined };
  const config = {
    segments: {
      cwd: false, hostname: false, sessionName: false, gitBranch: false, gitStatus: false,
      runtime: false, context: true, tokens: false, cost: false,
      extensionStatuses: false, capitalizeProviderName: true,
    },
    iconMode: "ascii" as const,
  };
  const meta: ModelMeta = { provider: "Anthropic", model: "claude-sonnet", effort: undefined };
  const footerData = { getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} };

  for (const [pct, icon, label, remaining] of [
    [36, "🧠", "smart", "4"],
    [50, "⚠️", "warm", "20"],
    [80, "🧟", "dumb", "20"],
  ] as const) {
    const ctx = {
      ...fakeCtx,
      getContextUsage: () => ({ tokens: Math.round((pct / 100) * 200000), contextWindow: 200000, percent: pct }),
    } as unknown as typeof fakeCtx;
    const { mainLines } = buildFooterContent(ctx, state, config, meta, theme, footerData, 160);
    const flat = mainLines.join("\n");
    assert.ok(flat.includes(icon), `${pct}%: zone icon ${icon}`);
    assert.ok(flat.includes(label), `${pct}%: zone label ${label}`);
    assert.ok(flat.includes(`${remaining}%`), `${pct}%: ${remaining}% remaining to ceiling`);
    assert.ok(flat.includes("left"), `${pct}%: 'left' suffix`);
  }
});
