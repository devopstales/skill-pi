/**
 * Expected serializer of the OpenAI Responses API: replays Pi's message
 * transform as the text units the API sends, as `renderExpectedUnits` does
 * for a supported payload.
 */
import { getSystemMessageText, renderSystemMessageUpdate, type Message } from "@earendil-works/pi-ai";
import { type MessageUnit, UnitCollector } from "../messages.ts";
import type { GuardModel } from "../guard.ts";
import { openAiResultText, textOf, toolCallText } from "./helpers.ts";

/**
 * Responses sends the leading system prompt in full and later ones as
 * updates, one item per assistant text block and tool call, and tool outputs
 * with fillers. Thinking travels as opaque reasoning items.
 */
export function responsesUnits(
	messages: readonly Message[],
	model: GuardModel,
	grammar: ReadonlyMap<string, string>,
): MessageUnit[] {
	const units = new UnitCollector();
	for (const [index, message] of messages.entries()) {
		units.boundary();
		switch (message.role) {
			case "system":
				units.text("system", index === 0 ? getSystemMessageText(message) : renderSystemMessageUpdate(message));
				break;
			case "user":
				units.text("user", typeof message.content === "string" ? message.content : textOf(message.content));
				break;
			case "assistant":
				for (const block of message.content) {
					units.boundary();
					if (block.type === "text") units.text("assistant", block.text);
					else if (block.type === "toolCall") units.toolCall(block.name, toolCallText(block, grammar));
				}
				break;
			case "toolResult":
				units.toolResult(openAiResultText(message.content, model.input.includes("image")));
				break;
		}
	}
	return units.result();
}
