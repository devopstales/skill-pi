# Source: .skillgrid/specs/2026-10-14-skill-pi-tui-sidebar/briefing.md
# Template: .agents/skills/_shared/templates/template-acceptance.feature
# Trace: briefing.md ## Purpose & Success Criteria; blueprint.md Must-Haves + threat matrix.
# Mapping: @p0 scenarios ↔ success criteria / DoD; @p1 = important failure paths.
# One Feature per task; tag each Feature with @task-NN matching tasks.md.

@task-01
Feature: skill-pi-banner renamed to folder-based skill-pi-tui
  As a skill-pi maintainer
  I want the banner extension as a self-contained folder (ADR-0007) named for its true TUI scope
  So that future TUI features have a home and the extension stays independently inspectable

  @happy @p0
  Scenario: Folder structure exists and old file is gone
    Given the repo after this change
    When the extensions directory is listed
    Then extensions/skill-pi-tui/index.ts exists
    And extensions/skill-pi-tui/package.json exists with private true and no name field
    And extensions/skill-pi-banner.ts does not exist

  @happy @p0
  Scenario: Extension loads via wrapper enumeration
    Given a skill-pi install with the renamed extension
    When skill-pi starts pi for a project
    Then pi receives an explicit --extension flag pointing at extensions/skill-pi-tui/index.ts
    And no --extension flag references skill-pi-banner.ts

  @happy @p0
  Scenario: Banner renders the full header
    Given a TUI session in a git repo with a small terminal (rows >= 12, columns >= 50)
    When the session starts
    Then the header shows the skill-pi logo, the tagline, and the stats grid (GIT/PATH/MCP/PLUGINS/SKILLS/EXTENSIONS/PI/TOOLS)
    And the banner output matches the working-tree banner at plan time byte-for-byte
    # Baseline note: at HEAD, extensions/skill-pi-banner.ts is a 6-line notify stub;
    # the logo/tagline/stats-grid implementation is uncommitted working-tree work
    # (ADR-0002 era). Task 1's git mv commits that content as part of this change —
    # see adr.md notes for executors.

@task-02
Feature: Card, text, and changes modules ported
  As a skill-pi maintainer
  I want the rendering and git-capture primitives from skill-pi-old2 inside the extension
  So the Status card can be built from tested, reusable parts

  @happy @p0
  Scenario: Card renderer produces a panel
    Given a fake theme with fg and bg color functions
    When renderCard renders a titled card at width 50
    Then the output has a header row, body rows framed with side borders, and a bottom border row
    And every line's visible width is at most 50

  @happy @p0
  Scenario: Changes capture reads git state
    Given a temporary git repo with one modified file (+2/-1) and one untracked file
    When captureChanges resolves for that directory
    Then the result has 2 files, added 2, deleted 1, and a file entry per path with status modified/untracked

  @happy @p1
  Scenario: Changes capture degrades outside a git repo
    Given a temporary directory that is not a git repository
    When captureChanges resolves for that directory
    Then the result is empty (0 files, 0 added, 0 deleted, no notice)

  @happy @p1
  Scenario: ANSI sanitization strips escapes and control chars
    Given a string containing an SGR escape, an OSC sequence, and a tab
    When sanitizeTerminalText processes it
    Then the output contains no escape sequences and no control characters

  @happy @p0
  Scenario: Modules load under native node type-stripping
    Given the ported modules in extensions/skill-pi-tui/src
    When node imports the native loader entry (node extensions/skill-pi-tui/native-tui-loader.mjs)
    Then the process exits 0 and prints ok

@task-03
Feature: Sidebar rail with live Status card
  As a skill-pi operator
  I want a right-side sidebar showing live session and repo state in wide fullscreen terminals
  So I can see branch, session, and uncommitted changes without leaving the prompt

  @happy @p0
  Scenario: Rail renders the Status card in wide fullscreen
    Given a fullscreen TUI with 200 columns in a git repo on branch main with 3 changed files
    When the sidebar is installed and the layout renders
    Then a right-side rail of 50 columns appears with a 3-column gap after the main column
    And the rail contains a Status card with a Project group (home-shortened path, branch main) and a Changes group (3 files with +added and -deleted counts)

  @happy @p0
  Scenario: Changes refresh every 2 seconds
    Given an active session with the sidebar installed
    When a file in the project is modified and 2 seconds pass
    Then the next render shows the updated change counts
    And the refresh timer is unref'd so it never keeps the process alive

  @happy @p1
  Scenario: Narrow terminal falls back to native layout
    Given a fullscreen TUI with 100 columns
    When the sidebar is installed and the layout renders
    Then no rail appears and the layout node is pi's native layout

  @happy @p1
  Scenario: Regular mode falls back to native layout
    Given a non-fullscreen (regular mode) TUI with 200 columns
    When the sidebar is installed and the layout renders
    Then no rail appears and the layout node is pi's native layout

  @happy @p0
  Scenario: Layout patch is restored on session shutdown
    Given an active session with the sidebar installed
    When session_shutdown fires
    Then the layout root's layout-node function is pi's original
    And the re-attach timer is cleared and the footer component is disposed

  @happy @p1
  Scenario: Non-git session shows a notice instead of counts
    Given a fullscreen TUI with 200 columns in a directory that is not a git repo
    When the sidebar renders
    Then the Changes group shows the no-git notice line

@task-04
Feature: skill-pi-tui wired end to end
  As a skill-pi operator
  I want the banner and sidebar to come from one bundled extension with no configuration
  So every TUI session gets the full surface automatically

  @happy @p0
  Scenario: Wrapper discovers the new entry point
    Given a fresh skill-pi install after the change
    When skill-pi starts pi
    Then the explicit --extension flag points at extensions/skill-pi-tui/index.ts
    And pi's --no-extensions flag is still present

  @happy @p0
  Scenario: Full session surface in a wide terminal
    Given a TUI session in fullscreen at 200 columns in a git repo
    When the session is running
    Then the header shows the banner (logo, tagline, stats grid)
    And the right rail shows the Status card with live change counts
    And pi's default footer is untouched (no custom bottom bar)

  @happy @p1
  Scenario: Print mode is unaffected
    Given skill-pi run with --print in a project
    When pi runs to completion
    Then no sidebar, header chrome, or TUI state is installed
    And the wrapper exits with pi's exit code
