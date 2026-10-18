import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { registerVccStatusCommand } from "../src/commands/vcc-status";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-status-"));

afterAll(() => {
  delete process.env.PI_VCC_LAST_COMPACT_PATH;
  delete process.env.PI_VCC_CONFIG_PATH;
  delete process.env.PI_VCC_INCLUDES_PATH;
});

const LAST_FIXTURE = {
  at: "2026-10-18T09:00:00.000Z",
  reason: "manual",
  keptUserTurns: 2,
  totalUserTurns: 5,
  keptTokensEst: 3200,
  smartKeepAdjusted: true,
  sections: ["Goals", "State"],
  firstKeptEntryId: "u3",
  summaryLength: 4321,
};

function seed(dir: string) {
  const lastPath = join(dir, "last.json");
  writeFileSync(lastPath, JSON.stringify(LAST_FIXTURE));
  const configPath = join(dir, "pi-vcc-config.json");
  writeFileSync(configPath, JSON.stringify({ smartKeepTail: true, overrideDefaultCompaction: true }));

  const includedMd = join(dir, "included.md");
  writeFileSync(includedMd, "Always run tests.\nNever commit secrets.\n");
  const missingMd = join(dir, "missing.md");
  const includesPath = join(dir, "pi-vcc-includes.json");
  writeFileSync(includesPath, JSON.stringify({ includes: [{ path: includedMd, source: "AGENTS.md" }, { path: missingMd }] }));
  return { lastPath, configPath, includesPath, includedMd, missingMd };
}

function harness(dir: string) {
  const messages: Array<{ message: any; options: any }> = [];
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const pi = {
    registerCommand: (name: string, command: { handler: typeof handler }) => {
      expect(name).toBe("pi-vcc:status");
      handler = command.handler;
    },
    sendMessage: (message: any, options: any) => {
      messages.push({ message, options });
    },
  } as any;
  const ctx = { ui: { notify: () => {} } };
  registerVccStatusCommand(pi);
  return { invoke: () => handler!("", ctx), messages };
}

describe("vcc-status (SATISFIES: vcc-status)", () => {
  it("prints last compaction, settings, and include status after a completed compaction", async () => {
    const dir = tmp();
    const { lastPath, configPath, includesPath } = seed(dir);
    process.env.PI_VCC_LAST_COMPACT_PATH = lastPath;
    process.env.PI_VCC_CONFIG_PATH = configPath;
    process.env.PI_VCC_INCLUDES_PATH = includesPath;
    const { invoke, messages } = harness(dir);

    await invoke();

    expect(messages).toHaveLength(1);
    const { message, options } = messages[0];
    expect(message.customType).toBe("pi-vcc-status");
    expect(message.display).toBe(true);
    expect(options.triggerTurn).toBe(true);
    const out = message.content;

    expect(out).toContain("Last compaction:");
    expect(out).toContain("2026-10-18T09:00:00.000Z");
    expect(out).toContain("manual");
    expect(out).toContain("2/5");
    expect(out).toContain("3.2k");
    expect(out).toContain("smart-keep");
    expect(out).toContain("Goals");
    expect(out).toContain("State");
    expect(out).toContain("u3");

    expect(out).toContain("Settings:");
    expect(out).toContain("smartKeepTail: true");
    expect(out).toContain("overrideDefaultCompaction: true");
    expect(out).toContain("continueAfterThresholdCompact: true");
    expect(out).toContain("debug: false");

    expect(out).toContain("Includes:");
    expect(out).toContain(`loaded ${basename(dir + "/included.md")}`);
    expect(out).toContain(`missing ${dir}/missing.md`);
    expect(out).toContain("2/150 lines");
    expect(out).toContain("/6144 bytes");

    rmSync(dir, { recursive: true, force: true });
  });

  it("prints a graceful empty state when no compaction has happened yet", async () => {
    const dir = tmp();
    const { configPath, includesPath } = seed(dir);
    process.env.PI_VCC_LAST_COMPACT_PATH = join(dir, "never.json");
    process.env.PI_VCC_CONFIG_PATH = configPath;
    process.env.PI_VCC_INCLUDES_PATH = includesPath;
    const { invoke, messages } = harness(dir);

    await invoke();

    const out = messages[0].message.content;
    expect(out).toContain("Last compaction:");
    expect(out).toContain("none yet");
    expect(out).not.toContain("2026-10-18");
    expect(out).toContain("Settings:");
    expect(out).toContain("Includes:");

    rmSync(dir, { recursive: true, force: true });
  });

  it("shows empty include list when the handshake file is missing", async () => {
    const dir = tmp();
    const { lastPath, configPath } = seed(dir);
    process.env.PI_VCC_LAST_COMPACT_PATH = lastPath;
    process.env.PI_VCC_CONFIG_PATH = configPath;
    process.env.PI_VCC_INCLUDES_PATH = join(dir, "no-includes.json");
    const { invoke, messages } = harness(dir);

    await invoke();

    const out = messages[0].message.content;
    expect(out).toContain("Includes:");
    expect(out).toContain("none");
    expect(out).toContain("0/150 lines");

    rmSync(dir, { recursive: true, force: true });
  });
});
