import { describe, it, expect } from "bun:test";
import { normalizeRecallScope, parseRecallScope } from "../src/core/recall-scope";

describe("normalizeRecallScope", () => {
  it("defaults to active lineage", () => {
    expect(normalizeRecallScope()).toBe("lineage");
    expect(normalizeRecallScope("lineage")).toBe("lineage");
    expect(normalizeRecallScope("unknown")).toBe("lineage");
    expect(normalizeRecallScope(123)).toBe("lineage");
  });

  it("accepts all scope", () => {
    expect(normalizeRecallScope("all")).toBe("all");
    expect(normalizeRecallScope("ALL")).toBe("all");
  });
});

describe("parseRecallScope", () => {
  it("removes scope token from command text", () => {
    expect(parseRecallScope("license scope:all page:2")).toEqual({
      scope: "all",
      text: "license page:2",
      expandRefs: false,
    });
  });

  it("defaults to lineage when no scope token is present", () => {
    expect(parseRecallScope("license page:2")).toEqual({
      scope: "lineage",
      text: "license page:2",
      expandRefs: false,
    });
  });

  it("detects and strips the expandRefs token", () => {
    expect(parseRecallScope("foo expandRefs")).toEqual({
      scope: "lineage",
      text: "foo",
      expandRefs: true,
    });
  });

  it("defaults expandRefs to false", () => {
    expect(parseRecallScope("foo")).toEqual({
      scope: "lineage",
      text: "foo",
      expandRefs: false,
    });
  });
});
