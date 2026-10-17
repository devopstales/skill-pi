import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
	AntigravityRequestType,
	AntigravityUserAgent,
	GeminiRole,
	GeminiToolCallingMode,
} from "../types/enums.js";
import type {
	AntigravityGenerateRequest,
	AntigravityStreamOptions,
	GeminiGenerationConfig,
	GeminiRequestBody,
} from "../types/types.js";
import { getMaxOutputTokens } from "../models/models.js";
import { nowRequestId, sanitizeText } from "../utils/util.js";
import { convertMessages, convertTools } from "./convert.js";

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
	"You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. " +
	"You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";

const ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION =
	'CRITICAL: NEVER output rule checks, formatting guidelines, constraint checklists (e.g. "No emdashes"), or your thinking/personality preambles in the final response. Output only the final response.';

function mapToolChoiceMode(
	toolChoice: AntigravityStreamOptions["toolChoice"],
): GeminiToolCallingMode {
	if (toolChoice === "none") return GeminiToolCallingMode.None;
	return GeminiToolCallingMode.Auto;
}

/** Exported for unit tests. */
export function buildRequest(
	model: Model<Api>,
	context: Context,
	projectId: string,
	options: AntigravityStreamOptions,
	runtimeModel: string,
): AntigravityGenerateRequest {
	const request: GeminiRequestBody = {
		contents: convertMessages(model, context, runtimeModel),
		systemInstruction: {
			role: GeminiRole.User,
			parts: [
				{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
				{ text: ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION },
				...(context.systemPrompt ? [{ text: sanitizeText(context.systemPrompt) }] : []),
			],
		},
	};

	const generationConfig: GeminiGenerationConfig = {};
	if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
	if (runtimeModel === "gemini-3.7-flash-tiered") {
		const effort = options.reasoning ?? "off";
		generationConfig.thinkingConfig = {
			thinkingLevel:
				effort === "high" || effort === "xhigh" ? "HIGH" : effort === "medium" ? "MEDIUM" : "LOW",
		};
	}
	const maxAllowed = getMaxOutputTokens(model.id, runtimeModel);
	if (options.maxTokens !== undefined) {
		generationConfig.maxOutputTokens = Math.min(options.maxTokens, maxAllowed);
	} else {
		generationConfig.maxOutputTokens = Math.min(maxAllowed, model.maxTokens || maxAllowed);
	}
	if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;

	const tools = convertTools(
		context.tools,
		model.id.startsWith("claude-") || model.id.startsWith("gpt-oss-"),
	);
	if (tools) {
		request.tools = tools;
		if (model.id.startsWith("claude-")) {
			request.toolConfig = options.toolChoice
				? {
						functionCallingConfig: {
							mode: mapToolChoiceMode(options.toolChoice),
						},
					}
				: {
						functionCallingConfig: {
							mode: GeminiToolCallingMode.Validated,
						},
					};
		} else if (options.toolChoice) {
			request.toolConfig = {
				functionCallingConfig: {
					mode: mapToolChoiceMode(options.toolChoice),
				},
			};
		}
	}

	if (options.sessionId) request.sessionId = options.sessionId;

	return {
		project: projectId,
		model: runtimeModel,
		request,
		requestType: AntigravityRequestType.Agent,
		userAgent: AntigravityUserAgent.Antigravity,
		requestId: nowRequestId(),
	};
}
