import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./hooks.mjs", import.meta.url).pathname).href, import.meta.url);

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFixture } from "./fixtures.ts";

describe("wiring (isolated)", () => {
  it("registers use_skill and sends the catalog once on startup", async () => {
    const { default: ext } = await import("../index.ts");
    const handlers: Record<string, (event: any, ctx: any) => any> = {};
    const tools: Array<{ name: string }> = [];
    const sent: Array<{ customType: string; content: unknown; display: boolean }> = [];
    const pi = {
      on: (name: string, handler: any) => {
        handlers[name] = handler;
        return () => {
          delete handlers[name];
        };
      },
      registerTool: (tool: { name: string }) => {
        tools.push(tool);
      },
      sendMessage: (msg: { customType: string; content: unknown; display: boolean }) => {
        sent.push(msg);
      },
    } as unknown as any;
    const fixture = makeFixture("wiring");
    try {
      ext(pi);
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, "use_skill");
      handlers.session_start(
        { reason: "startup" },
        { cwd: fixture.project, getSystemPrompt: () => "Base system prompt." },
      );
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(sent.length, 1);
      assert.ok(String(sent[0].content).includes("## Available skills"));
    } finally {
      fixture.clean();
    }
  });
});
