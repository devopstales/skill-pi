import { assert, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildPeekLabel,
  clipTail,
  collectPeekParts,
  createPeekState,
  peekTail,
  reducePeek,
} from "./src/peek.ts";
import type { IconGlyphs } from "./src/icons.ts";

const glyphs = { thinking: "~", done: "+" } as unknown as IconGlyphs;

it("collectPeekParts joins thinking and answer text, ignoring other parts", () => {
  const parts = collectPeekParts([
    { type: "thinking", thinking: "alpha" },
    { type: "text", text: "answer" },
    { type: "toolCall", id: "x", name: "read", arguments: {} },
    { type: "thinking", thinking: " beta" },
  ]);
  assert.deepEqual(parts, { thinking: "alpha beta", text: "answer" });
});

it("collectPeekParts tolerates non-array content", () => {
  assert.deepEqual(collectPeekParts(undefined), { thinking: "", text: "" });
  assert.deepEqual(collectPeekParts("nope"), { thinking: "", text: "" });
});

it("collectPeekParts ignores non-string fields without coercing or throwing", () => {
  assert.deepEqual(
    collectPeekParts([
      { type: "thinking", thinking: Symbol("invalid"), text: "fallback" },
      { type: "thinking", thinking: { invalid: true }, text: " next" },
      { type: "text", text: { invalid: true } },
      { type: "text", text: Symbol("invalid") },
    ]),
    { thinking: "fallback next", text: "" },
  );
});

it("peekTail shows the last logical line only", () => {
  assert.equal(peekTail("first line\nsecond line here"), "second line here");
});

it("peekTail keeps the last two logical lines when requested", () => {
  assert.equal(peekTail("first\nsecond\n\nthird", 2), "second\nthird");
});

it("peekTail trims and collapses whitespace", () => {
  assert.equal(peekTail("  padded   text  \n"), "padded text");
  assert.equal(peekTail("   "), "");
  assert.equal(peekTail(""), "");
});

it("peekTail keeps the full tail; width bounding is clipTail's job", () => {
  assert.equal(peekTail("x".repeat(500)).length, 500);
});

it("clipTail keeps the end of long text within budget", () => {
  assert.equal(clipTail("x".repeat(500), 10), "…" + "x".repeat(9));
});

it("clipTail truncates wide CJK text by visible width, not code points", () => {
  const tail = clipTail("思".repeat(100), 10);
  assert.equal(tail, "…" + "思".repeat(4));
  assert.ok(visibleWidth(tail) <= 10);
});

it("clipTail returns text that already fits untouched", () => {
  assert.equal(clipTail("short", 10), "short");
  assert.equal(clipTail("思思", 4), "思思");
});

it("clipTail handles degenerate budgets", () => {
  assert.equal(clipTail("abc", 0), "");
  assert.equal(clipTail("abc", -5), "");
  assert.equal(clipTail("", 5), "");
  assert.equal(clipTail("abcdef", 1), "…");
});

it("clipTail preserves complete graphemes at the tail boundary", () => {
  for (const grapheme of ["😀", "👩‍💻", "e\u0301"]) {
    const tail = clipTail(grapheme.repeat(50), 5);
    assert.equal(tail, "…" + grapheme.repeat(Math.floor(4 / visibleWidth(grapheme))));
    assert.ok(visibleWidth(tail) <= 5);
  }
});

it("buildPeekLabel renders each phase", () => {
  const state = createPeekState();
  assert.equal(buildPeekLabel(state, 0, glyphs, 80), "~ think ·");

  state.phase = "thinking";
  state.tail = "thinking about the problem";
  const thinking = buildPeekLabel(state, 1, glyphs, 80);
  assert.ok(thinking.startsWith("~ think"));
  assert.ok(thinking.includes("thinking about the problem"));

  state.phase = "done";
  assert.equal(buildPeekLabel(state, 1, glyphs, 80), "~ think +");
});

it("reducePeek drives the phase machine", () => {
  let state = createPeekState();
  state = reducePeek(state, { thinking: "hmm", text: "" });
  assert.equal(state.phase, "thinking");
  assert.equal(state.tail, "hmm");
  state = reducePeek(state, { thinking: "hmm more", text: "answer" });
  assert.equal(state.phase, "done");
  state = reducePeek(state, { thinking: "hmm more still", text: "answer more" });
  assert.equal(state.phase, "done");
});

it("buildPeekLabel fits the label within the width budget", () => {
  const state = createPeekState();
  state.phase = "thinking";
  state.tail = "x".repeat(500);
  const label = buildPeekLabel(state, 0, glyphs, 30);
  assert.ok(visibleWidth(label.split("\n")[0]) <= 30);
});
