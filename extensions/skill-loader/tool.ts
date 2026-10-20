/**
 * skill-loader — the use_skill tool.
 *
 * Loads the full SKILL.md body (frontmatter stripped) for a skill id. Works
 * with an empty or disabled catalog: it always resolves against the same
 * sources the catalog is built from. Bodies over the hard cap are truncated
 * and flagged; unknown ids answer with up to 10 closest matches.
 */

import { readFileSync } from "node:fs";
import { Type, type TSchema } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./scan.ts";
import type { SkillEntry } from "./scan.ts";

/** Hard cap on returned body size in characters. */
export const BODY_CAP = 40000;

export const useSkillParameters: TSchema = Type.Object({
  id: Type.String({ description: "Skill name from the available-skills catalog" }),
});

export interface UseSkillDetails {
  id: string;
  path: string;
  size: number;
  truncated: boolean;
}

export function createUseSkillTool(
  getSkills: () => readonly SkillEntry[],
): ToolDefinition<typeof useSkillParameters, UseSkillDetails> {
  return {
    name: "use_skill",
    label: "Use Skill",
    description:
      "Load the full instructions of a skill by name (from the available-skills catalog). Returns the complete SKILL.md body.",
    promptSnippet:
      "Load a skill's full instructions by name (id) — use when a task matches a cataloged skill.",
    promptGuidelines: [
      "Call use_skill with the skill name exactly as listed in the available-skills catalog before following that skill's instructions.",
      "Skills not listed in the catalog (e.g. disable-model-invocation) can still be loaded by name.",
    ],
    parameters: useSkillParameters,
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      const skills = getSkills();
      const entry = skills.find((s) => s.id === params.id);
      if (!entry) {
        const suggestions = closestIds(skills, params.id).join(", ");
        const text = suggestions
          ? `Unknown skill "${params.id}". Closest matches: ${suggestions}`
          : `Unknown skill "${params.id}".`;
        return {
          content: [{ type: "text", text }],
          details: { id: params.id, path: "", size: 0, truncated: false },
          isError: true,
        };
      }
      let raw: string;
      try {
        raw = readFileSync(entry.path, "utf8");
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read skill "${entry.id}" at ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { id: entry.id, path: entry.path, size: 0, truncated: false },
          isError: true,
        };
      }
      const full = parseFrontmatter(raw).body;
      const truncated = full.length > BODY_CAP;
      const text = truncated ? full.slice(0, BODY_CAP) : full;
      return {
        content: [{ type: "text", text }],
        details: {
          id: entry.id,
          path: entry.path,
          size: full.length,
          truncated,
        },
      };
    },
  };
}

/** Up to 10 closest matches: exact prefix first, then substring, case-insensitive. */
export function closestIds(skills: readonly { id: string }[], id: string, max = 10): string[] {
  const needle = id.toLowerCase();
  const prefix = skills
    .map((s) => s.id)
    .filter((s) => s.toLowerCase().startsWith(needle));
  const partial = skills
    .map((s) => s.id)
    .filter((s) => !s.toLowerCase().startsWith(needle) && s.toLowerCase().includes(needle));
  return [...prefix, ...partial].slice(0, max);
}
