/**
 * lsp (skill-pi) — LSP-backed code symbol search for the Pi coding agent.
 * Registers a `code_symbols` tool that spawns and manages one LSP subprocess
 * per (serverId, workspace root) pair and routes requests by serverId,
 * language, and filePath. Config lives in conf.d per ADR 0008:
 * `<git-root>/.skill-pi/conf.d/lsp.conf` (project) merged over
 * `dirname(getAgentDir())/conf.d/lsp.conf` (user).
 *
 * Forked from jtepe/pi-lsp (MIT), homogenized for skill-pi: imports moved to
 * @earendil-works/*, config relocated to the ADR 0008 conf.d contract, and
 * the test fake runs under node instead of bun.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, serversForWorkspace } from "./src/config.ts";
import { createCodeSymbolsTool } from "./src/tool.ts";
import { LspServerManager } from "./src/server-manager.ts";
import { SourceExtractor } from "./src/source-extractor.ts";

export default function piLspExtension(pi: ExtensionAPI) {
  const manager = new LspServerManager();
  const sourceExtractor = new SourceExtractor();

  pi.registerTool(createCodeSymbolsTool(manager, sourceExtractor));

  pi.on("session_start", (_event, ctx) => {
    try {
      const config = loadConfig(ctx.cwd);
      if (!config.eagerInit) return;
      for (const server of serversForWorkspace(config, ctx.cwd)) {
        manager
          .getClient(config, ctx.cwd, { serverId: server.id })
          .catch(() => {});
      }
    } catch {}
  });

  pi.on("session_shutdown", () => {
    void manager.stopAll();
  });
}
