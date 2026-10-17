/**
 * Expected serializer of the Anthropic Messages API: replays Pi's message
 * transform as the text units the API sends, as `renderExpectedUnits` does
 * for a supported payload.
 */
import {
	getSystemMessageText, renderSystemMessageUpdate, type AssistantMessage, type ImageContent, type Message,
	type TextContent,
} from "@earendil-works/pi-ai";
import { canonicalJson } from "../diff.ts";
import { type MessageUnit, UnitCollector } from "../messages.ts";
import type { GuardModel } from "../guard.ts";
import { compatFlag, hasImages, textOf } from "./helpers.ts";

/** Tool-result text the serializer sends for a result with only images. */
const IMAGE_ONLY_RESULT_TEXT = "(see attached image)";

/**
 * Anthropic sends the leading system prompt as the top-level `system`. Later
 * system messages are rendered as updates and wait for the next assistant
 * message. Unsigned thinking becomes text unless the model accepts empty
 * signatures; whitespace-only user and assistant text is dropped.
 */
export function anthropicUnits(messages: readonly Message[], model: GuardModel): MessageUnit[] {
	const allowEmptySignature = compatFlag(model, "allowEmptySignature");
	const units = new UnitCollector();
	const leading = messages[0]?.role === "system" ? messages[0] : undefined;
	if (leading !== undefined) units.text("system", getSystemMessageText(leading));
	const held: string[] = [];
	const flushHeld = () => {
		for (const text of held.splice(0)) {
			units.boundary();
			units.text("system", text);
		}
	};
	for (let index = leading === undefined ? 0 : 1; index < messages.length; index++) {
		const message = messages[index];
		units.boundary();
		switch (message.role) {
			case "system": {
				const text = renderSystemMessageUpdate(message);
				if (text.length > 0) held.push(text);
				break;
			}
			case "user":
				units.text("user", typeof message.content === "string" ? message.content : textOf(message.content));
				break;
			case "assistant":
				flushHeld();
				units.boundary();
				for (const block of message.content) addAnthropicAssistantBlock(units, block, allowEmptySignature);
				break;
			case "toolResult":
				units.toolResult(anthropicResultText(message.content));
				break;
		}
	}
	flushHeld();
	return units.result();
}

/** One assistant block as Anthropic sends it; signed and redacted thinking is opaque. */
export function addAnthropicAssistantBlock(
	units: UnitCollector,
	block: AssistantMessage["content"][number],
	allowEmptySignature: boolean,
): void {
	switch (block.type) {
		case "text":
			units.text("assistant", block.text);
			return;
		case "thinking": {
			const signed = block.thinkingSignature !== undefined && block.thinkingSignature.trim().length > 0;
			if (block.redacted || signed || allowEmptySignature || block.thinking.trim().length === 0) return;
			units.text("assistant", block.thinking);
			return;
		}
		case "toolCall":
			units.toolCall(block.name, canonicalJson(block.arguments ?? {}));
	}
}

/** Anthropic tool-result text: the text blocks, or a filler when only images remain. */
export function anthropicResultText(content: ReadonlyArray<TextContent | ImageContent>): string {
	const text = textOf(content);
	return hasImages(content) && !content.some((block) => block.type === "text") ? IMAGE_ONLY_RESULT_TEXT : text;
}
