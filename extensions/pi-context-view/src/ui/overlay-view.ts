/**
 * Shared plumbing of the pi-context-view fullscreen overlays: theme, close
 * callback, terminal-row and wheel-step configuration, the width-and-rows
 * render cache, and the close/wheel/step/page/home/end input ladders the
 * Usage and Injections views both run. Subclasses keep their own rows,
 * navigators, and preview content.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

import { PreviewScroller } from "./injections-model.ts";
import {
	DEFAULT_TERMINAL_ROWS,
	fitLine,
	isPageBackKey,
	isPageForwardKey,
	isStepBackKey,
	isStepForwardKey,
	normalizeTerminalRows,
	spreadLine,
} from "./layout.ts";
import { DEFAULT_WHEEL_SCROLL_LINES, parseWheelDirection } from "./wheel.ts";

/**
 * Frame cache and input ladders shared by the fullscreen overlay views. A
 * subclass owns its own rows and list navigator, keeps its own preview
 * content, and declares the actions the ladders drive.
 */
export abstract class OverlayView {
	protected readonly theme: Theme;
	protected readonly done: (result: undefined) => void;
	protected readonly getTerminalRows: () => number;
	protected readonly wheelScrollLines: number;
	protected readonly previewScroller = new PreviewScroller();
	protected cachedWidth: number | undefined;
	protected cachedTerminalRows: number | undefined;
	protected cachedLines: string[] | undefined;

	/** Create a view over one precomputed snapshot. */
	public constructor(
		theme: Theme,
		done: (result: undefined) => void,
		getTerminalRows: () => number = () => process.stdout.rows ?? DEFAULT_TERMINAL_ROWS,
		wheelScrollLines: number = DEFAULT_WHEEL_SCROLL_LINES,
	) {
		this.theme = theme;
		this.done = done;
		this.getTerminalRows = getTerminalRows;
		this.wheelScrollLines = wheelScrollLines;
	}

	/** Truncate one rendered line to the supplied width. */
	public fitLine(line: string, width: number): string {
		return fitLine(line, width);
	}

	/** Spread left and right content across the width, truncating the left side on overlap. */
	public spreadLine(left: string, right: string, width: number): string {
		return spreadLine(left, right, width);
	}

	/** Render a cached fullscreen frame for the current width and terminal height. */
	public renderCached(width: number, renderFn: () => string[]): string[] {
		const terminalRows = normalizeTerminalRows(this.getTerminalRows());
		if (
			this.cachedLines !== undefined &&
			this.cachedWidth === width &&
			this.cachedTerminalRows === terminalRows
		) {
			return this.cachedLines;
		}
		const lines = renderFn();
		this.cachedWidth = width;
		this.cachedTerminalRows = terminalRows;
		this.cachedLines = lines;
		return lines;
	}

	/** Invalidate theme-dependent rendered output. */
	public invalidate(): void {
		this.clearPreviewContent();
		this.clearCache();
	}

	/** Close the view and finish the overlay. */
	protected closeView(): void {
		this.done(undefined);
	}

	/**
	 * Close, wheel, and step/page/home/end ladder over the subclass list
	 * navigator. `selectableEnd` is the last selectable row the `end` key
	 * targets: the whole row count minus the non-selectable trailing rows.
	 * Subclass-specific keys are offered to `onListKey` before the standard
	 * ladder.
	 */
	protected handleListNavigation(data: string, onOpen: () => void, selectableEnd: number): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			this.closeView();
			return;
		}
		// One notch moves the selection one row, like a single step key.
		const wheel = parseWheelDirection(data);
		if (wheel !== undefined) {
			if (this.moveBy(wheel)) this.clearCache();
			return;
		}
		if (this.onListKey(data)) return;
		if (matchesKey(data, Key.enter)) {
			onOpen();
		} else if (isStepBackKey(data)) {
			if (this.moveBy(-1)) this.clearCache();
		} else if (isStepForwardKey(data)) {
			if (this.moveBy(1)) this.clearCache();
		} else if (isPageBackKey(data)) {
			if (this.moveBy(-this.pageStep())) this.clearCache();
		} else if (isPageForwardKey(data)) {
			if (this.moveBy(this.pageStep())) this.clearCache();
		} else if (matchesKey(data, Key.home)) {
			if (this.moveTo(0)) this.clearCache();
		} else if (matchesKey(data, Key.end)) {
			if (this.moveTo(selectableEnd)) this.clearCache();
		}
	}

	/** Scroll ladder over the shared preview scroller: wheel, step, page, home, end. */
	protected handlePreviewScroll(data: string, onClose: () => void): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			onClose();
			return;
		}
		const wheel = parseWheelDirection(data);
		if (wheel !== undefined) {
			if (this.previewScroller.scrollBy(wheel * this.wheelScrollLines)) this.clearCache();
			return;
		}
		if (isStepBackKey(data)) {
			if (this.previewScroller.scrollBy(-1)) this.clearCache();
		} else if (isStepForwardKey(data)) {
			if (this.previewScroller.scrollBy(1)) this.clearCache();
		} else if (isPageBackKey(data)) {
			if (this.previewScroller.page(-1)) this.clearCache();
		} else if (isPageForwardKey(data)) {
			if (this.previewScroller.page(1)) this.clearCache();
		} else if (matchesKey(data, Key.home)) {
			if (this.previewScroller.scrollTo(0)) this.clearCache();
		} else if (matchesKey(data, Key.end)) {
			if (this.previewScroller.scrollTo(this.previewScroller.maxOffset)) this.clearCache();
		}
	}

	/** Subclass-specific list keys before the standard ladder; false when unhandled. */
	protected onListKey(_data: string): boolean {
		return false;
	}

	/** Move the list selection by a delta; false when it does not change. */
	protected abstract moveBy(delta: number): boolean;

	/** Move the list selection to a row; false when it does not change. */
	protected abstract moveTo(index: number): boolean;

	/** Rows one page move spans in the list navigator. */
	protected abstract pageStep(): number;

	/** Drop width- and theme-dependent preview rendering. */
	protected abstract clearPreviewContent(): void;

	/** Clear render-cache keys after data, theme, or input changes. */
	protected clearCache(): void {
		this.cachedWidth = undefined;
		this.cachedTerminalRows = undefined;
		this.cachedLines = undefined;
	}
}
