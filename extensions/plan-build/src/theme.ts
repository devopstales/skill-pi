import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export type PlanTheme = {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
};

/**
 * pi's Theme fg falls back to the default fg for unknown tokens (e.g. "warning"
 * in themes without it), matching the skill-pi-tui card theme behavior.
 */
export function buildTheme(theme: Theme): PlanTheme {
	return {
		fg: (color, text) => theme.fg(color, text),
		bold: (text) => theme.bold(text),
	};
}
