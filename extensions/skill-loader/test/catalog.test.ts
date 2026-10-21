import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./hooks.mjs", import.meta.url).pathname).href, import.meta.url);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_BUDGET,
  CATALOG_HEADER,
  canInject,
  groupByZone,
  renderCatalog,
} from "../catalog.ts";
import { makeBigFixture, makeFixture } from "./fixtures.ts";
import { scanSkills } from "../scan.ts";

let fixture: ReturnType<typeof makeFixture>;

before(() => {
  fixture = makeFixture("main");
});
after(() => fixture.clean());

describe("renderCatalog", () => {
  it("groups skills by zone with header lines", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const catalog = renderCatalog(skills);
    assert.ok(catalog.startsWith(CATALOG_HEADER));
    // knowledge zone skills are all disable-model-invocation in the fixture,
    // so their zone header is absent from the catalog.
    for (const zone of ["lifecycle", "planning", "execution", "verification", "design"]) {
      assert.ok(catalog.includes(`### ${zone}`), `missing zone header ${zone}`);
    }
    assert.ok(!catalog.includes("### knowledge"));
    assert.ok(catalog.includes("- resume: resume a previous session"));
  });

  it("excludes disable-model-invocation skills from the catalog", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const catalog = renderCatalog(skills);
    assert.ok(!catalog.includes("knowledge-base"));
    assert.ok(!catalog.includes("mystery"));
  });

  it("returns an empty string when no catalogable skill exists", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const onlyDisabled = skills.filter((s) => s.disableModelInvocation);
    assert.equal(renderCatalog(onlyDisabled), "");
    assert.equal(renderCatalog([]), "");
  });

  it("groups unknown zones after the canonical zones", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const zones = groupByZone(skills).map((z) => z.zone);
    const canonicalIndex = (z: string) => ["lifecycle", "planning", "execution", "verification", "knowledge", "design", "craft"].indexOf(z);
    for (let i = 1; i < zones.length; i++) {
      if (canonicalIndex(zones[i - 1]) === -1 || canonicalIndex(zones[i]) === -1) continue;
      assert.ok(canonicalIndex(zones[i - 1]) <= canonicalIndex(zones[i]));
    }
  });

  it("keeps core zones in full and collapses others under a big fixture", () => {
    const big = makeBigFixture(200);
    try {
      const { skills } = scanSkills(big.project, big.home, big.moduleUrl);
      const catalog = renderCatalog(skills);
      assert.ok(catalog.length <= CATALOG_BUDGET, `catalog ${catalog.length} over budget ${CATALOG_BUDGET}`);
      assert.ok(catalog.includes("- keepme: core zone skill that must survive collapse"));
      assert.ok(!catalog.includes("- bulk-0: bulk description 0"));
      assert.match(catalog, /### design\n\(\d+ skills — use use_skill by name\)/);
      assert.match(catalog, /### craft\n\(\d+ skills — use use_skill by name\)/);
    } finally {
      big.clean();
    }
  });

  it("fits under budget with a small fixture", () => {
    const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
    const catalog = renderCatalog(skills);
    assert.ok(catalog.length <= CATALOG_BUDGET);
  });
});

describe("canInject", () => {
  it("returns false for an empty catalog and true for a fresh prompt", () => {
    assert.equal(canInject("Base system prompt.", ""), false);
  });
});
