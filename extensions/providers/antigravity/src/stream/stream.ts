import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { endpointCandidates } from "../client/client.js";
import {
	getCurrentEndpoint,
	runWithDiagnostics,
	setLastEndpoint,
	setLastError,
	setLastLatencyMs,
} from "../diagnostics/diagnostics.js";
import { StopReason } from "../types/enums.js";
import {
	ANTIGRAVITY_API,
	PROVIDER_ID,
	type ActiveBlock,
	type AntigravityStreamOptions,
	type StreamChunk,
} from "../types/types.js";
import { safeError } from "../utils/security.js";
import { AntigravityAccountPool } from "../accounts/pool.js";
import { sanitizeToolCallId } from "./convert.js";
import { mapStopReason } from "./error.js";
import { requestFailure, requestWithAccount, resetOutput, writeDebugFailure } from "./retry.js";

export { ANTIGRAVITY_API };
export { convertMessages, convertTools } from "./convert.js";
export { buildRequest } from "./request.js";
export { friendlyAntigravityError, mapStopReason } from "./error.js";
export { requestFailure, requestWithAccount, resetOutput } from "./retry.js";

function createOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: ANTIGRAVITY_API,
		provider: PROVIDER_ID,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			// Antigravity is subscription-billed; keep reported $ costs at zero.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function asToolCallArguments(args: Record<string, unknown> | undefined): ToolCall["arguments"] {
	return (args ?? {}) as ToolCall["arguments"];
}

/** Exported for unit tests. */
export async function streamResponse(
	response: Response,
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
): Promise<boolean> {
	if (!response.body) throw new Error("No response body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	// Consumed-prefix offset: the buffer is compacted once per network chunk instead of
	// re-copying the whole remainder for every SSE line.
	let scanStart = 0;
	let started = false;
	let currentBlock: ActiveBlock | null = null;
	let hasContent = false;
	const blocks = output.content;
	const blockIndex = () => blocks.length - 1;

	const ensureStarted = () => {
		if (!started) {
			stream.push({ type: "start", partial: output });
			started = true;
		}
	};

	const finishCurrent = () => {
		if (!currentBlock) return;
		if (currentBlock.type === "text") {
			stream.push({
				type: "text_end",
				contentIndex: blockIndex(),
				content: currentBlock.text,
				partial: output,
			});
		} else {
			stream.push({
				type: "thinking_end",
				contentIndex: blockIndex(),
				content: currentBlock.thinking,
				partial: output,
			});
		}
		currentBlock = null;
	};

	while (true) {
		const result = await reader.read();
		if (result.done) break;
		if (!(result.value instanceof Uint8Array)) continue;
		buffer += decoder.decode(result.value, { stream: true });

		let newlineIdx: number;
		while ((newlineIdx = buffer.indexOf("\n", scanStart)) !== -1) {
			const line = buffer.slice(scanStart, newlineIdx);
			scanStart = newlineIdx + 1;
			if (!line.startsWith("data:")) continue;
			const json = line.slice(5).trim();
			if (!json || json === "[DONE]") continue;

			let chunk: StreamChunk;
			try {
				chunk = JSON.parse(json) as StreamChunk;
			} catch {
				continue;
			}

			if (chunk.error) {
				throw new Error(chunk.error.message || JSON.stringify(chunk.error));
			}

			const responseData = chunk.response || chunk;
			const candidate = responseData.candidates?.[0];

			for (const part of candidate?.content?.parts || []) {
				if (part.text !== undefined) {
					hasContent = true;
					const isThinking = part.thought === true;
					const type = isThinking ? "thinking" : "text";
					if (!currentBlock || currentBlock.type !== type) {
						finishCurrent();
						currentBlock = isThinking
							? { type: "thinking", thinking: "", thinkingSignature: undefined }
							: { type: "text", text: "" };
						blocks.push(currentBlock);
						ensureStarted();
						stream.push({
							type: isThinking ? "thinking_start" : "text_start",
							contentIndex: blockIndex(),
							partial: output,
						});
					}
					if (isThinking && currentBlock.type === "thinking") {
						currentBlock.thinking += part.text;
						if (part.thoughtSignature) currentBlock.thinkingSignature = part.thoughtSignature;
						stream.push({
							type: "thinking_delta",
							contentIndex: blockIndex(),
							delta: part.text,
							partial: output,
						});
					} else if (!isThinking && currentBlock.type === "text") {
						currentBlock.text += part.text;
						if (part.thoughtSignature) currentBlock.textSignature = part.thoughtSignature;
						stream.push({
							type: "text_delta",
							contentIndex: blockIndex(),
							delta: part.text,
							partial: output,
						});
					}
				}

				if (part.functionCall) {
					hasContent = true;
					finishCurrent();
					const rawId = part.functionCall.id || "";
					const toolCall: ToolCall = {
						type: "toolCall",
						id: sanitizeToolCallId(rawId, part.functionCall.name),
						name: part.functionCall.name || "",
						arguments: asToolCallArguments(part.functionCall.args),
						...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
					};
					blocks.push(toolCall);
					ensureStarted();
					stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
					stream.push({
						type: "toolcall_delta",
						contentIndex: blockIndex(),
						delta: JSON.stringify(toolCall.arguments),
						partial: output,
					});
					stream.push({
						type: "toolcall_end",
						contentIndex: blockIndex(),
						toolCall,
						partial: output,
					});
				}
			}

			if (candidate?.finishReason) {
				output.stopReason = blocks.some((b) => b.type === "toolCall")
					? StopReason.ToolUse
					: mapStopReason(candidate.finishReason);
			}

			if (responseData.usageMetadata) {
				const prompt = responseData.usageMetadata.promptTokenCount || 0;
				const cacheRead = responseData.usageMetadata.cachedContentTokenCount || 0;
				output.usage.input = prompt - cacheRead;
				output.usage.output =
					(responseData.usageMetadata.candidatesTokenCount || 0) +
					(responseData.usageMetadata.thoughtsTokenCount || 0);
				output.usage.cacheRead = cacheRead;
				output.usage.totalTokens = responseData.usageMetadata.totalTokenCount || 0;
				// Keep subscription costs at zero (matches model catalog freeCost).
				output.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
			}
		}

		if (scanStart > 0) {
			buffer = buffer.slice(scanStart);
			scanStart = 0;
		}
	}

	finishCurrent();
	return hasContent;
}

export function createAntigravityStream(
	accountPool = new AntigravityAccountPool(),
): (
	model: Model<Api>,
	context: Context,
	options?: AntigravityStreamOptions,
) => AssistantMessageEventStream {
	return function pooledAntigravityStream(
		model: Model<Api>,
		context: Context,
		options?: AntigravityStreamOptions,
	): AssistantMessageEventStream {
		const stream = createAssistantMessageEventStream();
		const opts = options ?? {};

		void runWithDiagnostics(async () => {
			const startTime = Date.now();
			const output = createOutput(model);
			try {
				let received = false;

				for (let emptyAttempt = 0; emptyAttempt <= 2; emptyAttempt++) {
					if (opts.signal?.aborted) throw new Error("Request was aborted");
					if (emptyAttempt > 0) {
						const delay = 500 * 2 ** (emptyAttempt - 1);
						await new Promise((resolve) => setTimeout(resolve, delay));
					}

					const accounts = await accountPool.resolve(opts.apiKey);
					if (accounts.length === 0) {
						throw new Error("No Antigravity credentials. Run /login antigravity first.");
					}

					let successfulResponse = false;
					for (const [accountIndex, account] of accounts.entries()) {
						const result = await requestWithAccount(account, model, context, opts);
						if (!result.response?.ok) {
							await writeDebugFailure(model, context, opts, result);
							if (result.response?.status === 429) {
								accountPool.markRateLimited(account, accounts);
								if (accountIndex + 1 < accounts.length) continue;
							}
							throw requestFailure(result);
						}

						accountPool.markSuccessful(account);
						resetOutput(output);
						received = await streamResponse(result.response, stream, output);
						successfulResponse = true;
						break;
					}

					if (received) break;
					if (!successfulResponse) break;
				}

				if (!received) throw new Error("Antigravity API returned an empty response");
				setLastLatencyMs(Date.now() - startTime);
				if (output.stopReason === "error" || output.stopReason === "aborted") {
					stream.push({ type: "error", reason: output.stopReason, error: output });
				} else if (output.stopReason === "pending") {
					throw new Error("Antigravity API returned no stop reason");
				} else {
					stream.push({ type: "done", reason: output.stopReason, message: output });
				}
				stream.end();
			} catch (error) {
				setLastLatencyMs(Date.now() - startTime);
				output.stopReason = opts.signal?.aborted ? "aborted" : "error";
				output.errorMessage = safeError(error);
				setLastError(output.errorMessage);
				if (!getCurrentEndpoint() && endpointCandidates()[0]) {
					setLastEndpoint(endpointCandidates()[0]);
				}
				stream.push({ type: "error", reason: output.stopReason, error: output });
				stream.end();
			}
		});

		return stream;
	};
}

export const streamAntigravity = createAntigravityStream();
