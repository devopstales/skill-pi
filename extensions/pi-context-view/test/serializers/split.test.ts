/** Phase 3d: the message serializers of `capture/adjustments.ts` live in `capture/serializers/`. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { renderExpectedUnits } from "../../src/capture/adjustments.ts";
import { addAnthropicAssistantBlock, anthropicUnits } from "../../src/capture/serializers/anthropic.ts";
import { completionsUnits } from "../../src/capture/serializers/completions.ts";
import {
	compatFlag, hasImages, openAiResultText, textOf, toolCallText,
} from "../../src/capture/serializers/helpers.ts";
import { responsesUnits } from "../../src/capture/serializers/responses.ts";

const IMAGE = { type: "image" as const, data: "bytes", mimeType: "image/png" };
const TEXT = { provider: "mock", api: "openai-completions", id: "model", input: ["text", "image"] };

test("split: the per-API serializers resolve from capture/serializers/", () => {
	assert.equal(typeof completionsUnits, "function");
	assert.equal(typeof responsesUnits, "function");
	assert.equal(typeof anthropicUnits, "function");
	assert.equal(typeof addAnthropicAssistantBlock, "function");
});

test("split: the shared serializer helpers resolve from capture/serializers/helpers.ts", () => {
	const content = [{ type: "text" as const, text: "one" }, IMAGE];
	assert.equal(textOf(content), "one");
	assert.equal(hasImages(content), true);
	assert.equal(hasImages([{ type: "text" as const, text: "two" }]), false);
	assert.equal(openAiResultText([IMAGE], false), "(see attached image)");
	assert.equal(openAiResultText([IMAGE], true), "");
	assert.equal(openAiResultText([], false), "(no tool output)");
	assert.equal(toolCallText({ name: "script", arguments: { code: "x" } }, new Map([["script", "code"]])), "x");
	assert.equal(toolCallText({ name: "read", arguments: { path: "a" } }, new Map([["script", "code"]])), "{\"path\":\"a\"}");
	assert.equal(compatFlag({ ...TEXT, compat: { allowEmptySignature: true } }, "allowEmptySignature"), true);
	assert.equal(compatFlag(TEXT, "allowEmptySignature"), false);
});

test("split: the serializer entry points behave like the pre-split implementations", () => {
	const system = { role: "system" as const, content: "Base.", timestamp: 0 };
	const user = { role: "user" as const, content: "question", timestamp: 1 };
	const assistant = {
		role: "assistant" as const, provider: "mock", api: "openai-completions", model: "model",
		stopReason: "stop" as const, timestamp: 2,
		content: [
			{ type: "text" as const, text: "answer" },
			{ type: "toolCall" as const, id: "call_1", name: "read", arguments: { path: "a.txt" } },
		],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	const toolResult = {
		role: "toolResult" as const, toolCallId: "call_1", toolName: "read",
		content: [{ type: "text" as const, text: "ok" }], isError: false, timestamp: 3,
	};
	const messages = [system, user, assistant, toolResult];
	const units = (part: string, text: string, name?: string) =>
		name === undefined ? { part, text } : { part, text, name };
	const expected = [
		units("system", "Base."),
		units("user", "question"),
		units("assistant", "answer"),
		units("tool-call", "{\"path\":\"a.txt\"}", "read"),
		units("tool-result", "ok"),
	];
	const grammar = new Map<string, string>();
	assert.deepEqual(completionsUnits(messages, TEXT, grammar), expected);
	assert.deepEqual(responsesUnits(messages, TEXT, grammar), expected);
	assert.deepEqual(anthropicUnits(messages, TEXT), expected);
});

test("split: the completions bridge stays inside the completions serializer", () => {
	const bridge = { ...TEXT, api: "openai-completions" as const, compat: { requiresAssistantAfterToolResult: true } };
	const toolResult = {
		role: "toolResult" as const, toolCallId: "call_1", toolName: "read",
		content: [{ type: "text" as const, text: "ok" }], isError: false, timestamp: 1,
	};
	const messages = [{ role: "user" as const, content: "next", timestamp: 2 }, toolResult];
	assert.deepEqual(
		completionsUnits(messages, bridge, new Map<string, string>()).slice(0, 2),
		[{ part: "user", text: "next" }, { part: "tool-result", text: "ok" }],
	);
	assert.deepEqual(
		renderExpectedUnits(
			{ messages: [toolResult, messages[0]], grammarInputs: { declared: new Map(), current: new Map() } },
			bridge,
		).slice(0, 2),
		[{ part: "tool-result", text: "ok" }, { part: "assistant", text: "I have processed the tool results." }],
	);
});

test("split: a grammar call renders its raw input in every serializer", () => {
	const user = { role: "user" as const, content: "question", timestamp: 1 };
	const assistant = {
		role: "assistant" as const, provider: "mock", api: "openai-completions", model: "model",
		stopReason: "stop" as const, timestamp: 2,
		content: [{ type: "toolCall" as const, id: "call_1", name: "script", arguments: { code: "return 1;" } }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	const grammar = new Map([["script", "code"]]);
	const messages = [user, assistant];
	// Completions emits an empty assistant text unit before a call-only message
	assert.deepEqual(completionsUnits(messages, TEXT, grammar), [
		{ part: "user", text: "question" },
		{ part: "assistant", text: "" },
		{ part: "tool-call", text: "return 1;", name: "script" },
	]);
	// Responses emits only the tool call
	assert.deepEqual(responsesUnits(messages, TEXT, grammar), [
		{ part: "user", text: "question" },
		{ part: "tool-call", text: "return 1;", name: "script" },
	]);
	// Anthropic emits only the tool call with canonical JSON arguments
	assert.deepEqual(anthropicUnits(messages, TEXT), [
		{ part: "user", text: "question" },
		{ part: "tool-call", text: "{\"code\":\"return 1;\"}", name: "script" },
	]);
});
