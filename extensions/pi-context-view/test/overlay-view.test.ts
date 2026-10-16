import { test } from "node:test";
import assert from "node:assert/strict";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { ListNavigator, PreviewScroller } from "../src/ui/injections-model.ts";
import { OverlayView } from "../src/ui/overlay-view.ts";

class TestOverlay extends OverlayView {
	public closeCalls = 0;
	public readonly listNavigator = new ListNavigator(5, 3);

	public constructor(theme: Theme, getTerminalRows?: () => number) {
		super(
			theme,
			() => {
				this.closeCalls += 1;
			},
			getTerminalRows,
		);
	}

	protected moveBy(delta: number): boolean {
		return this.listNavigator.moveBy(delta);
	}

	protected moveTo(index: number): boolean {
		return this.listNavigator.moveTo(index);
	}

	protected pageStep(): number {
		return Math.max(1, this.listNavigator.windowSize - 1);
	}

	public runSetOffset(offset: number): void {
		this.previewScroller.setExtent(100, 10);
		this.previewScroller.scrollTo(offset);
	}

	public get scroller(): PreviewScroller {
		return this.previewScroller;
	}

	protected clearPreviewContent(): void {}

	public runListNavigation(data: string, onOpen: () => void, selectableEnd: number): void {
		this.handleListNavigation(data, onOpen, selectableEnd);
	}

	public runPreviewScroll(data: string, onClose: () => void): void {
		this.handlePreviewScroll(data, onClose);
	}
}

/** Remove SGR sequences so plain-text assertions hold. */
function stripSgr(text: string): string {
	return text.replace(/\u001b\[[\d;]*m/g, "");
}

/** A frame that reports a distinct marker so cache hits are observable. */
function freshFrame(): string[] {
	return [`frame-${Math.random()}`];
}

/** One theme with no ANSI styling, so rendered output is plain text. */
const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
	muted: (text: string) => text,
} as unknown as Theme;

test("OverlayView fitLine truncates to the supplied width", () => {
	const view = new TestOverlay(plainTheme);
	assert.equal(stripSgr(view.fitLine("hello world", 5)), "hell…");
	assert.equal(view.fitLine("ok", 5), "ok");
});

test("OverlayView spreadLine joins left and right across the width", () => {
	const view = new TestOverlay(plainTheme);
	assert.equal(view.spreadLine("left", "right", 14), "left     right");
	assert.equal(stripSgr(view.spreadLine("left", "right", 9)), "l… right");
});

test("OverlayView renderCached stores and reuses a frame at matching width and rows", () => {
	const view = new TestOverlay(plainTheme, () => 30);
	const first = view.renderCached(80, freshFrame);
	const again = view.renderCached(80, freshFrame);
	assert.equal(again, first, "an identical render reuses the stored frame");
	assert.notEqual(view.renderCached(81, freshFrame), first, "a width change re-renders");
	const otherRows = new TestOverlay(plainTheme, () => 20);
	assert.notEqual(otherRows.renderCached(80, freshFrame), first, "a rows change re-renders");
});

test("OverlayView clearCache drops a same-width cached frame", () => {
	const view = new TestOverlay(plainTheme, () => 30);
	const first = view.renderCached(80, freshFrame);
	view.invalidate();
	assert.notEqual(view.renderCached(80, freshFrame), first);
});

test("OverlayView handleListNavigation closes on escape and q", () => {
	const view = new TestOverlay(plainTheme);
	view.runListNavigation("\u001b", () => {}, 3);
	assert.equal(view.closeCalls, 1);
	view.runListNavigation("q", () => {}, 3);
	assert.equal(view.closeCalls, 2);
});

test("OverlayView handleListNavigation opens the preview on enter", () => {
	const view = new TestOverlay(plainTheme);
	let opened = false;
	view.runListNavigation("\r", () => {
		opened = true;
	}, 3);
	assert.equal(opened, true, "the enter key drives the open callback");
	assert.equal(view.closeCalls, 0);
});

test("OverlayView handleListNavigation moves the navigator with step, page, home, and end", () => {
	const view = new TestOverlay(plainTheme);
	view.runListNavigation("j", () => {}, 3);
	assert.equal(view.listNavigator.selected, 1);
	view.runListNavigation("k", () => {}, 3);
	assert.equal(view.listNavigator.selected, 0);
	view.runListNavigation("\u001b[5~", () => {}, 3);
	assert.equal(view.listNavigator.selected, 0, "page back is clamped at the top");
	view.runListNavigation("j", () => {}, 3);
	view.runListNavigation("j", () => {}, 3);
	view.runListNavigation("\u001b[6~", () => {}, 3);
	assert.equal(view.listNavigator.selected, 4, "page forward moves a full page");
	view.runListNavigation("\u001b[H", () => {}, 4);
	assert.equal(view.listNavigator.selected, 0, "home returns to the first row");
	view.runListNavigation("\u001b[F", () => {}, 4);
	assert.equal(view.listNavigator.selected, 4, "end targets the selectable end");
});

test("OverlayView handleListNavigation moves the wheel one row per notch", () => {
	const view = new TestOverlay(plainTheme);
	view.runListNavigation("\u001b[<64;1;1M", () => {}, 3);
	assert.equal(view.listNavigator.selected, 0, "up notch at the top stays put");
	view.runListNavigation("\u001b[<65;1;1M", () => {}, 3);
	assert.equal(view.listNavigator.selected, 1, "a down notch moves one row");
});

test("OverlayView handleListNavigation falls back to subclass keys when the ladder matches none", () => {
	class Sub extends TestOverlay {
		public zCalls = 0;
		protected onListKey(data: string): boolean {
			if (data === "z") {
				this.zCalls += 1;
				return true;
			}
			return false;
		}
	}
	const view = new Sub(plainTheme);
	view.runListNavigation("z", () => {}, 3);
	assert.equal(view.zCalls, 1);
	view.runListNavigation("\u001b", () => {}, 3);
	assert.equal(view.closeCalls, 1, "close is decided by the base before subclass keys");
	view.runListNavigation("q", () => {}, 3);
	assert.equal(view.closeCalls, 2);
});

test("OverlayView handlePreviewScroll scrolls the scroller with wheel, step, page, home, and end", () => {
	const view = new TestOverlay(plainTheme);
	view.runSetOffset(0);
	view.runPreviewScroll("\u001b[<65;1;1M", () => {});
	assert.equal(view.scroller.offset, 3, "one down notch scrolls the wheel step");
	view.runPreviewScroll("j", () => {});
	assert.equal(view.scroller.offset, 4);
	view.runPreviewScroll("k", () => {});
	assert.equal(view.scroller.offset, 3);
	view.runPreviewScroll("\u001b[<64;1;1M", () => {});
	assert.equal(view.scroller.offset, 0, "up notch scrolls back three lines");
	view.runPreviewScroll("j", () => {});
	view.runPreviewScroll("j", () => {});
	view.runPreviewScroll("j", () => {});
	view.runPreviewScroll("j", () => {});
	view.runPreviewScroll("j", () => {});
	view.runPreviewScroll("\u001b[5~", () => {});
	assert.equal(view.scroller.offset, 0, "page back lands on the previous page");
	view.runSetOffset(50);
	view.runPreviewScroll("\u001b[6~", () => {});
	assert.equal(view.scroller.offset, 59, "page forward moves a full page");
	view.runPreviewScroll("\u001b[H", () => {});
	assert.equal(view.scroller.offset, 0, "home scrolls to the top");
	view.runPreviewScroll("\u001b[F", () => {});
	assert.equal(view.scroller.offset, view.scroller.maxOffset, "end scrolls to the bottom");
});

test("OverlayView handlePreviewScroll closes on escape and q", () => {
	const view = new TestOverlay(plainTheme);
	let closed = 0;
	view.runPreviewScroll("\u001b", () => {
		closed += 1;
	});
	assert.equal(closed, 1);
	view.runPreviewScroll("q", () => {
		closed += 1;
	});
	assert.equal(closed, 2);
});

test("OverlayView invalidate clears preview content and the render cache", () => {
	class CountingSub extends TestOverlay {
		public clearPreviewCalls = 0;
		protected clearPreviewContent(): void {
			this.clearPreviewCalls += 1;
		}
	}
	const view = new CountingSub(plainTheme, () => 30);
	const first = view.renderCached(80, freshFrame);
	view.invalidate();
	assert.equal(view.clearPreviewCalls, 1);
	assert.notEqual(view.renderCached(80, freshFrame), first);
});

test("OverlayView invalidates the cache when list movement succeeds", () => {
	class TrackedSub extends TestOverlay {
		public render(): string[] {
			return freshFrame();
		}
	}
	const view = new TrackedSub(plainTheme, () => 30);
	const first = view.render();
	view.runListNavigation("j", () => {}, 3);
	const moved = view.render();
	assert.notEqual(moved, first, "a successful move re-renders at the same width and rows");
	view.runListNavigation("j", () => {}, 3);
	assert.notEqual(view.render(), moved, "each move invalidates the stored frame");
});

test("OverlayView invalidates the cache when preview scrolling succeeds", () => {
	class TrackedSub extends TestOverlay {
		public render(): string[] {
			return freshFrame();
		}
	}
	const view = new TrackedSub(plainTheme, () => 30);
	view.runSetOffset(0);
	const first = view.render();
	view.runPreviewScroll("j", () => {});
	assert.notEqual(view.render(), first, "a successful scroll re-renders at the same width and rows");
});
