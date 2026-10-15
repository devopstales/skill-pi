import mod from "./index.ts";
import { renderCard, cardStyle } from "./src/card.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { captureChanges, emptyChanges } from "./src/changes.ts";
import { renderStatusCard } from "./src/status-card.ts";
import { installSidebar, invalidateSidebar } from "./src/sidebar-layout.ts";
import { sidebarState, sidebarPart } from "./src/sidebar.ts";
for (const fn of [renderCard, cardStyle, sanitizeTerminalText, captureChanges, emptyChanges, renderStatusCard, installSidebar, invalidateSidebar, sidebarState, sidebarPart]) {
  if (typeof fn !== "function") throw new Error("expected a function export");
}
if (typeof mod !== "function" && typeof mod !== "object") throw new Error("expected index.ts default export");
console.log("ok");
