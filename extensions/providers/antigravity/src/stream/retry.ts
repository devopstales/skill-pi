import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import {
	antigravityHeaders,
	endpointCandidates,
	fetchAvailableRuntimeModel,
	formatRequestDiagnostics,
	loadCodeAssist,
	parseApiKey,
	resolveProjectId,
} from "../client/client.js";
import {
	setLastEndpoint,
	setLastProjectId,
	setLastResolvedRuntimeModel,
	setLastStatus,
} from "../diagnostics/diagnostics.js";
import {
	ANTIGRAVITY_ROUTING,
	getAntigravityRequestModelId,
	getFallbackRuntimeModel,
} from "../models/models.js";
import { antigravityEnv } from "../utils/util.js";
import { antigravityFetch } from "../utils/http.js";
import type { AntigravityStreamOptions } from "../types/types.js";
import type { AntigravityAccount } from "../accounts/pool.js";
import { buildRequest } from "./request.js";
import { friendlyAntigravityError } from "./error.js";

type AccountRequestResult = {
	response: Response | undefined;
	lastText: string;
	projectId: string;
	runtimeModel: string;
};

export async function requestWithAccount(
	account: AntigravityAccount,
	model: Model<Api>,
	context: Context,
	opts: AntigravityStreamOptions,
): Promise<AccountRequestResult> {
	const creds = parseApiKey(account.apiKey);
	const warmedProject = creds.projectId ? null : await loadCodeAssist(creds.token);
	const projectId = resolveProjectId({
		token: creds.token,
		warmedProject,
		credentialProjectId: creds.projectId,
	});
	setLastProjectId(projectId);

	const effort = opts.reasoning ?? "off";
	const isKnownModel = model.id in ANTIGRAVITY_ROUTING;
	const pinnedRuntimeModel = antigravityEnv("RUNTIME_MODEL")?.trim();
	const baseRuntimeModel = pinnedRuntimeModel || getAntigravityRequestModelId(model.id, effort);

	let initialRuntimeModel = baseRuntimeModel;
	if (!isKnownModel && !pinnedRuntimeModel) {
		const dynamic = await fetchAvailableRuntimeModel(creds.token, projectId, baseRuntimeModel);
		if (dynamic?.id && /^(gemini-|claude-|gpt-oss-)/i.test(dynamic.id)) {
			initialRuntimeModel = dynamic.id;
		}
	}

	const runtimeCandidates = [initialRuntimeModel];
	const fallback = getFallbackRuntimeModel(initialRuntimeModel, effort);
	if (fallback && fallback !== initialRuntimeModel) runtimeCandidates.push(fallback);

	const isClaudeReasoning = model.id.startsWith("claude-") && model.reasoning;
	const requestHeaders: Record<string, string> = {
		...antigravityHeaders(creds.token),
		...(isClaudeReasoning ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
	};

	let response: Response | undefined;
	let lastText = "";
	let runtimeModel = initialRuntimeModel;

	for (let candIdx = 0; candIdx < runtimeCandidates.length; candIdx++) {
		runtimeModel = runtimeCandidates[candIdx]!;
		setLastResolvedRuntimeModel(runtimeModel);
		const body = JSON.stringify(buildRequest(model, context, projectId, opts, runtimeModel));

		for (const endpoint of endpointCandidates()) {
			setLastEndpoint(endpoint);
			response = await antigravityFetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
				method: "POST",
				headers: requestHeaders,
				body,
				signal: opts.signal,
			});
			setLastStatus(response.status);
			if (response.ok) break;
			lastText = await response.text();
			if (response.status === 429 && /Individual quota reached/i.test(lastText)) break;
			if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
		}

		if (response?.ok) break;
		if (response?.status === 404) {
			if (candIdx + 1 < runtimeCandidates.length) continue;
			if (isKnownModel && candIdx === runtimeCandidates.length - 1) {
				const dynamic = await fetchAvailableRuntimeModel(creds.token, projectId, baseRuntimeModel);
				if (
					dynamic?.id &&
					!runtimeCandidates.includes(dynamic.id) &&
					/^(gemini-|claude-|gpt-oss-)/i.test(dynamic.id)
				) {
					runtimeCandidates.push(dynamic.id);
					continue;
				}
			}
		}
		break;
	}

	return { response, lastText, projectId, runtimeModel };
}

export function resetOutput(output: AssistantMessage): void {
	output.content = [];
	output.usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	output.stopReason = "stop";
}

export async function writeDebugFailure(
	model: Model<Api>,
	context: Context,
	opts: AntigravityStreamOptions,
	result: AccountRequestResult,
): Promise<void> {
	if (antigravityEnv("DEBUG_DUMP") !== "1") return;
	try {
		const { writeFileSync } = await import("node:fs");
		const body = JSON.stringify(
			buildRequest(model, context, result.projectId, opts, result.runtimeModel),
		);
		let parsedBody: unknown = body;
		try {
			parsedBody = JSON.parse(body) as unknown;
		} catch {
			parsedBody = body;
		}
		writeFileSync(
			"/tmp/antigravity-last-request.json",
			JSON.stringify(
				{
					status: result.response?.status,
					runtimeModel: result.runtimeModel,
					lastText: result.lastText.slice(0, 4000),
					body: parsedBody,
				},
				null,
				2,
			),
		);
	} catch {
		// Ignore diagnostic dump failures.
	}
}

export function requestFailure(result: AccountRequestResult): Error {
	const status = result.response?.status;
	const friendly = friendlyAntigravityError(status, result.lastText);
	if (status === 429 && /(?:Quota reached|Rate limited)/i.test(friendly)) {
		return new Error(friendly);
	}
	return new Error(
		`Antigravity API error (${status ?? "no response"}, ${formatRequestDiagnostics({ projectId: result.projectId, runtimeModel: result.runtimeModel })}): ${friendly}`,
	);
}
