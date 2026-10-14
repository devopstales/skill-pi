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
