import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@earendil-works/pi-tui";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let mod;
try {
  mod = require("../extensions/ask-user.ts");
} catch {
  mod = null;
}

const extension = mod.default;
const FREEFORM_OPTION = mod.FREEFORM_OPTION ?? "✎ Type something…";

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
  extension(pi);
  assert.equal(registered.length, 1, "extension registers exactly one tool");
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

test("registers the ask_user tool with the contract shape", () => {
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

test("[Validation rejects conflicting or missing question parameters] both question and questions is an error", async () => {
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

test("[Validation rejects conflicting or missing question parameters] neither question nor questions is an error", async () => {
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

test("[Validation rejects out-of-bounds option counts] one option is an error", async () => {
  const { tool } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(tool, { question: "Q?", options: ["a"] }, ctx);
  assert.equal(result.isError, true);
  assert.equal(text(result), "ask_user: each question needs 2–5 options, got 1");
});

test("[Validation rejects out-of-bounds option counts] six options is an error", async () => {
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

test("[Validation rejects oversized batches] five questions is an error", async () => {
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

test("[Single question selection returns structured details] selection in RPC mode", async () => {
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

test("[Single question selection returns structured details] no freeform option when allowFreeform is false", async () => {
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

test("[Single question freeform returns structured details] freeform path in RPC mode", async () => {
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

test("[Single question freeform returns structured details] empty freeform input cancels", async () => {
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

test("[Batch of two returns index-aligned answers] answers in asked order", async () => {
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

test("[Cancelling any batch question cancels the whole batch] second question cancelled", async () => {
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

test("batch validation rejects out-of-bounds options on any question", async () => {
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

test("[Non-dialog mode returns a graceful unavailable result] print mode", async () => {
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

test("[Non-dialog mode returns a graceful unavailable result] batch in json mode", async () => {
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

test("[Non-dialog mode returns a graceful unavailable result] rpc mode without UI", async () => {
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

test("[Answer outcome emits the answered event once] selection emits ask:answered", async () => {
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

test("[Answer outcome emits the answered event once] freeform emits ask:answered with kind freeform", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue, inputQueue } = makeCtx();
  selectQueue.push(FREEFORM_OPTION);
  inputQueue.push("custom answer");
  await execute(tool, { question: "Describe", options: ["A", "B"] }, ctx);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:answered");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Describe", kind: "freeform" });
});

test("[Answer outcome emits the answered event once] batch answered emits once per question in order", async () => {
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

test("[Cancellation emits the cancelled event once] dialog cancel emits ask:cancelled", async () => {
  const { tool, eventBus } = makePi();
  const { ctx, selectQueue } = makeCtx();
  selectQueue.push(undefined);
  await execute(tool, { question: "Which branch?", options: ["a", "b"] }, ctx);
  const events = eventBus.emitted.filter((e) => e.channel === "ask:cancelled");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { question: "Which branch?" });
  assert.equal(eventBus.emitted.filter((e) => e.channel === "ask:answered").length, 0);
});

test("[Cancellation emits the cancelled event once] batch cancel emits once for the cancelled question only", async () => {
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

test("unavailable mode and validation errors fire no events", async () => {
  const { tool, eventBus } = makePi();
  const unavailable = makeCtx({ mode: "print", hasUI: false });
  await execute(tool, { question: "Q?", options: ["a", "b"] }, unavailable.ctx);
  await execute(tool, { question: "Q?" }, makeCtx().ctx);
  assert.deepEqual(eventBus.emitted, []);
});

test("[Render call summarizes question and options] single call shows question and options", () => {
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

test("[Render call summarizes question and options] batch call is truncated to 120 chars", () => {
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

test("[Render result shows success or cancelled rows] answered single selection shows number and label", () => {
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

test("[Render result shows success or cancelled rows] freeform shows the custom text", () => {
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

test("[Render result shows success or cancelled rows] cancelled shows a warning row", () => {
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

test("[Render result shows success or cancelled rows] batch answered and cancelled rows", () => {
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

test("[Prompt guidelines steer the model to focused questions] snippet and guidelines", () => {
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

test("TUI mode returns the step-02 placeholder until the popup lands", async () => {
  const { tool } = makePi();
  const { ctx, selectQueue } = makeCtx({ mode: "tui", hasUI: true });
  selectQueue.push("a");
  const result = await execute(
    tool,
    { question: "Which branch?", options: ["a", "b"] },
    ctx,
  );
  assert.equal(text(result), "ask_user: TUI popup not implemented yet (step 02)");
  assert.deepEqual(result.details, {
    question: "Which branch?",
    options: ["a", "b"],
    answer: null,
    cancelled: true,
  });
});

test("[Multi-select commits the explicit selection on Done] commits only the toggled set", async () => {
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

test("[Multi-select round cap without Done cancels without partial commit] toggling back and forth until the cap cancels", async () => {
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

test("[Multi-select commits the explicit selection on Done] all options on commits immediately", async () => {
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

test("[Multi-select commits the explicit selection on Done] cancelling a round cancels with no partial commit", async () => {
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

test("[Dialog cancellation returns cancelled with no answer] dialog cancel in RPC mode", async () => {
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

test("validation errors carry cancelled details and fire no events", async () => {
  const { tool, eventBus } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(tool, { question: "Q?" }, ctx);
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { cancelled: true, answer: null });
  assert.deepEqual(eventBus.emitted, []);
});
