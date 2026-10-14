import { describe, expect, it, vi } from "vitest";
import { toggleAutoAcceptEdits } from "./index.js";

let sessionId = 0;

function makeCtx() {
  sessionId += 1;
  const setStatus = vi.fn();
  const ctx = {
    sessionManager: { getSessionId: () => `autostatus-s${sessionId}` },
    ui: { setStatus },
  } as any;
  return { ctx, setStatus };
}

describe("auto-accept", () => {
  it("toggling sets edit+write overrides to allow", () => {
    const { ctx, setStatus } = makeCtx();
    toggleAutoAcceptEdits(ctx);
    expect(setStatus).toHaveBeenCalledWith("permission", "▶︎ Auto-accept edits");
  });

  it("toggling twice flips back off", () => {
    const { ctx, setStatus } = makeCtx();
    toggleAutoAcceptEdits(ctx);
    toggleAutoAcceptEdits(ctx);
    expect(setStatus).toHaveBeenLastCalledWith("permission", undefined);
  });
});
