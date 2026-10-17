import { assert, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  contextZone,
  renderZoneBar,
  zoneCeilingRemaining,
  ZONE_DANGER_PCT,
  ZONE_WARN_PCT,
} from "./src/context-zone.ts";

const zoneTheme = {
  fg: (color: string, text: string) => `\x1b[38;5;${colorToCode(color)}m${text}`,
} as unknown as Theme;

const colorToCode = (color: string): number => {
  const codes: Record<string, number> = {
    success: 40,
    warning: 214,
    error: 196,
    dim: 244,
  };
  return codes[color] ?? 15;
};

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

it("zone thresholds match the reference (40/70)", () => {
  assert.equal(ZONE_WARN_PCT, 40);
  assert.equal(ZONE_DANGER_PCT, 70);
});

it("contextZone maps pct to smart/warm/dumb at the exact boundaries", () => {
  assert.equal(contextZone(0).key, "smart");
  assert.equal(contextZone(39.9).key, "smart");
  assert.equal(contextZone(40).key, "warm");
  assert.equal(contextZone(69.9).key, "warm");
  assert.equal(contextZone(70).key, "dumb");
  assert.equal(contextZone(100).key, "dumb");
});

it("contextZone exposes icons, labels, and colors per zone", () => {
  assert.deepEqual(
    [contextZone(10), contextZone(50), contextZone(80)].map((z) => [z.icon, z.label, z.color]),
    [
      ["🧠", "smart", "success"],
      ["⚠️", "warm", "warning"],
      ["🧟", "dumb", "error"],
    ],
  );
});

it("zoneCeilingRemaining counts down to the current zone ceiling", () => {
  assert.equal(zoneCeilingRemaining(36), 4); // 40 - 36
  assert.equal(zoneCeilingRemaining(0), 40);
  assert.equal(zoneCeilingRemaining(40), 30); // 70 - 40
  assert.equal(zoneCeilingRemaining(70), 30); // 100 - 70
  assert.equal(zoneCeilingRemaining(95), 5);
  assert.equal(zoneCeilingRemaining(100), 0);
});

it("renderZoneBar fills, dims, and marks zone boundaries for a 20-char bar", () => {
  // 36% → 7 filled (of 18 non-divider cells); dividers at positions 8 (40%) and 14 (70%).
  const bar = renderZoneBar(36, 20, zoneTheme);
  assert.equal(strip(bar).length, 20);
  assert.equal(strip(bar).slice(0, 7), "███████");
  assert.equal(strip(bar)[7], "░");
  assert.equal(strip(bar)[8], "│");
  assert.equal(strip(bar)[14], "│");
  assert.equal(strip(bar)[19], "░");
  assert.ok(bar.includes("\x1b[38;5;40m"), "filled cells use the smart/success color");
  assert.ok(bar.includes("\x1b[38;5;244m"), "empty and divider cells use dim");
  assert.ok(!bar.includes("\x1b[38;5;196m"), "no error color in the smart zone");
});

it("renderZoneBar switches colors as the zone changes", () => {
  assert.ok(renderZoneBar(50, 20, zoneTheme).includes("\x1b[38;5;214m"), "warm zone → warning color");
  assert.ok(renderZoneBar(80, 20, zoneTheme).includes("\x1b[38;5;196m"), "dumb zone → error color");
});

it("renderZoneBar fills everything at 100%", () => {
  const bar = renderZoneBar(100, 20, zoneTheme);
  assert.equal(strip(bar), "█".repeat(8) + "│" + "█".repeat(5) + "│" + "█".repeat(5));
});
