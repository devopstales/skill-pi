import { StopReason } from "../types/enums.js";
import { jsonOrTextError } from "../client/client.js";
import { redactSecrets } from "../utils/security.js";

/** Exported for unit tests. */
export function mapStopReason(reason: string | undefined): StopReason {
	switch (reason) {
		case "STOP":
			return StopReason.Stop;
		case "MAX_TOKENS":
			return StopReason.Length;
		case undefined:
			return StopReason.Stop;
		default:
			return StopReason.Error;
	}
}

type StatusPattern = { test: RegExp; message: (msg: string, wait?: string) => string };
type StatusRule = { message: (msg: string, wait?: string) => string; patterns?: StatusPattern[] };

// status → message rules for the backend's HTTP responses. First matching
// pattern wins per status; the rule's message is the fallback.
const STATUS_RULES: Record<number, StatusRule> = {
	400: {
		message: (msg) =>
			`Bad request from Antigravity. Next: retry once, then run /login antigravity if it keeps failing. Backend said: ${msg}`,
		patterns: [
			{
				test: /API key not valid|API_KEY_INVALID/i,
				message: () =>
					"Antigravity login expired or credentials are invalid. Next: run /login antigravity, then retry.",
			},
			{
				test: /Invalid JSON payload|Unknown name/i,
				message: (msg) =>
					`Antigravity request format was rejected by the backend (${msg}). Next: switch to a simpler model or retry after updating the extension.`,
			},
			{
				test: /Request contains an invalid argument/i,
				message: (msg) =>
					`Antigravity rejected this request (${msg}). Next: retry once; if it keeps failing, switch models or re-login.`,
			},
		],
	},
	401: {
		message: () => "Antigravity authentication failed. Next: run /login antigravity, then retry.",
	},
	403: {
		message: (msg) =>
			`Antigravity denied this request. Next: re-login or try another model. Backend said: ${msg}`,
		patterns: [
			{
				test: /permission|forbidden|access/i,
				message: () =>
					"Antigravity access was denied for this account or project. Next: try another model, re-login, or use an account with access.",
			},
		],
	},
	404: {
		message: (msg) =>
			`Antigravity could not find the requested resource. Next: retry or switch models. Backend said: ${msg}`,
		patterns: [
			{
				test: /Requested entity was not found/i,
				message: () =>
					"This model is not available right now. Next: switch to gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-3.1-pro, or another working model.",
			},
		],
	},
	408: {
		message: () => "Antigravity timed out. Next: retry the same request.",
	},
	409: {
		message: () =>
			"Antigravity reported a conflict for this request. Next: retry once or start a new chat session.",
	},
	429: {
		message: (msg, wait) =>
			`Rate limited by Antigravity. Next: wait a bit and retry.${wait ? ` Reset: ${wait}.` : ""}`,
		patterns: [
			{
				test: /Individual quota reached/i,
				message: (_msg, wait) =>
					`Quota reached. Please wait ${wait || "for reset"}. Next: switch models or try again after reset.`,
			},
			{
				test: /quota/i,
				message: (_msg, wait) =>
					`Quota reached.${wait ? ` Please wait ${wait}.` : ""} Next: switch models or retry later.`,
			},
		],
	},
	500: {
		message: () => "Antigravity had an internal server error. Next: retry in a moment or switch models.",
	},
	502: {
		message: () => "Antigravity returned a bad gateway error. Next: retry in a moment.",
	},
	503: {
		message: () => "Antigravity is temporarily unavailable. Next: retry in a moment or switch models.",
		patterns: [
			{
				test: /No capacity available/i,
				message: () => "This model has no capacity right now. Next: retry later or switch to another model.",
			},
		],
	},
	504: {
		message: () => "Antigravity timed out upstream. Next: retry in a moment.",
	},
};

/** Exported for unit tests. */
export function friendlyAntigravityError(status: number | undefined, text: string): string {
	const msg = redactSecrets(jsonOrTextError(text)).slice(0, 500);
	const wait = msg.match(/Resets? in ([^.\n]+)/i)?.[1]?.trim();
	const rule = status === undefined ? undefined : STATUS_RULES[status];
	if (!rule) return msg;
	const pattern = rule.patterns?.find((entry) => entry.test.test(msg));
	return (pattern ? pattern.message : rule.message)(msg, wait);
}
