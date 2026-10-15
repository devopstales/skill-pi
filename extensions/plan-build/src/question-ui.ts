import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { formatInstruction } from "./utils.ts";
import { pendingOrError, statusCall, noticeTracker, TRANSCRIPT_PADDING } from "./tool-presentation.ts";

const QUESTION_NOTICE_ENTRY_TYPE = "skill-pi-plan-question-notice";
const QUESTION_CANCELLED_MESSAGE = "You chose not to answer the question(s). Awaiting your instructions.";

/** Cancelled-question notices stay renderable for restored history. */
export function registerQuestionNotice(pi: ExtensionAPI) {
	const notices = noticeTracker(pi, QUESTION_NOTICE_ENTRY_TYPE);
	pi.registerEntryRenderer<{ message: string }>(QUESTION_NOTICE_ENTRY_TYPE, (entry, _options, theme) => {
		const message = typeof entry.data?.message === "string" ? entry.data.message : QUESTION_CANCELLED_MESSAGE;
		return new Text(formatInstruction(theme, message), TRANSCRIPT_PADDING, 0);
	});
	return notices;
}

export { pendingOrError, statusCall, noticeTracker, Container };
