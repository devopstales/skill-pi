import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditPermissionPreview, buildWritePermissionPreview } from "./review-preview.js";

describe("edit preview", () => {
  it("produces a diff preview for a valid edit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "a.txt");
    writeFileSync(f, "hello\nworld\n");
    const p = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "hello", newText: "hi" }] }, dir);
    expect(p.kind).toBe("diff");
    if (p.kind === "diff") {
      expect(p.addedLines).toBeGreaterThan(0);
    }
  });

  it("returns an error preview for a non-existent file", async () => {
    const p = await buildEditPermissionPreview({ path: "/no/such/file", edits: [{ oldText: "a", newText: "b" }] }, process.cwd());
    expect(p.kind).toBe("error");
  });

  it("returns an error preview for non-unique oldText", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "b.txt");
    writeFileSync(f, "dup\ndup\n");
    const p = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "dup", newText: "x" }] }, dir);
    expect(p.kind).toBe("error");
  });

  it("write to a new file produces a new-file preview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const p = await buildWritePermissionPreview({ path: join(dir, "new.txt"), content: "a\nb" }, dir);
    expect(p.kind).toBe("new-file");
  });
});
