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

test("validation errors carry cancelled details and fire no events", async () => {
  const { tool, eventBus } = makePi();
  const { ctx } = makeCtx();
  const result = await execute(tool, { question: "Q?" }, ctx);
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { cancelled: true, answer: null });
  assert.deepEqual(eventBus.emitted, []);
});
