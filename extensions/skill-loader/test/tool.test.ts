import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BODY_CAP, closestIds, createUseSkillTool } from "../tool.ts";
import { makeFixture } from "./fixtures.ts";
import { scanSkills } from "../scan.ts";

let fixture: ReturnType<typeof makeFixture>;

before(() => {
  fixture = makeFixture();
});
after(() => fixture.clean());

const ctx = {} as any;

function call(tool: any, id: string) {
  return tool.execute("call-1", { id }, undefined, undefined, ctx);
}

describe("use_skill tool", () => {
  it("returns the full SKILL.md body with the frontmatter stripped", async () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const tool = createUseSkillTool(() => skills);
    const result = await call(tool, "ship");
    assert.equal(result.isError, undefined);
    const text = (result.content[0] as { text: string }).text;
    assert.equal(text, "project ship body");
    assert.equal(result.details.truncated, false);
    assert.equal(result.details.size, "project ship body".length);
    assert.ok(result.details.path.endsWith("SKILL.md"));
  });

  it("truncates bodies over the hard cap and flags it", async () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const resume = skills.find((s) => s.id === "resume");
    assert.ok(resume);
    const body = "line\n".repeat(Math.ceil((BODY_CAP + 5000) / 5));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resume.path, `---\nname: resume\ndescription: "x"\n---\n${body}\n`);
    try {
      const tool = createUseSkillTool(() => skills);
      const result = await call(tool, "resume");
      const text = (result.content[0] as { text: string }).text;
      assert.equal(text.length, BODY_CAP);
      assert.equal(result.details.truncated, true);
      assert.ok(result.details.size > BODY_CAP);
    } finally {
      writeFileSync(resume.path, `---\nname: resume\ndescription: "resume a previous session"\n---\n# resume\n\nBody for resume.\n`);
    }
  });

  it("answers unknown ids with up to 10 closest matches", async () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const tool = createUseSkillTool(() => skills);
    const result = await call(tool, "resu");
    assert.equal(result.isError, true);
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /Unknown skill "resu"/);
    assert.match(text, /resume/);
  });

  it("answers unknown ids with no suggestion line when nothing matches", async () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const tool = createUseSkillTool(() => skills);
    const result = await call(tool, "zzzz-no-match");
    assert.equal(result.isError, true);
    const text = (result.content[0] as { text: string }).text;
    assert.equal(text, 'Unknown skill "zzzz-no-match".');
  });

  it("works with an empty skill list (disabled/empty catalog)", async () => {
    const tool = createUseSkillTool(() => []);
    const result = await call(tool, "anything");
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /Unknown skill "anything"\./);
  });

  it("loads disable-model-invocation skills by name", async () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const tool = createUseSkillTool(() => skills);
    const result = await call(tool, "mystery");
    assert.equal(result.isError, undefined);
    assert.match((result.content[0] as { text: string }).text, /Body for mystery/);
  });
});

describe("closestIds", () => {
  const ids = ["ship", "shipping", "qa", "subagent-execution", "resume"];
  it("prefix matches come first", () => {
    assert.deepEqual(closestIds(ids.map((id) => ({ id })), "ship"), ["ship", "shipping"]);
  });
  it("caps at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `prefix-${i}` }));
    assert.equal(closestIds(many, "prefix").length, 10);
  });
});
