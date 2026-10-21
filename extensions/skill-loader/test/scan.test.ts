import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./hooks.mjs", import.meta.url).pathname).href, import.meta.url);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, scanSkills, skillSources } from "../scan.ts";
import { makeFixture } from "./fixtures.ts";

let fixture: ReturnType<typeof makeFixture>;

before(() => {
  fixture = makeFixture();
});
after(() => fixture.clean());

describe("scanSkills", () => {
  it("scans the four sources in order (project, hub, user, bundled)", () => {
    const sources = skillSources(fixture.project, fixture.home, fixture.moduleUrl);
    assert.equal(sources.length, 4);
    assert.equal(sources[0].label, "project");
    assert.ok(sources[0].dir.startsWith(fixture.project));
    assert.ok(sources[1].dir.startsWith(join(fixture.home, ".skillgrid")));
    assert.ok(sources[2].dir.startsWith(join(fixture.home, ".agents")));
    assert.ok(sources[3].dir.endsWith(join("skills")));
  });

  it("project copy wins over the hub for the same skill name", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const ship = skills.find((s) => s.id === "ship");
    assert.ok(ship);
    assert.equal(ship.description, "project ship description");
    assert.ok(ship.path.startsWith(fixture.project));
    assert.equal(ship.body, "project ship body");
  });

  it("excludes SKILL.md without a description (and notes it)", () => {
    const { skills, notes } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    assert.ok(!skills.some((s) => s.id === "no-desc"));
    assert.ok(notes.some((n) => n.includes("no-desc") && n.includes("missing description")));
  });

  it("excludes SKILL.md without a name and unterminated frontmatter (and notes them)", () => {
    const { skills, notes } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    assert.ok(!skills.some((s) => s.id === "unterminated"));
    assert.ok(!skills.some((s) => s.description === "no name"));
    assert.ok(notes.some((n) => n.includes("no-name")));
    assert.ok(notes.some((n) => n.includes("unterminated") && n.includes("unterminated frontmatter")));
  });

  it("keeps disable-model-invocation skills in the scan result (catalog filters them later)", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const kb = skills.find((s) => s.id === "knowledge-base");
    assert.ok(kb);
    assert.equal(kb.disableModelInvocation, true);
    const resume = skills.find((s) => s.id === "resume");
    assert.equal(resume.disableModelInvocation, false);
  });

  it("returns an empty result when no source dirs exist", () => {
    const { skills, notes } = scanSkills(join(fixture.project, "nowhere-empty"), "/no-such-home", fixture.moduleUrl);
    assert.deepEqual(skills, []);
    assert.deepEqual(notes, []);
  });

  it("orders results by zone order then id", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const zones = skills.map((s) => s.zone);
    const order = ["lifecycle", "planning", "execution", "verification", "knowledge", "design", "craft"];
    let last = -1;
    for (const zone of zones) {
      const rank = order.indexOf(zone);
      assert.ok(rank >= last, `zone order violated: ${zone} after rank ${last}`);
      last = rank;
    }
  });
});

describe("parseFrontmatter", () => {
  it("parses key: value lines and strips quotes", () => {
    const { fields, body, complete } = parseFrontmatter('---\nname: "x"\ndescription: \'y\'\n---\nbody\n');
    assert.equal(complete, true);
    assert.equal(fields.name, "x");
    assert.equal(fields.description, "y");
    assert.equal(body, "body");
  });

  it("skips nested metadata blocks", () => {
    const { fields } = parseFrontmatter("---\nname: x\nmetadata:\n  author: someone\n---\n");
    assert.equal(fields.name, "x");
    assert.ok(!("author" in fields));
  });

  it("treats a file without frontmatter as a full body", () => {
    const { fields, body, complete } = parseFrontmatter("plain text\nmore");
    assert.deepEqual(fields, {});
    assert.equal(body, "plain text\nmore");
    assert.equal(complete, true);
  });
});
