import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Text, parseKey } from "@earendil-works/pi-tui";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let mod;
try {
  mod = require("./index.ts");
} catch {
  mod = null;
}

const extension = mod?.default;
const FREEFORM_OPTION = mod?.FREEFORM_OPTION ?? "✎ Type something…";

function makePi() {
  const registered = [];
  const eventBus = {
    emitted: [],
    emit(channel, data) {
      this.emitted.push({ channel, data });
    },
    on() {
      return () => {};
    },
  };
  const pi = {
    events: eventBus,
    on() {},
    registerTool(definition) {
      registered.push(definition);
      return { definition };
    },
  };
  if (extension) extension(pi);
  assert.equal(registered.length, extension ? 1 : 0, "extension registers exactly one tool");
  return { pi, tool: registered[0], eventBus };
}

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function makeCtx(overrides = {}) {
  const calls = { select: [], input: [] };
  const selectQueue = [];
  const inputQueue = [];
  const ui = {
    select(title, options) {
      calls.select.push({ title, options });
      const next = selectQueue.length > 0 ? selectQueue.shift() : "select";
      if (typeof next === "function") return Promise.resolve(next(title, options));
      return Promise.resolve(next);
    },
    input(title, placeholder) {
      calls.input.push({ title, placeholder });
      const next = inputQueue.length > 0 ? inputQueue.shift() : "input";
      if (typeof next === "function") return Promise.resolve(next(title, placeholder));
      return Promise.resolve(next);
    },
    notify() {},
  };
  return {
    calls,
    selectQueue,
    inputQueue,
    ctx: {
      mode: "rpc",
      hasUI: true,
      ui,
      signal: undefined,
      ...overrides,
    },
  };
}

function execute(tool, params, ctx) {
  return tool.execute("call-1", params, undefined, undefined, ctx);
}

function text(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

describe("ask_user contract", { skip: !mod }, () => {
describe("contract", () => {
it("registers the ask_user tool with the contract shape", () => {
  const { tool } = makePi();
  assert.equal(tool.name, "ask_user");
  assert.equal(tool.label, "Ask User");
  assert.equal(typeof tool.execute, "function");
  assert.equal(typeof tool.renderCall, "function");
  assert.equal(typeof tool.renderResult, "function");
  const props = tool.parameters.properties;
  assert.ok(props.question);
  assert.ok(props.questions);
  assert.ok(props.options);
  assert.ok(props.multiSelect);
  assert.ok(props.allowFreeform);
});

it("[Validation rejects conflicting or missing question parameters] both question and questions is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(
    tool,
    {
      question: "Q1?",
      options: ["a", "b"],
      questions: [
        { question: "Q1?", options: ["a", "b"] },
        { question: "Q2?", options: ["c", "d"] },
      ],
    },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.equal(
    text(result),
    "ask_user: provide exactly one of `question` or `questions`, not both",
  );
});

it("[Validation rejects conflicting or missing question parameters] neither question nor questions is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(
    tool,
    { options: ["a", "b"] },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.equal(
    text(result),
    "ask_user: provide `question` (single) or `questions` (batch), one of the two is required",
  );
});

it("[Validation rejects out-of-bounds option counts] one option is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(tool, { question: "Q?", options: ["a"] }, ctx);
  assert.equal(result.isError, true);
  assert.equal(text(result), "ask_user: each question needs 2–5 options, got 1");
});

it("[Validation rejects out-of-bounds option counts] six options is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(
    tool,
    { question: "Q?", options: ["a", "b", "c", "d", "e", "f"] },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.equal(text(result), "ask_user: each question needs 2–5 options, got 6");
});

it("[Validation rejects oversized batches] five questions is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const q = (n) => ({ question: `Q${n}?`, options: ["a", "b"] });
  const result = await execute(
    tool,
    { questions: [q(1), q(2), q(3), q(4), q(5)] },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.equal(text(result), "ask_user: a batch needs 2–4 questions, got 5");
});

it("[Single question selection returns structured details] selection in RPC mode", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  selectQueue.push("beta");
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["main", "beta", "dev"] },
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.select, [
    {
      title: "Which branch?",
      options: ["main", "beta", "dev", "✎ Type something…"],
    },
  ]);
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["main", "beta", "dev"],
    answer: { kind: "selection", selections: ["beta"] },
    cancelled: false,
  });
  assert.match(text(result), /beta/);
});

it("[Single question selection returns structured details] no freeform option when allowFreeform is false", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  selectQueue.push("dev");
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["main", "dev"], allowFreeform: false },
    ctx,
  );
  assert.deepEqual(calls.select[0].options, ["main", "dev"]);
  assert.deepEqual(result.details.answer, {
    kind: "selection",
    selections: ["dev"],
  });
});

it("[Single question freeform returns structured details] freeform path in RPC mode", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, inputQueue, calls } = makeCtx();
  selectQueue.push("✎ Type something…");
  inputQueue.push("custom answer");
  const result = await execute(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    ctx,
  );
  assert.deepEqual(inputQueue, []);
  assert.equal(calls.input.length, 1);
  assert.equal(calls.input[0].title, "Describe the issue");
  assert.deepEqual(result.details, {
    question: "Describe the issue",
    options: ["Option A", "Option B"],
    answer: { kind: "freeform", text: "custom answer" },
    cancelled: false,
  });
});

it("[Single question freeform returns structured details] empty freeform input cancels", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, inputQueue } = makeCtx();
  selectQueue.push("✎ Type something…");
  inputQueue.push("");
  const result = await execute(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    ctx,
  );
  assert.deepEqual(result.details, {
    question: "Describe the issue",
    options: ["Option A", "Option B"],
    answer: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
});

it("[Batch of two returns index-aligned answers] answers in asked order", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, inputQueue } = makeCtx();
  selectQueue.push("opt1", "✎ Type something…");
  inputQueue.push("custom");
  const result = await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["opt1", "opt2"] },
        { question: "Q2?", options: ["x", "y"] },
      ],
    },
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details, {
    kind: "batch",
    questions: [
      { question: "Q1?", options: ["opt1", "opt2"] },
      { question: "Q2?", options: ["x", "y"] },
    ],
    answers: [
      { kind: "selection", selections: ["opt1"] },
      { kind: "freeform", text: "custom" },
    ],
    cancelled: false,
  });
});

it("[Cancelling any batch question cancels the whole batch] second question cancelled", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  selectQueue.push("opt1", undefined);
  const result = await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["opt1", "opt2"] },
        { question: "Q2?", options: ["x", "y"] },
      ],
    },
    ctx,
  );
  assert.equal(calls.select.length, 2);
  assert.deepEqual(result.details, {
    kind: "batch",
    questions: [
      { question: "Q1?", options: ["opt1", "opt2"] },
      { question: "Q2?", options: ["x", "y"] },
    ],
    answers: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
});

it("batch validation rejects out-of-bounds options on any question", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["opt1", "opt2"] },
        { question: "Q2?", options: ["x"] },
      ],
    },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.equal(text(result), "ask_user: each question needs 2–5 options, got 1");
});

it("[Non-dialog mode returns a graceful unavailable result] print mode", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue } = makeCtx({ mode: "print", hasUI: false });
  selectQueue.push("a");
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["a", "b"] },
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.equal(text(result), "ask_user is unavailable outside interactive modes");
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["a", "b"],
    answer: null,
    cancelled: true,
  });
});

it("[Non-dialog mode returns a graceful unavailable result] batch in json mode", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx({ mode: "json", hasUI: false });
  const result = await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["a", "b"] },
        { question: "Q2?", options: ["c", "d"] },
      ],
    },
    ctx,
  );
  assert.equal(text(result), "ask_user is unavailable outside interactive modes");
  assert.equal(result.details.kind, "batch");
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.answers, null);
});

it("[Non-dialog mode returns a graceful unavailable result] rpc mode without UI", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx({ mode: "rpc", hasUI: false });
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["a", "b"] },
    ctx,
  );
  assert.equal(text(result), "ask_user is unavailable outside interactive modes");
  assert.equal(result.details.cancelled, true);
});

it("[Answer outcome emits the answered event once] selection emits ask:answered", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push("beta");
  await execute(tool, { question: "Which branch?", options: ["main", "beta"] }, ctx);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    question: "Which branch?",
    kind: "selection",
  });
});

it("[Answer outcome emits the answered event once] freeform emits ask:answered with kind freeform", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue, inputQueue } = makeCtx();
  selectQueue.push(FREEFORM_OPTION);
  inputQueue.push("custom answer");
  await execute(tool, { question: "Describe", options: ["A", "B"] }, ctx);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Describe", kind: "freeform" });
});

it("[Answer outcome emits the answered event once] batch answered emits once per question in order", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push("opt1", "x");
  await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["opt1", "opt2"] },
        { question: "Q2?", options: ["x", "y"] },
      ],
    },
    ctx,
  );
  const events = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.data.question),
    ["Q1?", "Q2?"],
  );
});

it("[Cancellation emits the cancelled event once] dialog cancel emits ask:cancelled", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push(undefined);
  await execute(tool, { question: "Which branch?", options: ["a", "b"] }, ctx);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:cancelled");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Which branch?" });
  assert.equal(eventBus.emitted.filter((e) => e.channel === "ask:answered").length, 0);
});

it("[Cancellation emits the cancelled event once] batch cancel emits once for the cancelled question only", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push("opt1", undefined);
  await execute(
    tool,
    {
      questions: [
        { question: "Q1?", options: ["opt1", "opt2"] },
        { question: "Q2?", options: ["x", "y"] },
      ],
    },
    ctx,
  );
  assert.deepEqual(
    eventBus.emitted.filter((e) => e.channel === "ask:answered").map((e) => e.data.question),
    ["Q1?"],
  );
  const cancelled = eventBus.emitted.filter((e) => e.channel === "ask:cancelled");
  assert.equal(cancelled.length, 1);
  assert.deepEqual(cancelled[0].data, { question: "Q2?" });
});

it("unavailable mode and validation errors fire no events", async () => {
  const { tool, eventBus } = makePi();
  const unavailable = makeCtx({ mode: "print", hasUI: false });
  await execute(tool, { question: "Q?", options: ["a", "b"] }, unavailable.ctx);
  await execute(tool, { question: "Q?" }, makeCtx().ctx);
  assert.deepEqual(eventBus.emitted, []);
});

it("[Render call summarizes question and options] single call shows question and options", () => {
  const { tool } = makePi();
  const component = tool.renderCall(
    { question: "Which branch?", options: ["main", "dev"] },
    theme,
    {},
  );
  assert.ok(component instanceof Text);
  const rendered = component.render(120).join("");
  assert.match(rendered, /Which branch/);
  assert.match(rendered, /main/);
  assert.match(rendered, /dev/);
});

it("[Render call summarizes question and options] batch call is truncated to 120 chars", () => {
  const { tool } = makePi();
  const long = (n) => `question ${n} with a fairly long label to fill space up`;
  const component = tool.renderCall(
    {
      questions: [
        { question: long(1), options: ["opt-a", "opt-b"] },
        { question: long(2), options: ["opt-c", "opt-d"] },
        { question: long(3), options: ["opt-e", "opt-f"] },
        { question: long(4), options: ["opt-g", "opt-h"] },
      ],
    },
    theme,
    {},
  );
  const rendered = component.render(200).join("").trimEnd();
  const summary = rendered.replace(/^ask_user /, "");
  assert.equal(summary.length, 120, "batch summary truncated to exactly 120 chars");
  assert.ok(rendered.endsWith("…"), "truncation marker present");
  assert.match(rendered, /Ask \(4 questions\):/);
});

it("[Render result shows success or cancelled rows] answered single selection shows number and label", () => {
  const { tool } = makePi();
  const component = tool.renderResult(
    {
      content: [{ type: "text", text: "User selected: beta" }],
      details: {
        question: "Which branch?",
        options: ["main", "beta", "dev"],
        answer: { kind: "selection", selections: ["beta"] },
        cancelled: false,
      },
    },
    { expanded: false, isPartial: false },
    theme,
    {},
  );
  const rendered = component.render(80).join("");
  assert.match(rendered, /✓ 2\. beta/);
});

it("[Render result shows success or cancelled rows] freeform shows the custom text", () => {
  const { tool } = makePi();
  const component = tool.renderResult(
    {
      content: [{ type: "text", text: "User answer: custom answer" }],
      details: {
        question: "Describe",
        options: ["A", "B"],
        answer: { kind: "freeform", text: "custom answer" },
        cancelled: false,
      },
    },
    { expanded: false, isPartial: false },
    theme,
    {},
  );
  assert.match(component.render(80).join(""), /✓ custom answer/);
});

it("[Render result shows success or cancelled rows] cancelled shows a warning row", () => {
  const { tool } = makePi();
  const component = tool.renderResult(
    {
      content: [{ type: "text", text: "The user declined." }],
      details: { question: "Q?", options: ["a", "b"], answer: null, cancelled: true },
    },
    { expanded: false, isPartial: false },
    theme,
    {},
  );
  assert.match(component.render(80).join(""), /✗ cancelled/);
});

it("[Render result shows success or cancelled rows] batch answered and cancelled rows", () => {
  const { tool } = makePi();
  const answered = tool.renderResult(
    {
      content: [{ type: "text", text: "Batch answered: a; c" }],
      details: {
        kind: "batch",
        questions: [
          { question: "Q1?", options: ["a", "b"] },
          { question: "Q2?", options: ["c", "d"] },
        ],
        answers: [
          { kind: "selection", selections: ["a"] },
          { kind: "selection", selections: ["c"] },
        ],
        cancelled: false,
      },
    },
    { expanded: false, isPartial: false },
    theme,
    {},
  );
  assert.match(answered.render(80).join(""), /✓ 2 answers collected/);
  const cancelled = tool.renderResult(
    {
      content: [{ type: "text", text: "declined" }],
      details: { kind: "batch", questions: [], answers: null, cancelled: true },
    },
    { expanded: false, isPartial: false },
    theme,
    {},
  );
  assert.match(cancelled.render(80).join(""), /✗ cancelled \(batch\)/);
});

it("[Prompt guidelines steer the model to focused questions] snippet and guidelines", () => {
  const { tool } = makePi();
  assert.equal(
    tool.promptSnippet,
    "Use ask_user to ask the user a focused decision question with 2–5 options.",
  );
  const guidelines = tool.promptGuidelines.join("\n");
  assert.match(guidelines, /ONE focused/i);
  assert.match(guidelines, /2–5 mutually exclusive options/);
  assert.match(guidelines, /questions.*2–4/s);
  assert.match(guidelines, /multiSelect/i);
});

});

function makeTuiCtx() {
  const controller = new AbortController();
  let captured = null;
  const ui = {
    select() {
      throw new Error("select should not be called in TUI mode");
    },
    input() {
      throw new Error("input should not be called in TUI mode");
    },
    notify() {},
    custom(factory) {
      const component = factory(null, null, null, (output) => {
        captured.output = output;
        captured.resolve(output);
      });
      captured = { component, output: null };
      return new Promise((resolve) => {
        captured.resolve = resolve;
      });
    },
  };
  return {
    ctx: { mode: "tui", hasUI: true, ui, signal: controller.signal },
    controller,
    get component() {
      return captured.component;
    },
    render() {
      return captured.component.render(72);
    },
    keys(...keys) {
      for (const key of keys) captured.component.handleInput(key);
    },
    output() {
      return captured.output;
    },
  };
}

const KEY_SEQS = {
  up: "\u001b[A",
  down: "\u001b[B",
  left: "\u001b[D",
  right: "\u001b[C",
  enter: "\r",
  escape: "\u001b",
  tab: "\t",
  "shift+tab": "\u001b[Z",
  backspace: "\b",
  delete: "\u001b[3~",
};

describe("parseKey raw sequences", { skip: !mod }, () => {
it("maps each raw sequence in KEY_SEQS to its key name", () => {
  for (const [name, seq] of Object.entries(KEY_SEQS)) {
    assert.equal(parseKey(seq), name, `parseKey(${JSON.stringify(seq)})`);
  }
});
});

function runTui(tool, params, keyScript) {
  const tui = makeTuiCtx();
  const pending = execute(tool, params, tui.ctx);
  for (const step of keyScript) {
    if (typeof step === "string") {
      tui.keys(KEY_SEQS[step] ?? step);
    } else if (typeof step === "function") {
      step(tui);
    }
  }
  return { tui, pending };
}

describe("TUI popup", { skip: !mod }, () => {
it("[TUI single-select popup confirms a focused option] navigate to the second option and press Enter", async () => {
  const { tool, eventBus } = makePi();
  const { tui, pending } = runTui(
    tool,
    { question: "Which branch?", options: ["main", "beta", "dev"] },
    [
      (c) => {
        const lines = c.render();
        assert.match(lines.join("\n"), /Which branch/);
        assert.match(lines.join("\n"), /1\. main/);
        assert.ok(!lines.some((l) => l.includes("▶ 2. beta")), "first option focused by default");
      },
      "down",
      "enter",
    ],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["main", "beta", "dev"],
    answer: { kind: "selection", selections: ["beta"] },
    cancelled: false,
  });
  assert.match(text(result), /beta/);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Which branch?", kind: "selection" });
});

it("[TUI freeform editor submits non-empty text] open the freeform row, type, and press Enter", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    [
      "down",
      "down",
      "enter",
      (c) => assert.match(c.render().join("\n"), /Esc back  Enter submit/),
      "h",
      "e",
      "l",
      "l",
      "o",
      "enter",
    ],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Describe the issue",
    options: ["Option A", "Option B"],
    answer: { kind: "freeform", text: "hello" },
    cancelled: false,
  });
  assert.match(text(result), /hello/);
});

it("[TUI freeform Esc returns to options without answering] Esc in the editor restores the options list", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    [
      "down",
      "down",
      "a",
      "b",
      "c",
      "escape",
      (c) => {
        const lines = c.render().join("\n");
        assert.match(lines, /1\. Option A/);
        assert.match(lines, /2\. Option B/);
        assert.match(lines, /✎ Type something…/);
      },
      "1",
    ],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Describe the issue",
    options: ["Option A", "Option B"],
    answer: { kind: "selection", selections: ["Option A"] },
    cancelled: false,
  });
});

it("[TUI Esc cancels the prompt with cancelled details] pressing Esc on the options cancels", async () => {
  const { tool, eventBus } = makePi();
  const { pending } = runTui(tool, { question: "Which branch?", options: ["a", "b"] }, ["escape"]);
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["a", "b"],
    answer: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:cancelled");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Which branch?" });
});

it("[Aborting the agent dismisses the open prompt] abort signal resolves with cancelled details", async () => {
  const { tool } = makePi();
  const { tui, pending } = runTui(tool, { question: "Which branch?", options: ["a", "b"] }, []);
  await new Promise((resolve) => setImmediate(resolve));
  tui.controller.abort();
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["a", "b"],
    answer: null,
    cancelled: true,
  });
});

it("[TUI multi-select commits the selected set on Done] toggle two options on and confirm Done", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Select services", options: ["api", "web", "db", "cache"], multiSelect: true },
    [
      (c) => {
        const lines = c.render().join("\n");
        assert.match(lines, /\[ \] 1\. api/);
        assert.match(lines, /✓ Done/);
      },
      "1",
      "3",
      (c) => {
        const lines = c.render().join("\n");
        assert.match(lines, /\[x\] 1\. api/);
        assert.match(lines, /\[x\] 3\. db/);
        assert.match(lines, /\[ \] 2\. web/);
      },
      "down",
      "down",
      "down",
      "down",
      "enter",
    ],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Select services",
    options: ["api", "web", "db", "cache"],
    answer: { kind: "selection", selections: ["api", "db"] },
    cancelled: false,
  });
  assert.match(text(result), /api, db/);
});

it("[TUI multi-select toggling is reversible before Done] toggle on, off, on another; only the final set commits", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Select services", options: ["api", "web", "db", "cache"], multiSelect: true },
    [
      "1",
      (c) => assert.match(c.render().join("\n"), /\[x\] 1\. api/),
      "1",
      (c) => assert.match(c.render().join("\n"), /\[ \] 1\. api/),
      "2",
      (c) => assert.match(c.render().join("\n"), /\[x\] 2\. web/),
      "down",
      "down",
      "down",
      "down",
      "enter",
    ],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Select services",
    options: ["api", "web", "db", "cache"],
    answer: { kind: "selection", selections: ["web"] },
    cancelled: false,
  });
});

it("[TUI popup number keys jump to an option] pressing number three confirms the third option immediately", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Which branch?", options: ["main", "beta", "dev"] },
    ["3"],
  );
  const result = await pending;
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["main", "beta", "dev"],
    answer: { kind: "selection", selections: ["dev"] },
    cancelled: false,
  });
  assert.match(text(result), /dev/);
});

it("[TUI batch switches pages without losing answers] answer page 1, Tab to page 2, both answers retained", async () => {
  const { tool } = makePi();
  const questions = [
    { question: "Q1?", options: ["opt1", "opt2"] },
    { question: "Q2?", options: ["x", "y"] },
  ];
  const { pending } = runTui(tool, { questions }, [
    (c) => assert.match(c.render().join("\n"), /Q1\?/),
    "2",
    (c) => assert.match(c.render().join("\n"), /Q2\?/),
    "1",
    (c) => {
      const review = c.render().join("\n");
      assert.match(review, /Review/);
      assert.match(review, /1\. Q1\?  →  opt2/);
      assert.match(review, /2\. Q2\?  →  x/);
    },
    "enter",
  ]);
  const result = await pending;
  assert.deepEqual(result.details, {
    kind: "batch",
    questions,
    answers: [
      { kind: "selection", selections: ["opt2"] },
      { kind: "selection", selections: ["x"] },
    ],
    cancelled: false,
  });
  assert.match(text(result), /opt2/);
  assert.match(text(result), /x/);
});

it("[TUI review page warns then submits with skips] first Enter warns, second Enter submits with (skipped)", async () => {
  const { tool, eventBus } = makePi();
  const questions = [
    { question: "Which branch?", options: ["main", "dev"] },
    { question: "Deploy env?", options: ["staging", "prod"] },
  ];
  const { pending } = runTui(tool, { questions }, [
    "1",
    (c) => assert.match(c.render().join("\n"), /Deploy env\?/),
    "tab",
    (c) => assert.match(c.render().join("\n"), /Review/),
    "enter",
    (c) => assert.match(c.render().join("\n"), /⚠ 1 question unanswered/),
    "enter",
  ]);
  const result = await pending;
  assert.deepEqual(result.details, {
    kind: "batch",
    questions,
    answers: [
      { kind: "selection", selections: ["main"] },
      { kind: "freeform", text: "(skipped)" },
    ],
    cancelled: false,
  });
  const answered = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(answered.length, 1);
  assert.deepEqual(answered[0].data, { question: "Which branch?", kind: "selection" });
});

it("[Render result shows success or cancelled rows] TUI selection result row shows the success marker", async () => {
  const { tool } = makePi();
  const { pending } = runTui(
    tool,
    { question: "Which branch?", options: ["main", "dev"] },
    ["down", "enter"],
  );
  const result = await pending;
  const component = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
  assert.match(component.render(80).join(""), /✓ 2\. dev/);
});

it("TUI batch number keys jump back to a page from the review", async () => {
  const { tool } = makePi();
  const questions = [
    { question: "Q1?", options: ["opt1", "opt2"] },
    { question: "Q2?", options: ["x", "y"] },
  ];
  const { tui, pending } = runTui(tool, { questions }, [
    "1",
    (c) => assert.match(c.render().join("\n"), /Q2\?/),
    "1",
    (c) => assert.match(c.render().join("\n"), /Review/),
    "1",
    (c) => assert.match(c.render().join("\n"), /Q1\?/),
    "1",
    (c) => assert.match(c.render().join("\n"), /Q2\?/),
    "1",
    (c) => assert.match(c.render().join("\n"), /Review/),
    "enter",
  ]);
  await pending;
});

it("[TUI Esc cancels the prompt with cancelled details] Esc on a batch page cancels the whole batch", async () => {
  const { tool, eventBus } = makePi();
  const questions = [
    { question: "Q1?", options: ["a", "b"] },
    { question: "Q2?", options: ["c", "d"] },
  ];
  const { pending } = runTui(tool, { questions }, ["escape"]);
  const result = await pending;
  assert.deepEqual(result.details, {
    kind: "batch",
    questions,
    answers: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
  const cancelled = eventBus.emitted.filter((e) => e.channel === "ask:cancelled");
  assert.equal(cancelled.length, 1);
  assert.deepEqual(cancelled[0].data, { question: "Q2?" });
});

it("[Aborting the agent dismisses the open prompt] abort dismisses an open batch popup", async () => {
  const { tool } = makePi();
  const questions = [
    { question: "Q1?", options: ["a", "b"] },
    { question: "Q2?", options: ["c", "d"] },
  ];
  const { tui, pending } = runTui(tool, { questions }, []);
  await new Promise((resolve) => setImmediate(resolve));
  tui.controller.abort();
  const result = await pending;
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.answers, null);
});

describe("TUI/RPC parity", () => {
it("single selection: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const rpc = makeCtx();
  rpc.selectQueue.push("beta");
  const rpcResult = await execute(
    tool,
    { question: "Which branch?", options: ["main", "beta", "dev"] },
    rpc.ctx,
  );
  const { pending } = runTui(
    tool,
    { question: "Which branch?", options: ["main", "beta", "dev"] },
    ["down", "enter"],
  );
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});

it("single freeform: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const rpc = makeCtx();
  rpc.selectQueue.push("✎ Type something…");
  rpc.inputQueue.push("custom answer");
  const rpcResult = await execute(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    rpc.ctx,
  );
  const { pending } = runTui(
    tool,
    { question: "Describe the issue", options: ["Option A", "Option B"] },
    ["down", "down", "enter", "c", "u", "s", "t", "o", "m", " ", "a", "n", "s", "w", "e", "r", "enter"],
  );
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});

it("single cancel: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const rpc = makeCtx();
  rpc.selectQueue.push(undefined);
  const rpcResult = await execute(
    tool,
    { question: "Which branch?", options: ["main", "dev"] },
    rpc.ctx,
  );
  const { pending } = runTui(tool, { question: "Which branch?", options: ["main", "dev"] }, ["escape"]);
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});

it("multi-select: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const rpc = makeCtx();
  rpc.selectQueue.push("api", "db", "Done");
  const rpcResult = await execute(
    tool,
    { question: "Select services", options: ["api", "web", "db", "cache"], multiSelect: true },
    rpc.ctx,
  );
  const { pending } = runTui(
    tool,
    { question: "Select services", options: ["api", "web", "db", "cache"], multiSelect: true },
    ["1", "3", "down", "down", "down", "down", "enter"],
  );
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});

it("batch answered: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const questions = [
    { question: "Q1?", options: ["opt1", "opt2"] },
    { question: "Q2?", options: ["x", "y"] },
  ];
  const rpc = makeCtx();
  rpc.selectQueue.push("opt1", "x");
  const rpcResult = await execute(tool, { questions }, rpc.ctx);
  const { pending } = runTui(tool, { questions }, ["1", "1", "enter", "enter"]);
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});

it("batch cancelled: TUI details equal RPC details", async () => {
  const { tool } = makePi();
  const questions = [
    { question: "Q1?", options: ["opt1", "opt2"] },
    { question: "Q2?", options: ["x", "y"] },
  ];
  const rpc = makeCtx();
  rpc.selectQueue.push("opt1", undefined);
  const rpcResult = await execute(tool, { questions }, rpc.ctx);
  const { pending } = runTui(tool, { questions }, ["escape"]);
  const tuiResult = await pending;
  assert.deepEqual(tuiResult.details, rpcResult.details);
});
});
});

describe("multi-select and cancellation", { skip: !mod }, () => {
it("[Multi-select commits the explicit selection on Done] commits only the toggled set", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  selectQueue.push("api", "db", "Done");
  const result = await execute(
    tool,
    {
      question: "Select services",
      options: ["api", "web", "db", "cache"],
      multiSelect: true,
    },
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details, {
    question: "Select services",
    options: ["api", "web", "db", "cache"],
    answer: { kind: "selection", selections: ["api", "db"] },
    cancelled: false,
  });
  assert.equal(calls.select.length, 3);
  assert.ok(calls.select[0].title.includes("api") && calls.select[0].title.includes("web"));
  for (const option of ["api", "web", "db", "cache", "Done"]) {
    assert.ok(calls.select[0].options.includes(option), `first round offers ${option}`);
  }
  assert.ok(calls.select[0].options.includes(FREEFORM_OPTION));
});

it("[Multi-select round cap without Done cancels without partial commit] toggling back and forth until the cap cancels", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  const cap = Math.max(32, 4 + 2);
  selectQueue.push(...Array.from({ length: cap }, (_, i) => (i % 2 === 0 ? "api" : "web")));
  const result = await execute(
    tool,
    {
      question: "Select services",
      options: ["api", "web", "db", "cache"],
      multiSelect: true,
    },
    ctx,
  );
  assert.equal(calls.select.length, cap);
  assert.deepEqual(result.details, {
    question: "Select services",
    options: ["api", "web", "db", "cache"],
    answer: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
});

it("[Multi-select commits the explicit selection on Done] all options on commits immediately", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue, calls } = makeCtx();
  selectQueue.push("a", "b");
  const result = await execute(
    tool,
    { question: "Pick", options: ["a", "b"], multiSelect: true, allowFreeform: false },
    ctx,
  );
  assert.equal(calls.select.length, 2);
  assert.deepEqual(result.details.answer, {
    kind: "selection",
    selections: ["a", "b"],
  });
  assert.equal(result.details.cancelled, false);
});

it("[Multi-select commits the explicit selection on Done] cancelling a round cancels with no partial commit", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push("a", undefined);
  const result = await execute(
    tool,
    { question: "Pick", options: ["a", "b"], multiSelect: true, allowFreeform: false },
    ctx,
  );
  assert.deepEqual(result.details, {
    question: "Pick",
    options: ["a", "b"],
    answer: null,
    cancelled: true,
  });
});

it("[Dialog cancellation returns cancelled with no answer] dialog cancel in RPC mode", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push(undefined);
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["main", "dev"] },
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["main", "dev"],
    answer: null,
    cancelled: true,
  });
  assert.match(text(result), /declined/);
});

it("validation errors carry cancelled details and fire no events", async () => {
  const { tool, eventBus } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(tool, { question: "Q?" }, ctx);
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { cancelled: true, answer: null });
  assert.deepEqual(eventBus.emitted, []);
});
});
});
