import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScopedModels } from "./model-pick.js";

type M = { provider: string; id: string; name: string; api: string; baseUrl: string; input: string[]; reasoning: boolean; contextWindow: number; maxTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number } };

const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const m = (provider: string, id: string, name: string): M => ({
  provider, id, name, api: "openai-completions", baseUrl: "http://x", input: ["text"], reasoning: false, contextWindow: 128000, maxTokens: 16384, cost,
});

const models: M[] = [
  m("anthropic", "claude-sonnet", "Claude Sonnet"),
  m("anthropic", "claude-opus", "Claude Opus"),
  m("openai", "gpt-4o", "GPT-4o"),
  m("openai", "gpt-4o-mini", "GPT-4o Mini"),
  m("vllm", "qwen3.8-uncensored", "Qwen3.8"),
];

function ctxWith(settingsJson: string | undefined, model?: M) {
  const dir = mkdtempSync(join(tmpdir(), "cp-scoped-"));
  if (settingsJson) {
    // SettingsManager.create(cwd) reads project settings from <cwd>/.pi/settings.json
    const pi = join(dir, ".pi");
    mkdirSync(pi, { recursive: true });
    writeFileSync(join(pi, "settings.json"), settingsJson);
  }
  return {
    cwd: dir,
    model: model as never,
    modelRegistry: { getAvailable: () => models } as never,
  } as never;
}

test("empty enabledModels falls back to all available, current model first", () => {
  const cur = m("openai", "gpt-4o", "GPT-4o");
  const rows = loadScopedModels(ctxWith(undefined, cur));
  expect(rows.map((r) => `${r.provider}/${r.model}`)).toContain("openai/gpt-4o");
  // current model is sorted to the front of its provider group
  expect(rows[0].provider).toBe("openai");
  expect(rows[0].model).toBe("gpt-4o");
  expect(rows.length).toBe(models.length);
});

test("exact provider/model pattern resolves that model only", () => {
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["anthropic/claude-sonnet"] })));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet", label: "Claude Sonnet" });
});

test("provider/* glob resolves all models of that provider", () => {
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["anthropic/*"] })));
  expect(rows.map((r) => r.provider).sort()).toEqual(["anthropic", "anthropic"]);
  expect(rows.map((r) => r.model).sort()).toEqual(["claude-opus", "claude-sonnet"]);
});

test("model-id-only pattern (no provider) resolves uniquely-matched id", () => {
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["gpt-4o-mini"] })));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
});

test(":thinking suffix is parsed off the pattern and attached to the entry", () => {
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["anthropic/claude-sonnet:high"] })));
  expect(rows).toHaveLength(1);
  expect(rows[0].model).toBe("claude-sonnet");
  expect(rows[0].thinking).toBe("high");
});

test(":thinking suffix does not leak into the matched model id", () => {
  // a pattern like provider/model:medium must match the bare model id
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["openai/gpt-4o:medium"] })));
  expect(rows[0].model).toBe("gpt-4o");
  expect(rows[0].thinking).toBe("medium");
});

test("duplicate patterns are deduped", () => {
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["anthropic/claude-sonnet", "anthropic/*"] })));
  const ids = rows.map((r) => `${r.provider}/${r.model}`);
  expect(ids).toHaveLength(new Set(ids).size);
});

test("a trailing colon that is not a thinking level is treated as part of the pattern", () => {
  // "foo:" is not a thinking level, so the whole string is the pattern (no match)
  const rows = loadScopedModels(ctxWith(JSON.stringify({ enabledModels: ["anthropic/claude-sonnet:banana"] })));
  expect(rows).toHaveLength(0);
});
