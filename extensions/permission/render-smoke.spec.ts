import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

import { buildEditPermissionPreview } from "./review-preview.js";
import { renderSplitDiffLines, renderUnifiedDiffLines } from "./pierre-rows.js";
import { getPierrePalette } from "./pierre-theme.js";

describe("render smoke on a fixed diff preview", () => {
  const width = 100;
  const palette = getPierrePalette({ name: "dark" } as any);

  it("renderUnifiedDiffLines returns a non-empty, width-bounded string[]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "smoke.txt");
    writeFileSync(f, "line1\nline2\nline3\n");
    const preview = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "line2", newText: "line2-changed" }] }, dir);
    expect(preview.kind).toBe("diff");
    if (preview.kind !== "diff") return;

    const lines = renderUnifiedDiffLines({
      metadata: preview.metadata,
      highlighted: preview.highlighted[palette.appearance],
      palette,
      width,
    });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line.text)).toBeLessThanOrEqual(width);
    }
  });

  it("renderSplitDiffLines returns a non-empty, width-bounded string[]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "smoke2.txt");
    writeFileSync(f, "a\nb\nc\n");
    const preview = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "b", newText: "B" }] }, dir);
    expect(preview.kind).toBe("diff");
    if (preview.kind !== "diff") return;

    const lines = renderSplitDiffLines({
      metadata: preview.metadata,
      highlighted: preview.highlighted[palette.appearance],
      palette,
      width,
    });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line.text)).toBeLessThanOrEqual(width);
    }
  });
});
