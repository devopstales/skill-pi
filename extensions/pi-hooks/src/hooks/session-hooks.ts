import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HookModuleContext } from "../hook-context.ts";
import type {
  HookExecutionContext,
  HookMatcherValue,
  HookRunResult,
  NotifyFn,
  SettingsFile,
} from "../types.ts";
import { triggerSimpleHooks } from "./shared.ts";

export async function triggerSessionHooks(
  eventName: "SessionStart" | "SessionEnd",
  matcherValue: HookMatcherValue<"SessionStart"> | HookMatcherValue<"SessionEnd">,
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<HookRunResult> {
  return triggerSimpleHooks(eventName, matcherValue, context, settings, notify);
}

export function registerSessionHooks(
  pi: ExtensionAPI,
  shared: HookModuleContext,
) {
  // SessionStart mapping: startup/new -> "startup", resume -> "resume",
  // compact -> "compact" (triggered from session_compact). SessionEnd is
  // fired by session_shutdown with matcher "other".
  pi.on("session_start", async (event, ctx) => {
    shared.initSettings(ctx.cwd);

    if (event.reason === "startup" || event.reason === "new") {
      await shared.triggerSessionStartHook("startup", ctx);
      return;
    }

    if (event.reason === "resume") {
      await shared.triggerSessionStartHook("resume", ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const reason = "other";
    await triggerSessionHooks(
      "SessionEnd",
      reason,
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "SessionEnd",
        reason,
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );
  });
}
