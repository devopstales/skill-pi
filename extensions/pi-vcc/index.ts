import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scaffoldSettings } from "./src/core/settings";
import { registerBeforeCompactHook } from "./src/hooks/before-compact";
import { registerPiVccCommand } from "./src/commands/pi-vcc";
import { registerVccRecallCommand } from "./src/commands/vcc-recall";
import { registerVccStatusCommand } from "./src/commands/vcc-status";
import { registerRecallTool } from "./src/tools/recall";

export default (pi: ExtensionAPI) => {
  scaffoldSettings();
  registerBeforeCompactHook(pi);
  registerPiVccCommand(pi);
  registerVccRecallCommand(pi);
  registerVccStatusCommand(pi);
  registerRecallTool(pi);
};
