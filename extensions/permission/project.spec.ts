import { describe, it, expect } from "vitest";
import { getExtensionSettingsPaths, resolveProjectConfDir } from "./project.js";

describe("conf.d path resolution (ADR 0008)", () => {
  it("derives user conf.d from dirname(getAgentDir())", () => {
    const p = getExtensionSettingsPaths("permission", process.cwd());
    expect(p.global).toMatch(/\/conf\.d\/permission\.conf$/);
  });

  it("resolves project conf.d under the git root", () => {
    expect(resolveProjectConfDir(process.cwd())).toMatch(/conf\.d$/);
  });
});
