import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDirMock = vi.hoisted(() => ({ value: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDirMock.value,
}));

const { createCodeSymbolsTool } = await import("./src/tool.ts");
const { LspServerManager } = await import("./src/server-manager.ts");
const { SourceExtractor } = await import("./src/source-extractor.ts");

const extensionDir = dirname(fileURLToPath(import.meta.url));
const fakeServerScript = join(extensionDir, "fake-lsp-server.ts");

const tempDirs: string[] = [];

beforeEach(() => {
  // getAgentDir() returns <agentDir>; userConfPath = dirname(getAgentDir())/conf.d.
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

// createWorkspace builds a temp non-git workspace. resolveProjectRoot falls
// back to the cwd for non-git dirs, so the project conf lands at
// <workspace>/.skill-pi/conf.d/lsp.conf — which is what loadConfig(cwd) reads.
function createWorkspace(): { cwd: string; logFile: string } {
  const cwd = mkdtempSync(join(tmpdir(), "lsp-ws-"));
  tempDirs.push(cwd);
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, "test"), { recursive: true });
  mkdirSync(join(cwd, "pkg"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture" }));
  writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname='fixture'\n");
  writeFileSync(
    join(cwd, "src", "app.ts"),
    "export function runTask() {\n  return 1;\n}\n",
  );
  writeFileSync(join(cwd, "test", "app.test.ts"), "runTask();\n");
  writeFileSync(
    join(cwd, "pkg", "tool.py"),
    "def make_widget():\n    return 1\n",
  );
  const logFile = join(cwd, "lsp.log");
  const confDir = join(cwd, ".skill-pi", "conf.d");
  mkdirSync(confDir, { recursive: true });
  writeFileSync(
    join(confDir, "lsp.conf"),
    JSON.stringify(
      {
        servers: [
          {
            id: "ts",
            languages: ["typescript"],
            fileGlobs: ["src/*.ts", "test/*.ts"],
            rootMarkers: ["package.json"],
            command: {
              command: process.execPath,
              args: [fakeServerScript],
              env: {
                FAKE_LSP_MODE: "typescript",
                FAKE_LSP_LOG_FILE: logFile,
              },
            },
          },
          {
            id: "py",
            languages: ["python"],
            fileGlobs: ["pkg/*.py"],
            rootMarkers: ["pyproject.toml"],
            command: {
              command: process.execPath,
              args: [fakeServerScript],
              env: {
                FAKE_LSP_MODE: "python",
                FAKE_LSP_LOG_FILE: logFile,
              },
            },
          },
        ],
      },
      null,
      2,
    ),
  );
  return { cwd, logFile };
}

function createContext(cwd: string) {
  return {
    cwd,
  } as never;
}

describe("code_symbols", () => {
  it("search routes to the matching configured server", async () => {
    const { cwd, logFile } = createWorkspace();
    const manager = new LspServerManager();
    const tool = createCodeSymbolsTool(manager, new SourceExtractor());

    const result = await tool.execute(
      "tool-call-1",
      {
        action: "search",
        name: "run",
        filePath: "src/app.ts",
      },
      undefined,
      undefined,
      createContext(cwd),
    );

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type !== "text") {
      throw new Error("Expected text result");
    }
    expect(result.content[0].text).toContain("runTask");
    expect(result.details).toEqual({
      serverId: "ts",
      rootPath: cwd,
      count: 1,
    });

    await manager.stopAll();
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("initialize:typescript");
    expect(log).toContain("workspace/symbol:typescript");
    expect(log).toContain("shutdown:typescript");
  });

  it("search matches partial names without explicit wildcards", async () => {
    const { cwd } = createWorkspace();
    const manager = new LspServerManager();
    const tool = createCodeSymbolsTool(manager, new SourceExtractor());

    const result = await tool.execute(
      "tool-call-partial",
      {
        action: "search",
        name: "Task",
        filePath: "src/app.ts",
      },
      undefined,
      undefined,
      createContext(cwd),
    );

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type !== "text") {
      throw new Error("Expected text result");
    }
    expect(result.content[0].text).toContain("runTask");
    expect(result.details?.count).toBe(1);

    await manager.stopAll();
  });

  it("definitions use document symbols and definition lookup", async () => {
    const { cwd, logFile } = createWorkspace();
    const manager = new LspServerManager();
    const tool = createCodeSymbolsTool(manager, new SourceExtractor());

    const result = await tool.execute(
      "tool-call-2",
      {
        action: "definitions",
        name: "runTask",
        filePath: "src/app.ts",
        includeSource: true,
      },
      undefined,
      undefined,
      createContext(cwd),
    );

    if (result.content[0]?.type !== "text") {
      throw new Error("Expected text result");
    }
    expect(result.content[0].text).toContain("runTask");
    expect(result.content[0].text).toContain("```");
    await manager.stopAll();

    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("didOpen:typescript");
    expect(log).toContain("documentSymbol:typescript");
    expect(log).toContain("definition:typescript");
  });

  it("references can route to a different server family", async () => {
    const { cwd, logFile } = createWorkspace();
    const manager = new LspServerManager();
    const tool = createCodeSymbolsTool(manager, new SourceExtractor());

    const result = await tool.execute(
      "tool-call-3",
      {
        action: "references",
        name: "make_*",
        filePath: "pkg/tool.py",
      },
      undefined,
      undefined,
      createContext(cwd),
    );

    if (result.content[0]?.type !== "text") {
      throw new Error("Expected text result");
    }
    expect(result.content[0].text).toContain("make_widget");
    expect(result.details).toEqual({
      serverId: "py",
      rootPath: cwd,
      count: 1,
    });
    await manager.stopAll();

    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("initialize:python");
    expect(log).toContain("references:python");
  });

  it("eagerInit spawns servers on session_start", async () => {
    const { cwd, logFile } = createWorkspace();
    const piExtension = (await import("./index.ts")).default;
    const manager = new LspServerManager();
    const handlers: Record<string, unknown[]> = {};
    const fakePi = {
      registerTool: () => {},
      on: (event: string, handler: unknown) => {
        handlers[event] = [handler];
      },
    };
    piExtension(fakePi as never);

    const sessionStartHandler = handlers["session_start"]?.[0] as
      | ((event: unknown, ctx: { cwd: string }) => void)
      | undefined;
    expect(sessionStartHandler).toBeDefined();

    const confDir = join(cwd, ".skill-pi", "conf.d");
    const confPath = join(confDir, "lsp.conf");
    const conf = JSON.parse(readFileSync(confPath, "utf8")) as Record<string, unknown>;
    conf.eagerInit = true;
    writeFileSync(confPath, JSON.stringify(conf, null, 2));

    sessionStartHandler!({}, { cwd });
    await new Promise((r) => setTimeout(r, 500));

    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("initialize:typescript");
    expect(log).toContain("initialize:python");
  });
});
