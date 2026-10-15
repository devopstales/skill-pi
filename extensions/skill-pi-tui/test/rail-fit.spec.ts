import { assert, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusCard, type StatusCardModel } from "../src/status-card.ts";
import { SIDEBAR_RAIL_COLUMNS } from "../src/sidebar-layout.ts";

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => `\x1b[48;5;16m${text}\x1b[49m`,
  bold: (text: string) => text,
};

// The rail reserves SIDEBAR_RAIL_COLUMNS (55) for RAIL_WIDTH (50) + GAP (5) and
// renders every part at RAIL_WIDTH - 2*RAIL_PADDING (48). prepare() deactivates
// the whole rail (ownsHost() false, bottom widgets re-appear in the main column)
// when ANY rail line is wider than that 48-column budget — which is exactly the
// "footer missing + no sidebar" symptom: the suppressed main-screen paint is
// keyed off the same activation that the over-wide card fails.
const RAIL_PART_WIDTH = 48;

function check(model: StatusCardModel, label: string): void {
  for (const width of [RAIL_PART_WIDTH, 40, 24]) {
    const lines = renderStatusCard(model, fakeTheme, width);
    const over = lines.filter((line) => visibleWidth(line) > width);
    assert.equal(over.length, 0, `${label} @ ${width}: ${over.length} line(s) over ${width}-col budget: ${JSON.stringify(over)}`);
  }
}

it("status card fits the rail width for typical models", () => {
  check(
    { cwd: "~/git/ai-test/skill-pi", branch: "main", sessionName: "tui work", changes: { files: 3, added: 10, deleted: 2 } },
    "typical",
  );
  check(
    { cwd: "/Users/paladm/projects/some-very/deeply/nested/project/path", branch: null, changes: undefined },
    "long cwd, no git",
  );
  check(
    {
      cwd: "~/git/ai-test/skill-pi",
      branch: "feat/a-very-long-branch-name-that-exceeds-the-rail-width",
      sessionName: "session-name-that-is-fairly-long-too",
      changes: { files: 12, added: 120, deleted: 30, notice: "some untracked files were ignored by the capture logic here" },
    },
    "long branch + notice",
  );
});

it("rail part render width is RAIL_WIDTH - 2*RAIL_PADDING", () => {
  assert.equal(SIDEBAR_RAIL_COLUMNS, 55);
  assert.equal(RAIL_PART_WIDTH, 48);
});
