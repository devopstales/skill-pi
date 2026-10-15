import { describe, expect, it } from "vitest";
import piPlanBuild from "./index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function mockPi(): ExtensionAPI {
  return {} as ExtensionAPI;
}

describe("piPlanBuild", () => {
  it("registers without side effects in the scaffold", () => {
    expect(() => piPlanBuild(mockPi())).not.toThrow();
  });
});
