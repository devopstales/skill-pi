import assert from "node:assert/strict";
import { test } from "node:test";

import {
	CLAUDE_CODE_IDENTITY, copyPayload, DEFERRED_PLACEHOLDER_NAME, hasWarmOutputLimit, parsePayloadMessages,
	parsePayloadTools, PAYLOAD_SHAPE_CHECKS,
} from "../../src/capture/parsers.ts";
import type { ParsedMessages, ParsedTools } from "../../src/capture/parsers/types.ts";

test("split: parsers index keeps the payload.ts API surface", () => {
	assert.equal(typeof CLAUDE_CODE_IDENTITY, "string");
	assert.equal(typeof copyPayload, "function");
	assert.equal(typeof hasWarmOutputLimit, "function");
	assert.equal(typeof parsePayloadMessages, "function");
	assert.equal(typeof parsePayloadTools, "function");
	assert.equal(typeof PAYLOAD_SHAPE_CHECKS["openai-completions"], "function");
	assert.equal(typeof PAYLOAD_SHAPE_CHECKS["openai-responses"], "function");
	assert.equal(typeof PAYLOAD_SHAPE_CHECKS["anthropic-messages"], "function");
});

test("split: payload.ts stays a re-export shim of parsers", async () => {
	const shim = await import("../../src/capture/payload.ts");
	assert.equal(shim.CLAUDE_CODE_IDENTITY, CLAUDE_CODE_IDENTITY);
	assert.equal(shim.copyPayload, copyPayload);
	assert.equal(shim.hasWarmOutputLimit, hasWarmOutputLimit);
	assert.equal(shim.parsePayloadMessages, parsePayloadMessages);
	assert.equal(shim.parsePayloadTools, parsePayloadTools);
	assert.equal(shim.PAYLOAD_SHAPE_CHECKS, PAYLOAD_SHAPE_CHECKS);
	assert.equal(shim.DEFERRED_PLACEHOLDER_NAME, DEFERRED_PLACEHOLDER_NAME);
});

test("split: shared types resolve from parsers/types.ts", () => {
	const tools: ParsedTools = { status: "unsupported", reason: "x" };
	const messages: ParsedMessages = { status: "unsupported", reason: "x" };
	assert.equal(tools.status, "unsupported");
	assert.equal(messages.status, "unsupported");
});
