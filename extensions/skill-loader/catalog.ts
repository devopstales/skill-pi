/**
 * skill-loader — catalog rendering + size budget.
 *
 * The catalog is a compact skill index injected once into the system prompt:
 * one line per skill, grouped by zone. Skills flagged
 * disable-model-invocation are excluded here but stay loadable via
 * use_skill. Over the budget, the core zones (lifecycle, planning,
 * execution, verification) are kept in full and every other zone collapses
 * to its header plus a count.
 */

import type { SkillEntry } from "./scan.ts";
import { CORE_ZONES, ZONE_ORDER } from "./scan.ts";

/** Header line guarding idempotent injection into the system prompt. */
export const CATALOG_HEADER = "## Available skills";

export const CATALOG_FOOTER =
  "Load a skill's full instructions with the use_skill tool (pass the skill name as id). " +
  "Names not listed here (e.g. disable-model-invocation skills) are still loadable by name.";

/** Max total catalog size in characters. */
export const CATALOG_BUDGET = 32768;

export interface SkillZone {
  zone: string;
  skills: SkillEntry[];
}

/** Group skills by zone; ZONE_ORDER first, then any extra zone names. */
export function groupByZone(skills: SkillEntry[]): SkillZone[] {
  const byZone = new Map<string, SkillEntry[]>();
  for (const skill of skills) {
    const list = byZone.get(skill.zone);
    if (list) list.push(skill);
    else byZone.set(skill.zone, [skill]);
  }
  const ordered = [...ZONE_ORDER, ...[...byZone.keys()].filter((z) => !(ZONE_ORDER as readonly string[]).includes(z)).sort()];
  const zones: SkillZone[] = [];
  for (const zone of ordered) {
    const skills = byZone.get(zone);
    if (skills?.length) zones.push({ zone, skills });
  }
  return zones;
}

export interface RenderOptions {
  budget?: number;
  /** Skills included in the catalog; defaults to those without disable-model-invocation. */
  skills?: SkillEntry[];
}

/**
 * Render the catalog block. Skills with disable-model-invocation are
 * excluded unless passed explicitly via options.skills.
 */
export function renderCatalog(skills: SkillEntry[], options: RenderOptions = {}): string {
  const budget = options.budget ?? CATALOG_BUDGET;
  const visible =
    options.skills ?? skills.filter((s) => !s.disableModelInvocation);
  const zones = groupByZone(visible);
  if (zones.length === 0) return "";

  const zoneBlock = (zone: SkillZone, collapsed: boolean): string => {
    const header = `### ${zone.zone}`;
    if (collapsed) {
      return `${header}\n(${zone.skills.length} skills — use use_skill by name)`;
    }
    const lines = zone.skills.map((s) => `- ${s.id}: ${s.description}`);
    return [header, ...lines].join("\n");
  };

  const assemble = (collapsedZones: Set<string>): string => {
    const blocks = [CATALOG_HEADER, CATALOG_FOOTER];
    for (const zone of zones) {
      blocks.push(zoneBlock(zone, collapsedZones.has(zone.zone)));
    }
    return blocks.join("\n\n");
  };

  let catalog = assemble(new Set());
  if (catalog.length <= budget) return catalog;

  const collapsed = new Set<string>(
    zones.map((z) => z.zone).filter((z) => !CORE_ZONES.includes(z)),
  );
  catalog = assemble(collapsed);
  if (catalog.length <= budget) return catalog;

  const fullBlocks = zones
    .filter((z) => !collapsed.has(z.zone))
    .map((z) => zoneBlock(z, false).length + 2);
  let total = catalog.length - fullBlocks.reduce((a, b) => a + b, 0);
  let dropped = false;
  for (const zone of zones.filter((z) => !collapsed.has(z.zone))) {
    const cost = zoneBlock(zone, false).length + 2;
    const savings = cost - zoneBlock(zone, true).length - 2;
    if (total + savings > budget) {
      total += cost; // keep it in full
    } else {
      total += cost - savings;
      collapsed.add(zone.zone);
      dropped = true;
    }
  }
  return dropped ? assemble(collapsed) : catalog;
}

/**
 * Decide whether a catalog block can be appended to the current system
 * prompt: yes when the prompt carries no section header yet (first
 * injection); no once the catalog has been injected (idempotency — a
 * session carries the catalog at most once).
 */
export function canInject(currentPrompt: string, catalog: string, budget = CATALOG_BUDGET): boolean {
  if (catalog === "") return false;
  return !currentPrompt.includes(CATALOG_HEADER);
}
