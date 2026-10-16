import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tempDirs: string[] = [];
const agentDirMock = vi.hoisted(() => ({ value: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDirMock.value,
}));

const { loadConfig, getConfPaths, resolveProjectRoot } = await import(
  "./src/config.ts"
);

beforeEach(() => {
  // getAgentDir() returns <agentDir>; userConfPath = dirname(getAgentDir())/conf.d.
  // So the mock value must be <tmp>/agent for the user conf to land in <tmp>/conf.d.
  const agentDir = join(mkdtempSync(join(tmpdir(), "lsp-home-")), "agent");
  tempDirs.push(dirname(agentDir));
  agentDirMock.value = agentDir;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lsp-cfg-"));
  tempDirs.push(dir);
  return dir;
}

function writeConf(dir: string, config: object, scope: "user" | "project" = "project"): void {
  if (scope === "user") {
    // userConfPath = dirname(getAgentDir())/conf.d — write to the parent of the agent dir.
    const confDir = join(dirname(agentDirMock.value), "conf.d");
    mkdirSync(confDir, { recursive: true });
    writeFileSync(
      join(confDir, "lsp.conf"),
      JSON.stringify(config, null, 2),
    );
  } else {
    mkdirSync(join(dir, ".skill-pi", "conf.d"), { recursive: true });
    writeFileSync(
      join(dir, ".skill-pi", "conf.d", "lsp.conf"),
      JSON.stringify(config, null, 2),
    );
  }
}

const tsServer = {
  id: "ts",
  languages: ["typescript"],
  command: { command: "typescript-language-server", args: ["--stdio"] },
};

const pyServer = {
  id: "py",
  languages: ["python"],
  command: { command: "pylsp" },
};

const goServer = {
  id: "go",
  languages: ["go"],
  command: { command: "gopls" },
};

describe("loadConfig conf.d (ADR 0008)", () => {
  it("loads from the user conf.d when no project conf exists", () => {
    const localDir = makeTempDir();
    writeConf(localDir, { servers: [tsServer] }, "user");

    const config = loadConfig(localDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("ts");
  });

  it("loads from the project conf.d when no user conf exists", () => {
    const localDir = makeTempDir();
    writeConf(localDir, { servers: [pyServer] }, "project");

    const config = loadConfig(localDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("py");
  });

  it("merges user and project conf, project servers first", () => {
    const localDir = makeTempDir();
    writeConf(localDir, { servers: [tsServer, goServer] }, "user");
    writeConf(localDir, { servers: [pyServer] }, "project");

    const config = loadConfig(localDir);
    expect(config.servers).toHaveLength(3);
    expect(config.servers[0].id).toBe("py");
    expect(config.servers[1].id).toBe("ts");
    expect(config.servers[2].id).toBe("go");
  });

  it("project server overrides user server with the same id", () => {
    const localDir = makeTempDir();
    const userTs = { ...tsServer, command: { command: "user-ts" } };
    const projectTs = { ...tsServer, command: { command: "project-ts" } };
    writeConf(localDir, { servers: [userTs, goServer] }, "user");
    writeConf(localDir, { servers: [projectTs] }, "project");

    const config = loadConfig(localDir);
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0].id).toBe("ts");
    expect(config.servers[0].command.command).toBe("project-ts");
    expect(config.servers[1].id).toBe("go");
  });

  it("project settings override user settings", () => {
    const localDir = makeTempDir();
    writeConf(
      localDir,
      { servers: [tsServer], defaultLimit: 10, maxLimit: 50, eagerInit: false },
      "user",
    );
    writeConf(
      localDir,
      { servers: [pyServer], defaultLimit: 20, maxLimit: 100, eagerInit: true },
      "project",
    );

    const config = loadConfig(localDir);
    expect(config.defaultLimit).toBe(20);
    expect(config.maxLimit).toBe(100);
    expect(config.eagerInit).toBe(true);
  });

  it("throws when neither user nor project conf exists", () => {
    const localDir = makeTempDir();
    expect(() => loadConfig(localDir)).toThrow(/lsp\.conf/);
  });

  it("supports JSONC comments in the conf file", () => {
    const localDir = makeTempDir();
    mkdirSync(join(localDir, ".skill-pi", "conf.d"), { recursive: true });
    writeFileSync(
      join(localDir, ".skill-pi", "conf.d", "lsp.conf"),
      `{\n  // project LSP config\n  "servers": [${JSON.stringify(tsServer)}]\n}\n`,
    );

    const config = loadConfig(localDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("ts");
  });
});

describe("getConfPaths (ADR 0008)", () => {
  it("derives user conf from dirname(getAgentDir())/conf.d", () => {
    const paths = getConfPaths(process.cwd());
    expect(paths.user).toBe(
      join(dirname(agentDirMock.value), "conf.d", "lsp.conf"),
    );
  });

  it("derives project conf from the cwd (no git in tmp dir)", () => {
    const localDir = makeTempDir();
    const paths = getConfPaths(localDir);
    expect(paths.project).toBe(
      join(localDir, ".skill-pi", "conf.d", "lsp.conf"),
    );
  });
});

describe("resolveProjectRoot", () => {
  it("falls back to the cwd when not in a git repo", () => {
    const localDir = makeTempDir();
    expect(resolveProjectRoot(localDir)).toBe(localDir);
  });
});
