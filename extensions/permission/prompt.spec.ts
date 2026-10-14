import { describe, it, expect } from "vitest";
import { resolvePermissionRejection, buildHardRejectedReason } from "./rejection.js";

describe("rejection", () => {
  it("reject -> hard with reason", async () => {
    const ctx = { ui: { input: async () => "" } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject", "bash", "git status");
    expect(r).toEqual({ kind: "hard", reason: buildHardRejectedReason("bash", "git status") });
  });

  it("reject-with-feedback -> feedback kind with trimmed text", async () => {
    const ctx = { ui: { input: async () => "  use rg  " } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject with feedback", "bash", "git status");
    expect(r).toEqual({ kind: "feedback", reason: "use rg" });
  });

  it("empty feedback -> back", async () => {
    const ctx = { ui: { input: async () => "" } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject with feedback", "bash", "git status");
    expect(r).toEqual({ kind: "back" });
  });
});
