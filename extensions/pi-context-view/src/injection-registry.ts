/**
 * Token-diff registry for the Injections tree: the session's prompt and tool
 * items that request items compare with, the per-item diff computation, and
 * the request-only/saved-change markers. Split from injections.ts, which keeps
 * the snapshot composition and calls `withPromptDiffs` on its measured items.
 */
import { isPiPromptPart, SYSTEM_PROMPT_ITEM_ID, textTokens } from "./measure.ts";
import {
	type InjectedReference,
	type InjectionItem,
	sumTokenDiffs,
	type TokenDiff,
} from "./model.ts";
import { buildSystemPromptRows, partEditors } from "./system-prompt-rows.ts";
import { type DiffSide, measureTokenDiff } from "./token-diff.ts";

/** Session aggregates backing prompt parts when a request replaces or deletes their generated sections. */
const GENERATED_RECORD_ITEMS: Readonly<Record<string, string>> = {
	"base-prompt:context-files": "context-files",
	"base-prompt:skills": "skills",
};

/**
 * Prompt and tool items with the tokens each gained and lost against its base.
 * Rows under pi compare with pi's default prompt: the session's version of a
 * pi part without the extension lines measured in it, so saved and
 * request-only extension text both count as added. A custom section and
 * Extension Additions are extension text with no default; a deleted custom
 * section compares with the session instead, so its deletion stays visible.
 * Tools, instruction files, and skills compare with the session. A parent sums
 * its children, plus the removal of children only the session has. Each leaf
 * also learns whether it is request-only, and each System Prompt part whether
 * the session saves part of its diff and who made it. The `system prompt` rows
 * that split these prompt changes by source follow the items.
 */
export function withPromptDiffs(items: readonly InjectionItem[], session: readonly InjectionItem[]): InjectionItem[] {
	const sessionById = new Map<string, InjectionItem>();
	for (const item of session) {
		sessionById.set(item.id, item);
		for (const child of item.children ?? []) sessionById.set(child.id, child);
	}
	const context: DiffContext = {
		sessionById,
		sessionItems: session,
		sentIds: new Set(items.map((item) => item.id)),
		forced: items.some((item) => item.id === SYSTEM_PROMPT_ITEM_ID && item.change === "forced"),
	};
	const diffed = items.map((item) => withItemDiff(item, context, false));
	return [...diffed, ...buildSystemPromptRows(diffed, session)];
}

/** The session's prompt and tool items that request items compare with. */
interface DiffContext {
	/** Session items and their children, by id. */
	readonly sessionById: ReadonlyMap<string, InjectionItem>;
	/** Top-level session items, which an undivided System Prompt compares with. */
	readonly sessionItems: readonly InjectionItem[];
	/** Ids of the request's top-level items. */
	readonly sentIds: ReadonlySet<string>;
	/** True when the request carried a forced prompt, whose text the session never keeps. */
	readonly forced: boolean;
}

/**
 * One item with its diff and, for a leaf, its request-only state; `promptPart`
 * marks a System Prompt part. Its sections mirror its children one to one, so
 * preview subheaders show the same diffs and markers as the rows.
 */
function withItemDiff(item: InjectionItem, context: DiffContext, promptPart: boolean): InjectionItem {
	if (item.dropped === true) return item;
	const children = item.children ?? [];
	if (children.length === 0) {
		const base = itemBase(item, context, promptPart);
		const request: DiffSide = item.change === "deleted" ? { text: "", tokens: 0 } : item;
		const requestOnly = isRequestOnly(item, context);
		const diffed: InjectionItem = {
			...item,
			...diffField(measureTokenDiff(base, request)),
			...(requestOnly ? {
				requestOnly: true,
				sessionOriginal: context.sessionById.has(item.id) || base !== undefined,
			} : {}),
		};
		if (!promptPart) return diffed;
		const editors = partEditors(diffed);
		return {
			...diffed,
			...(hasSavedChange(item, base, context) ? { savedChange: true } : {}),
			...(editors === undefined ? {} : { editors }),
		};
	}
	const parts = item.id === SYSTEM_PROMPT_ITEM_ID;
	const diffed = children.map((child) => withItemDiff(child, context, parts));
	const sent = new Set(children.map((child) => child.id));
	const sessionOnly = (context.sessionById.get(item.id)?.children ?? []).filter((child) => !sent.has(child.id));
	const diff = sumTokenDiffs([
		...diffed.map((child) => child.diff),
		...sessionOnly.map((child) => removedDiff(defaultSide(child, parts))),
	]);
	return {
		...item,
		...diffField(diff),
		children: diffed,
		sections: item.sections?.map((section, index) => ({
			...section,
			...diffField(diffed[index]?.diff),
			...(diffed[index]?.requestOnly === true ? { requestOnly: true } : {}),
		})),
	};
}

/**
 * Whether the request sent other content than the session keeps for one leaf:
 * a request-only addition, edit, or deletion, or forced prompt text that
 * differs from the session's version. Generated instruction files and skills
 * compare their child text with the session too: section changes mark the
 * aggregate, not its individual records. Tool changes reach a forced prompt
 * as usual, and the undivided System Prompt carries only its `forced` change.
 */
function isRequestOnly(item: InjectionItem, context: DiffContext): boolean {
	if (item.change !== undefined && item.change !== "forced") return true;
	if (item.kind === "tool" || item.id === SYSTEM_PROMPT_ITEM_ID) return false;
	if (!context.forced && item.kind !== "context-file" && item.kind !== "skills") return false;
	return context.sessionById.get(item.id)?.text !== item.text;
}

/**
 * Whether the session's own version of a System Prompt part already differs
 * from the part's base, so the session saves part of its diff: extension
 * lines in a pi part, or an extension's own part the session keeps. A
 * deletion compares with the session, so none of it is saved.
 */
function hasSavedChange(item: InjectionItem, base: DiffSide | undefined, context: DiffContext): boolean {
	if (item.change === "deleted") return false;
	const session = context.sessionById.get(item.id);
	if (session === undefined || session.dropped === true) return false;
	return base === undefined || base.text !== session.text;
}

/**
 * What one request item compares with: pi's default text of a pi part, no
 * base for an extension's own part unless the request deleted it, pi's whole
 * default prompt for an undivided System Prompt, or the session's version of
 * anything else. Undefined counts the whole item as added.
 */
function itemBase(item: InjectionItem, context: DiffContext, promptPart: boolean): DiffSide | undefined {
	if (item.id === SYSTEM_PROMPT_ITEM_ID) return defaultPromptSide(context);
	// A generated section changes into a prompt part when replaced or deleted
	const recordId = GENERATED_RECORD_ITEMS[item.id];
	const records = recordId === undefined ? undefined : context.sessionById.get(recordId);
	if (promptPart && records !== undefined) return records;
	const session = context.sessionById.get(item.id);
	if (promptPart && !isPiPromptPart(item.id)) {
		if (item.change !== "deleted") return undefined;
		return session ?? { text: item.text, tokens: textTokens(item.text) };
	}
	return session === undefined ? undefined : defaultSide(session, promptPart);
}

/**
 * What pi's default prompt holds of one session item: a pi part without the
 * extension lines in it, nothing of an extension's own part or of a part a
 * replacement dropped, and any other item whole.
 */
function defaultSide(item: InjectionItem, promptPart: boolean): DiffSide | undefined {
	if (item.dropped === true) return undefined;
	if (!promptPart) return item;
	if (!isPiPromptPart(item.id)) return undefined;
	const references = item.injectedReferences ?? [];
	if (references.length === 0) return item;
	const text = withoutReferences(item.text, references);
	return { text, tokens: textTokens(text) };
}

/**
 * Pi's whole default prompt, for a System Prompt without parts, such as a
 * forced prompt without sections: the default text of every session part, and
 * the instruction files and skills the request does not list separately.
 */
function defaultPromptSide(context: DiffContext): DiffSide | undefined {
	const prompt = context.sessionById.get(SYSTEM_PROMPT_ITEM_ID);
	if (prompt === undefined) return undefined;
	const parts = prompt.children?.map((part) => defaultSide(part, true)) ?? [prompt];
	const records = context.sessionItems.filter((item) =>
		(item.kind === "context-file" || item.kind === "skills") && !context.sentIds.has(item.id));
	const sides = [...parts, ...records].filter((side): side is DiffSide => side !== undefined && side.text.length > 0);
	return {
		text: sides.map((side) => side.text).join("\n"),
		tokens: sides.reduce((sum, side) => sum + side.tokens, 0),
	};
}

/** Text without the extension lines its references cover. */
function withoutReferences(text: string, references: readonly InjectedReference[]): string {
	let kept = "";
	let offset = 0;
	for (const reference of [...references].sort((a, b) => a.start - b.start)) {
		kept += text.slice(offset, reference.start);
		offset = Math.max(offset, reference.end);
	}
	return kept + text.slice(offset);
}

/** The removal of a whole base, or undefined when there is none. */
function removedDiff(base: DiffSide | undefined): TokenDiff | undefined {
	return base === undefined ? undefined : measureTokenDiff(base, { text: "", tokens: 0 });
}

/** `{ diff }` when there is one, so unchanged items carry no extra key. */
function diffField(diff: TokenDiff | undefined): { readonly diff?: TokenDiff } {
	return diff === undefined ? {} : { diff };
}
