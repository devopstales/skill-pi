import { describe, it, expect } from "vitest";
import { isSettled, type SwarmStatus } from "./domain.ts";

describe("isSettled", () => {
  it("matches exactly the settled members of the SwarmStatus union", () => {
    const all: SwarmStatus[] = ["queued", "running", "done", "error", "interrupted"];
    for (const status of all) {
      expect(isSettled(status), `isSettled(${status})`).toBe(status === "done" || status === "error" || status === "interrupted");
    }
  });
});
