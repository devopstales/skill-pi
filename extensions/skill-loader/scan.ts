/**
 * skill-loader — skill discovery + frontmatter parsing.
 *
 * Sources are scanned in first-match order per skill name (project wins):
 *   1. <project>/.agents/skills        project-local override
 *   2. ~/.skillgrid/.agents/skills     skillgrid hub mirror (primary)
 *   3. ~/.agents/skills                fallback
 *   4. <pkgRoot>/skills                skill-pi's own bundled skills
 *
 * A skill is a directory carrying a file named exactly SKILL.md. The
 * frontmatter is simple `key: value` YAML; only name, description, and
 * disable-model-invocation are read (metadata blocks are skipped).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Zone directories are enumerated in this order in the catalog. */
export const ZONE_ORDER = [
  "lifecycle",
  "planning",
  "execution",
  "verification",
  "knowledge",
  "design",
  "craft",
] as const;

/** Zones rendered in full when the catalog hits the size budget. */
export const CORE_ZONES: readonly string[] = [
  "lifecycle",
  "planning",
  "execution",
  "verification",
];

export interface SkillEntry {
  /** Frontmatter name; the only key use_skill looks up by. */
  id: string;
  description: string;
  zone: string;
  /** Full path to the SKILL.md file. */
  path: string;
  disableModelInvocation: boolean;
  /** Body content after the frontmatter (frontmatter stripped). */
  body: string;
}

/**
 * Resolve the git root containing cwd, mirroring the lsp extension's
 * project-root resolution so `<project>/.agents/skills` means the project's
 * top level, not a subdirectory checkout.
 */
export function resolveProjectRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? resolve(out) : resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

/** pkgRoot is the skill-pi checkout that ships this extension. */
export function pkgRootOf(moduleUrl: string): string {
  const dir = moduleUrl.startsWith("file://")
    ? dirname(fileURLToPath(moduleUrl))
    : dirname(moduleUrl);
  return resolve(dir, "..", "..");
}

export interface SkillSource {
  label: string;
  dir: string;
}

export function skillSources(
  cwd: string,
  homeDir: string = homedir(),
  moduleUrl: string = import.meta.url,
): SkillSource[] {
  const project = resolveProjectRoot(cwd);
  const pkgRoot = pkgRootOf(moduleUrl);
  return [
    { label: "project", dir: join(project, ".agents", "skills") },
    { label: "hub", dir: join(homeDir, ".skillgrid", ".agents", "skills") },
    { label: "user", dir: join(homeDir, ".agents", "skills") },
    { label: "bundled", dir: join(pkgRoot, "skills") },
  ];
}

interface ParsedFrontmatter {
  fields: Record<string, string>;
  body: string;
  /** false when the file starts with `---` but never closes it. */
  complete: boolean;
}

/**
 * Minimal YAML frontmatter parser: `key: value` lines between a leading
 * `---` pair. Indented lines (nested blocks like `metadata:`) and lines
 * without a colon are skipped — this frontmatter dialect has no lists.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split(/\r?\n/);
  let end = -1;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    const open = lines[0]?.trim() === "---";
    return { fields: {}, body: content, complete: !open };
  }
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  let bodyStart = end + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;
  const bodyLines = lines.slice(bodyStart);
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
  return { fields, body: bodyLines.join("\n"), complete: true };
}

function readZone(skillsRoot: string, filePath: string): string {
  const rel = filePath.slice(skillsRoot.length + 1);
  const first = rel.split(/[\\/]/)[0];
  return first || "misc";
}

function parseSkillFile(file: string, skillsRoot: string, notes: string[]): SkillEntry | undefined {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    notes.push(`skill-loader: skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const { fields, body, complete } = parseFrontmatter(content);
  if (!complete) {
    notes.push(`skill-loader: skipping ${file}: unterminated frontmatter`);
    return undefined;
  }
  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description) {
    notes.push(
      `skill-loader: skipping ${file}: missing ${!name ? "name" : "description"} in frontmatter`,
    );
    return undefined;
  }
  return {
    id: name,
    description,
    zone: readZone(skillsRoot, file),
    path: file,
    disableModelInvocation: fields["disable-model-invocation"] === "true",
    body,
  };
}

function walkSkillFiles(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        stack.push(full);
      } else if (isFile && entry.name === "SKILL.md") {
        found.push(full);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

export interface ScanResult {
  /** Deduped by id, first source wins. */
  skills: SkillEntry[];
  /** One line per skipped/invalid SKILL.md, for the caller to log. */
  notes: string[];
}

/**
 * Scan all sources and merge: the first source that provides a given skill
 * name wins, so a project-local copy overrides the hub mirror. Missing
 * source directories are a clean state (an empty result, not an error).
 */
export function scanSkills(
  cwd: string,
  homeDir: string = homedir(),
  moduleUrl: string = import.meta.url,
): ScanResult {
  const notes: string[] = [];
  const byId = new Map<string, SkillEntry>();
  for (const source of skillSources(cwd, homeDir, moduleUrl)) {
    if (!existsSync(source.dir)) continue;
    for (const file of walkSkillFiles(source.dir)) {
      const skill = parseSkillFile(file, source.dir, notes);
      if (!skill) continue;
      if (!byId.has(skill.id)) byId.set(skill.id, skill);
    }
  }
  const zoneRank = (zone: string): number => {
    const i = ZONE_ORDER.indexOf(zone as (typeof ZONE_ORDER)[number]);
    return i === -1 ? ZONE_ORDER.length : i;
  };
  const skills = [...byId.values()].sort(
    (a, b) => zoneRank(a.zone) - zoneRank(b.zone) || a.id.localeCompare(b.id),
  );
  return { skills, notes };
}
