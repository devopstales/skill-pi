import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";

export interface AgentType {
  name: string;
  description: string;
  model?: string;
  maxTurns?: number;
  color?: string;
  systemPrompt: string;
  source: "project" | "global";
}

export function resolveProjectDir(cwd: string): string {
  const link = join(cwd, "project");
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(link);
      return isAbsolute(target) ? target : resolve(dirname(link), target);
    }
  } catch {
  }
  return cwd;
}

function parseAgentFile(file: string, source: "project" | "global"): AgentType | undefined {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    console.warn(`pi-swarm: skipping agent file ${basename(file)}: ${(err as Error).message}`);
    return undefined;
  }
  const parsed = parseFrontmatter(content);
  const fm = parsed.frontmatter ?? {};
  const hasFrontmatter = stripFrontmatter(content) !== content;
  if (content.trimStart().startsWith("---") && !hasFrontmatter) {
    console.warn(`pi-swarm: skipping agent file ${basename(file)}: unterminated frontmatter`);
    return undefined;
  }
  const name = typeof fm.name === "string" && fm.name.trim() !== "" ? fm.name.trim() : basename(file, ".md");
  const description = typeof fm.description === "string" && fm.description.trim() !== "" ? fm.description : basename(file, ".md");
  const systemPrompt = parsed.body.trim();
  const maxTurns = typeof fm.max_turns === "number" ? fm.max_turns : undefined;
  const model = typeof fm.model === "string" ? fm.model : undefined;
  const color = typeof fm.color === "string" ? fm.color : undefined;
  return { name, description, maxTurns, model, color, systemPrompt, source };
}

function listAgentFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

export function discoverAgentTypes(projectDir: string, agentDir: string): AgentType[] {
  const project = resolveProjectDir(projectDir);
  const projectTypes = listAgentFiles(join(project, ".skill-pi", "agents"))
    .map((f) => parseAgentFile(f, "project"))
    .filter((t): t is AgentType => t !== undefined);
  const projectNames = new Set(projectTypes.map((t) => t.name));
  const globalTypes = listAgentFiles(join(agentDir, "agents"))
    .map((f) => parseAgentFile(f, "global"))
    .filter((t): t is AgentType => t !== undefined && !projectNames.has(t.name));
  const combined = [...projectTypes, ...globalTypes].filter((t): t is AgentType => t !== undefined);
  const seen = new Set<string>();
  const unique: AgentType[] = [];
  for (const t of combined) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    unique.push(t);
  }
  return unique;
}

export function resolveAgentType(types: readonly AgentType[], name: string): AgentType | undefined {
  return types.find((t) => t.name === name);
}
