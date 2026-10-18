/**
 * Expected serializer of the OpenAI Completions API: replays the converted
 * message channel as the text units the API sends.
 */
import {
	getCurrentSystemMessage, getSystemMessageText, renderSystemMessageUpdate,
	type AssistantMessage, type ImageContent, type Message, type TextContent, type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { type MessageUnit, UnitCollector } from "../messages.ts";
import type { GuardModel } from "../guard.ts";
import { compatFlag, hasImages, openAiResultText, textOf, toolCallText } from "./helpers.ts";

/** Text that replaces each run of images while `images.blockImages` is on. */
const BLOCKED_IMAGE_TEXT = "Image reading is disabled.";
/** Texts that replace each run of images for a model without image input. */
const USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
/** Result Pi adds for a tool call that has none. */
const MISSING_RESULT_TEXT = "No result provided";
/** OpenAI Completions' assistant message after tool results, for providers that require one. */
const TOOL_RESULT_BRIDGE_TEXT = "I have processed the tool results.";
/** OpenAI Completions' user message that carries tool-result images. */
const TOOL_IMAGES_TEXT = "Attached image(s) from tool result:";

/** Whether a block is the blocked-image text. */
function isBlockedImageText(block: TextContent | ImageContent): boolean {
	return block.type === "text" && block.text === BLOCKED_IMAGE_TEXT;
}

/**
 * Replace each run of images with Pi's blocked-image text, as its
 * `convertToLlm` wrapper does; a run after the same text adds none.
 */
export function blockImages(message: Message): Message {
	if ((message.role !== "user" && message.role !== "toolResult") || !Array.isArray(message.content)) return message;
	const content: ReadonlyArray<TextContent | ImageContent> = message.content;
	if (!content.some((block) => block.type === "image")) return message;
	const replaced = content.map((block): TextContent | ImageContent =>
		block.type === "image" ? { type: "text", text: BLOCKED_IMAGE_TEXT } : block);
	const deduplicated = replaced.filter((block, index) => !(index > 0 && isBlockedImageText(block)
		&& isBlockedImageText(replaced[index - 1])));
	return { ...message, content: deduplicated } as Message;
}

/**
 * Without mid-conversation system messages, Pi replays them into one
 * leading message.
 */
export function resolveSystemMessages(messages: readonly Message[], keepsSystem: boolean): readonly Message[] {
	if (keepsSystem) return messages;
	const head = getCurrentSystemMessage(messages);
	const conversation = messages.filter((message) => message.role !== "system");
	return head === undefined ? conversation : [head, ...conversation];
}

/** Without image input, each run of user or tool-result images becomes one placeholder text. */
export function downgradeImages(messages: readonly Message[], model: GuardModel): readonly Message[] {
	if (model.input.includes("image")) return messages;
	return messages.map((message) => {
		if (message.role === "user" && Array.isArray(message.content)) {
			return { ...message, content: replaceImages(message.content, USER_IMAGE_PLACEHOLDER) };
		}
		if (message.role === "toolResult") {
			return { ...message, content: replaceImages(message.content, TOOL_IMAGE_PLACEHOLDER) };
		}
		return message;
	});
}

/** Replace images with one placeholder per run; a run after the placeholder text adds none. */
function replaceImages(
	content: ReadonlyArray<TextContent | ImageContent>,
	placeholder: string,
): Array<TextContent | ImageContent> {
	const result: Array<TextContent | ImageContent> = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({ type: "text", text: placeholder });
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}

/**
 * Replay an assistant message for the dispatched model. Another model's
 * thinking becomes text when it has any, and its redacted thinking is
 * dropped; the same model keeps signed and non-empty thinking.
 */
export function replayAssistant(message: AssistantMessage, model: GuardModel): AssistantMessage {
	const sameModel = message.provider === model.provider && message.api === model.api && message.model === model.id;
	const content = message.content.flatMap((block): AssistantMessage["content"] => {
		if (block.type !== "thinking") return [block];
		if (block.redacted) return sameModel ? [block] : [];
		if (sameModel && block.thinkingSignature) return [block];
		if (!block.thinking || block.thinking.trim() === "") return [];
		return sameModel ? [block] : [{ type: "text", text: block.thinking }];
	});
	return { ...message, content };
}

/**
 * Pi's tool-call accounting: error and aborted assistant messages are
 * dropped, a tool call without a result gets a `No result provided` error
 * result, and a system message between a tool call and its results moves
 * after them.
 */
export function closeToolCalls(messages: readonly Message[]): Message[] {
	const result: Message[] = [];
	let pending: Array<{ readonly id: string; readonly name: string }> = [];
	let answered = new Set<string>();
	const held: Message[] = [];
	const close = () => {
		for (const call of pending) {
			if (!answered.has(call.id)) result.push(missingResult(call.id, call.name));
		}
		pending = [];
		answered = new Set();
		result.push(...held.splice(0));
	};
	for (const message of messages) {
		switch (message.role) {
			case "assistant": {
				close();
				if (message.stopReason === "error" || message.stopReason === "aborted") break;
				const calls = message.content.filter((block) => block.type === "toolCall");
				if (calls.length > 0) {
					pending = calls;
					answered = new Set();
				}
				result.push(message);
				break;
			}
			case "toolResult":
				answered.add(message.toolCallId);
				result.push(message);
				break;
			case "system":
				if (pending.length > 0) held.push(message);
				else result.push(message);
				break;
			case "user":
				close();
				result.push(message);
				break;
			default:
				result.push(message);
		}
	}
	close();
	return result;
}

/** The synthetic error result of an unanswered tool call. */
function missingResult(toolCallId: string, toolName: string): ToolResultMessage {
	return {
		role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: MISSING_RESULT_TEXT }],
		isError: true, timestamp: 0,
	};
}

/**
 * Completions sends one message per transcript message: the leading system
 * prompt in full and later ones as updates, assistant text joined before its
 * tool calls, and tool results with fillers. Thinking stays out of `content`
 * unless the provider requires it as text.
 */
export function completionsUnits(
	messages: readonly Message[],
	model: GuardModel,
	grammar: ReadonlyMap<string, string>,
): MessageUnit[] {
	const bridge = compatFlag(model, "requiresAssistantAfterToolResult");
	const thinkingAsText = compatFlag(model, "requiresThinkingAsText");
	const units = new UnitCollector();
	let lastRole: string | undefined;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		units.boundary();
		if (bridge && lastRole === "toolResult" && message.role === "user") {
			units.text("assistant", TOOL_RESULT_BRIDGE_TEXT);
			units.boundary();
		}
		switch (message.role) {
			case "system":
				units.text("system", index === 0 ? getSystemMessageText(message) : renderSystemMessageUpdate(message));
				break;
			case "user": {
				if (typeof message.content === "string") {
					units.text("user", message.content);
					break;
				}
				const parts = message.content.filter((block) => block.type !== "text" || block.text.length > 0);
				if (parts.length === 0) continue;
				units.text("user", textOf(parts));
				break;
			}
			case "assistant": {
				const texts = message.content.filter((block) => block.type === "text")
					.map((block) => block.text).filter((text) => text.trim().length > 0);
				const thinking = message.content.filter((block) => block.type === "thinking")
					.map((block) => block.thinking).filter((text) => text.trim().length > 0);
				const calls = message.content.filter((block) => block.type === "toolCall");
				const text = thinkingAsText && thinking.length > 0
					? [thinking.join("\n\n"), ...texts].join("\n") : texts.join("");
				if (text.length === 0 && calls.length === 0) continue;
				units.text("assistant", text);
				for (const call of calls) units.toolCall(call.name, toolCallText(call, grammar));
				break;
			}
			case "toolResult": {
				let images = false;
				for (; index < messages.length && messages[index].role === "toolResult"; index++) {
					const result = messages[index] as ToolResultMessage;
					units.toolResult(openAiResultText(result.content, false));
					if (model.input.includes("image") && hasImages(result.content)) images = true;
				}
				index--;
				if (images) {
					if (bridge) units.text("assistant", TOOL_RESULT_BRIDGE_TEXT);
					units.boundary();
					units.text("user", TOOL_IMAGES_TEXT);
				}
				lastRole = images ? "user" : "toolResult";
				continue;
			}
		}
		lastRole = message.role;
	}
	return units.result();
}
