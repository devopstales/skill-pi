import { describe, it, expect } from "bun:test";
import { extractPreferences } from "../src/extract/preferences";
import type { NormalizedBlock } from "../src/types";

describe("extractPreferences (table)", () => {
  const cases = [
    { name: "no blocks", blocks: [] as NormalizedBlock[], expected: [] as string[] },
    {
      name: "captures prefer over",
      blocks: [{ kind: "user", text: "I prefer TypeScript over JavaScript" }] as NormalizedBlock[],
      expected: ["I prefer TypeScript over JavaScript"],
    },
    {
      name: "captures always verb",
      blocks: [{ kind: "user", text: "always use bun for tests" }] as NormalizedBlock[],
      expected: ["always use bun for tests"],
    },
    {
      name: "captures never verb",
      blocks: [{ kind: "user", text: "never commit secrets to git" }] as NormalizedBlock[],
      expected: ["never commit secrets to git"],
    },
    {
      name: "captures please use",
      blocks: [{ kind: "user", text: "please use bun instead of node" }] as NormalizedBlock[],
      expected: ["please use bun instead of node"],
    },
    {
      name: "captures dont want",
      blocks: [{ kind: "user", text: "I don't want TypeScript here" }] as NormalizedBlock[],
      expected: ["I don't want TypeScript here"],
    },
    {
      name: "captures language key",
      blocks: [{ kind: "user", text: "language: Spanish" }] as NormalizedBlock[],
      expected: ["language: Spanish"],
    },
    {
      name: "ignores assistant blocks",
      blocks: [{ kind: "assistant", text: "I always use best practices" }] as NormalizedBlock[],
      expected: [],
    },
    {
      name: "ignores questions",
      blocks: [{ kind: "user", text: "Do you prefer TypeScript over JavaScript?" }] as NormalizedBlock[],
      expected: [],
    },
    {
      name: "ignores short lines",
      blocks: [{ kind: "user", text: "never." }] as NormalizedBlock[],
      expected: [],
    },
    {
      name: "dedups case-insensitively",
      blocks: [
        { kind: "user", text: "Always run tests before committing" },
        { kind: "user", text: "always run tests before committing" },
      ] as NormalizedBlock[],
      expected: ["Always run tests before committing"],
    },
    {
      name: "caps at 10",
      blocks: Array.from({ length: 12 }, (_, i) => ({
        kind: "user",
        text: `please use option ${i}`,
      })) as NormalizedBlock[],
      expected: Array.from({ length: 10 }, (_, i) => `please use option ${i}`),
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(extractPreferences(c.blocks)).toEqual(c.expected);
    });
  }
});
