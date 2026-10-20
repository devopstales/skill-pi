import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tmpRoot = mkdtempSync(resolve(homedir(), "skill-loader-test-"));
const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(extensionDir, "..", "..");

function skillFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function makeSkill(name: string, description: string, extra = "", body = `# ${name}\n\nBody for ${name}.`): string {
  return `---\nname: ${name}\ndescription: "${description}"\n${extra}---\n${body}\n`;
}

function writeSkill(root: string, rel: string, name: string, description: string, extra = "", body?: string): void {
  skillFile(join(root, rel, "SKILL.md"), makeSkill(name, description, extra, body));
}

export interface Fixture {
  project: string;
  home: string;
  moduleUrl: string;
  clean: () => void;
}

/**
 * Build an isolated fixture tree: <tmp>/project with .agents/skills,
 * <tmp>/home standing in for the user home (.skillgrid + .agents), and a
 * moduleUrl whose pkgRoot carries a skills/ dir. Points nowhere near the
 * live ~/.skillgrid.
 */
export function makeFixture(prefix = "main"): Fixture {
  const root = join(tmpRoot, prefix);
  const project = join(root, "project");
  const home = join(root, "home");
  const fakeExtDir = join(root, "fake-ext", "skill-loader");
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(fakeExtDir, ".."), { recursive: true });
  mkdirSync(join(pkgRootForModule(join(fakeExtDir, "index.ts")), "skills"), { recursive: true });

  const projectSkills = join(project, ".agents", "skills");
  const hubSkills = join(home, ".skillgrid", ".agents", "skills");
  const userSkills = join(home, ".agents", "skills");

  // shared zone skill: same name in project and hub → project wins
  writeSkill(projectSkills, "lifecycle/ship", "ship", "project ship description", "", "project ship body");
  writeSkill(hubSkills, "lifecycle/ship", "ship", "hub ship description", "", "hub ship body");

  // hub-only skills
  writeSkill(hubSkills, "lifecycle/resume", "resume", "resume a previous session");
  writeSkill(hubSkills, "planning/writing-blueprints", "writing-blueprints", "write a blueprint");
  writeSkill(hubSkills, "execution/subagent-execution", "subagent-execution", "execute a plan with subagents");
  writeSkill(hubSkills, "verification/qa", "qa", "quality gate");
  writeSkill(hubSkills, "design/brand", "brand", "brand voice and identity");
  writeSkill(hubSkills, "knowledge/knowledge-base", "knowledge-base", "search the project knowledge base", "disable-model-invocation: true\n");
  writeSkill(hubSkills, "lifecycle/mystery", "mystery", "shared reference skill", "disable-model-invocation: true\n");

  // invalid skills: missing description / missing name / unterminated frontmatter
  skillFile(join(projectSkills, "lifecycle", "no-desc", "SKILL.md"), `---\nname: no-desc\n---\nbody\n`);
  skillFile(join(hubSkills, "craft", "no-name", "SKILL.md"), `---\ndescription: "no name"\n---\nbody\n`);
  skillFile(join(hubSkills, "craft", "unterminated", "SKILL.md"), `---\nname: unterminated\ndescription: "never closes"\n`);

  // user fallback skill (name absent from project + hub)
  writeSkill(userSkills, "verification/trivy", "trivy", "trivy security scan");

  const moduleUrl = join(fakeExtDir, "index.ts");
  return {
    project,
    home,
    moduleUrl,
    clean: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

export function pkgRootForModule(moduleUrl: string): string {
  return resolve(dirname(moduleUrl), "..", "..");
}

export function makeBigFixture(count: number): Fixture {
  const root = join(tmpRoot, `big-${count}`);
  const project = join(root, "project");
  const home = join(root, "home");
  const fakeExtDir = join(root, "fake-ext", "skill-loader");
  mkdirSync(join(project, ".agents", "skills"), { recursive: true });
  mkdirSync(join(home, ".skillgrid", ".agents", "skills"), { recursive: true });
  mkdirSync(join(pkgRootForModule(join(fakeExtDir, "index.ts")), "skills"), { recursive: true });
  for (let i = 0; i < count; i++) {
    const zone = i % 3 === 0 ? "knowledge" : i % 3 === 1 ? "design" : "craft";
    const desc = `bulk description ${i} — ` + "x".repeat(220);
    writeSkill(join(home, ".skillgrid", ".agents", "skills"), `${zone}/bulk-${i}`, `bulk-${i}`, desc);
  }
  writeSkill(join(home, ".skillgrid", ".agents", "skills"), "lifecycle/keepme", "keepme", "core zone skill that must survive collapse");
  const moduleUrl = join(fakeExtDir, "index.ts");
  return {
    project,
    home,
    moduleUrl,
    clean: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

export { tmpRoot, existsSync, writeFileSync, mkdirSync, readdirSync };
