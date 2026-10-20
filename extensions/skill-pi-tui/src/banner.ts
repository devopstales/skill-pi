import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { VERSION, SettingsManager, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./text.ts";
import { formatCwd } from "./utils.ts";

const LOGO = [
  " ███████╗██╗ ██╔╝██╗██╗     ██╗     ██████╗  ██████╗ ██╗██████╗  ",
  " ██╔════╝██║██╔╝ ██║██║     ██║    ██╔════╝  ██╔══██╗██║██╔══██╗ ",
  " ███████╗█████╔╝ ██║██║     ██║    ██║   ███╗██████╔╝██║██║  ██║ ",
  " ╚════██║██╔═██╗ ██║██║     ██║    ██║    ██║██╔══██╗██║██║  ██║ ",
  " ███████║██║  ██╗██║███████╗███████╗╚██████╔╝██║  ██║██║██████╔╝ ",
  " ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ",
];

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const FG = "\x1b[38;2;152;84;241m";

function color(text: string): string {
  return `${BOLD}${FG}${text}${RESET}`;
}

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export interface BannerStats {
  gitBranch: string;
  path: string;
  mcpServers: number;
  packages: number;
  skills: number;
  extensions: number;
  piVersion: string;
  customTools: number;
}

export function gitBranch(cwd: string): string {
  try {
    const branch = sanitizeTerminalText(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim());
    return branch || "(detached)";
  } catch {
    return "(not a git repo)";
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function mcpServerCount(cwd: string, agentDir: string): number {
  const count = (doc: unknown): number => {
    const servers = (doc as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers;
    return servers && typeof servers === "object" ? Object.keys(servers).length : 0;
  };
  // mcp.json files are additive: the project layer sits next to cwd, the
  // global one next to the agent dir.
  return count(readJson(join(cwd, "mcp.json"))) + count(readJson(join(agentDir, "mcp.json")));
}

export async function loadedResourceCounts(
  cwd: string,
  agentDir: string,
  cliExtensions: string[],
  cliSkills: string[],
): Promise<{ skills: number; extensions: number }> {
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: cliExtensions,
      additionalSkillPaths: cliSkills,
      noExtensions: true,
    });
    await loader.reload();
    return {
      skills: loader.getSkills().skills.length,
      extensions: loader.getExtensions().extensions.length,
    };
  } catch {
    return { skills: 0, extensions: 0 };
  }
}

function buildStatsLines(stats: BannerStats): string[] {
  const cells: Array<[string, string]> = [
    ["GIT:", `On branch ${stats.gitBranch}`],
    ["PATH:", stats.path],
    ["MCP:", `${stats.mcpServers} server(s)`],
    ["PLUGINS:", `${stats.packages} package(s)`],
    ["SKILLS:", `${stats.skills} loaded`],
    ["EXTENSIONS:", `${stats.extensions} active`],
    ["PI:", `v${stats.piVersion}`],
    ["TOOLS:", `${stats.customTools} custom`],
  ];
  const labelW = Math.max(...cells.map(([l]) => l.length));
  const kvGap = 1;
  const cellGap = 4;
  const valueW = Math.max(...cells.map(([, v]) => v.length));
  const cellW = labelW + kvGap + valueW;
  const rows: Array<[string, string, string, string]> = [];
  for (let i = 0; i < cells.length; i += 2) {
    const [l1, v1] = cells[i];
    const [l2, v2] = cells[i + 1] || ["", ""];
    rows.push([l1, v1, l2, v2]);
  }
  return rows.map(([l1, v1, l2, v2]) => {
    const left = `${l1.padEnd(labelW)}${" ".repeat(kvGap)}${dim(v1.padEnd(valueW))}`;
    const right = l2 ? `${l2.padEnd(labelW)}${" ".repeat(kvGap)}${dim(v2.padEnd(valueW))}` : " ".repeat(cellW);
    return left + " ".repeat(cellGap) + right;
  });
}

export class BannerHeader implements Component {
  private stats: BannerStats;

  constructor(stats: BannerStats) {
    this.stats = stats;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    for (const line of LOGO) {
      const pad = Math.max(0, Math.floor((width - line.length) / 2));
      lines.push(" ".repeat(pad) + color(line));
    }

    const tagline = "isolated session ready";
    const tagPad = Math.max(0, Math.floor((width - tagline.length) / 2));
    lines.push(" ".repeat(tagPad) + dim(tagline));

    for (const line of buildStatsLines(this.stats)) {
      const pad = Math.max(0, Math.floor((width - line.length) / 2));
      lines.push(" ".repeat(pad) + line);
    }

    return lines.map((l) => truncateToWidth(l, width, ""));
  }
}

export function buildBannerStats(input: {
  cwd: string;
  settings: { packages: number };
  customTools: number;
  mcpConfigured: number;
  mcpLoaded: number;
  skills: number;
  extensions: number;
}): BannerStats {
  const mcpServers = input.mcpConfigured > 0 ? input.mcpConfigured : input.mcpLoaded;
  return {
    gitBranch: gitBranch(input.cwd),
    path: formatCwd(input.cwd),
    mcpServers,
    packages: input.settings.packages,
    skills: input.skills,
    extensions: input.extensions,
    piVersion: VERSION,
    customTools: input.customTools,
  };
}

export function countCustomTools(getAllTools: () => Array<{ sourceInfo: { source: string } }>): number {
  try {
    let n = 0;
    for (const tool of getAllTools()) {
      if (tool.sourceInfo.source !== "builtin") n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}
