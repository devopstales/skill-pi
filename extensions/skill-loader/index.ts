/**
 * skill-loader (skill-pi) — progressive-disclosure skills for pi.
 *
 * At session start (startup or new) it scans the skill sources once, builds
 * a compact catalog (name + description, grouped by zone) and injects it
 * into the session context once. The `use_skill` tool loads a skill's full
 * SKILL.md body on demand — it keeps working when the catalog is disabled
 * (SKILL_PI_SKILLS=0 or conf.d {"enabled": false}) or empty.
 *
 * Sources (first match per skill name wins): <project>/.agents/skills,
 * ~/.skillgrid/.agents/skills, ~/.agents/skills, <pkgRoot>/skills.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canInject, renderCatalog } from "./catalog.ts";
import type { SkillEntry } from "./scan.ts";
import { scanSkills } from "./scan.ts";
import { createUseSkillTool } from "./tool.ts";

const CONFIG_FILE = "skill-loader.conf";

/** Hidden custom-message type carrying the catalog into session context. */
export const CATALOG_MESSAGE_TYPE = "skill-loader-catalog";

export function catalogEnabled(agentDir = getAgentDir()): boolean {
  if (process.env.SKILL_PI_SKILLS === "0") return false;
  const path = join(dirname(agentDir), "conf.d", CONFIG_FILE);
  if (!existsSync(path)) return true;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return !(
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).enabled === false
    );
  } catch {
    return true;
  }
}

/**
 * Re-attach the catalog when the transcript loses it (compaction, branch
 * navigation) — the same re-injection pattern the todo extension uses for
 * its state snapshot. The exact-content guard keeps the injection
 * idempotent: an unchanged catalog is never appended twice.
 */
function trackCatalog(pi: ExtensionAPI, catalogFor: () => string): void {
  const send = (catalog: string) =>
    pi.sendMessage(
      { customType: CATALOG_MESSAGE_TYPE, content: catalog, display: false },
      { triggerTurn: false },
    );
  pi.on("context", (event, _ctx) => {
    const catalog = catalogFor();
    if (catalog === "") return undefined;
    const last = [...event.messages].reverse().find(
      (message) => (message as { customType?: string }).customType === CATALOG_MESSAGE_TYPE,
    ) as { content?: unknown } | undefined;
    const seen = typeof last?.content === "string" ? last.content : undefined;
    if (seen !== undefined && seen.endsWith(catalog)) return undefined;
    send(catalog);
    return {
      messages: [
        ...event.messages,
        { role: "custom", customType: CATALOG_MESSAGE_TYPE, content: catalog, display: false, timestamp: Date.now() },
      ],
    };
  });
}

export default function (pi: ExtensionAPI): void {
  const holder: { skills: readonly SkillEntry[] } = { skills: [] };
  const getSkills = (): readonly SkillEntry[] => holder.skills;

  pi.registerTool(createUseSkillTool(getSkills));
  trackCatalog(pi, () => renderCatalog(getSkills()));

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup" && event.reason !== "new") return;
    const { skills, notes } = scanSkills(ctx.cwd);
    for (const note of notes) process.stderr.write(`${note}\n`);
    holder.skills = skills;
    if (!catalogEnabled()) return;
    const catalog = renderCatalog(skills);
    if (catalog === "") return;
    if (!canInject(ctx.getSystemPrompt(), catalog)) return;
    pi.sendMessage(
      { customType: CATALOG_MESSAGE_TYPE, content: catalog, display: false },
      { triggerTurn: false },
    );
  });
}
