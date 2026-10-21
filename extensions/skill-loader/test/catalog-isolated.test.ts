import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./hooks.mjs", import.meta.url).pathname).href, import.meta.url);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canInject, renderCatalog } from "../catalog.ts";
import { scanSkills } from "../scan.ts";
import { makeFixture } from "./fixtures.ts";

describe("canInject (idempotency, isolated)", () => {
  it("injects at most once: a second call sees the header and fits nothing new", () => {
    const fixture = makeFixture("isolated");
    try {
      const { skills } = scanSkills(fixture.project, fixture.home, fixture.moduleUrl);
      const catalog = renderCatalog(skills);
      assert.ok(catalog);
      const prompt = "Base system prompt.";
      assert.equal(canInject(prompt, catalog), true);
      const once = prompt + "\n\n" + catalog;
      assert.equal(canInject(once, catalog), false);
    } finally {
      fixture.clean();
    }
  });
});

let confDir: string;
const oldEnv = process.env.SKILL_PI_SKILLS;
before(() => {
  confDir = mkdtempSync(join(tmpdir(), "skill-loader-conf-iso-"));
});
after(() => {
  rmSync(confDir, { recursive: true, force: true });
  if (oldEnv === undefined) delete process.env.SKILL_PI_SKILLS;
  else process.env.SKILL_PI_SKILLS = oldEnv;
});

describe("catalogEnabled (isolated)", () => {
  it("honors SKILL_PI_SKILLS=0 and conf.d enabled:false", async () => {
    const { catalogEnabled } = await import("../index.ts");
    assert.equal(catalogEnabled(join(confDir, "agent")), true);
    mkdirSync(join(confDir, "conf.d"), { recursive: true });
    writeFileSync(join(confDir, "conf.d", "skill-loader.conf"), '{"enabled": false}');
    assert.equal(catalogEnabled(join(confDir, "agent")), false);
    process.env.SKILL_PI_SKILLS = "0";
    assert.equal(catalogEnabled(join(confDir, "agent")), false);
  });
});
