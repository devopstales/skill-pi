# Acceptance: Plan/Build extension with sidebar plan card

Feature: Plan/Build lifecycle with sidebar plan card

  Background:
    Given the skill-pi TUI sidebar is active in fullscreen
    And the plan-build extension is loaded

  Scenario: Build mode is the default
    When a session starts with no plan
    Then the mode is Build
    And no plan card is shown in the sidebar

  Scenario: Switch to Plan mode
    When the user runs /plan
    Then the mode is Plan
    And the mode rail shows Plan

  Scenario: Create a plan in Plan mode
    Given the mode is Plan
    When the agent calls plan_task new with a title and scope
    Then a plan file is created under the agent dir plans directory
    And the plan card is shown in the sidebar rail with the plan title

  Scenario: Plan card shows step progress during execution
    Given an open plan
    When step-by-step execution is active
    Then the plan card shows step rows with status glyphs
    And completed steps are dimmed

  Scenario: Approve a plan and implement here
    Given an open plan
    When the agent calls plan_exit with implement-here
    Then the mode switches to Build
    And the plan remains open

  Scenario: Complete the plan
    Given an open plan in Build mode
    When the agent calls plan_complete
    Then the plan status is completed
    And the plan card no longer shows it as open

  Scenario: Abandon the plan preserves the file
    Given an open plan
    When the user runs /plan abandon and confirms
    Then the plan status is abandoned
    And the plan file still exists

  Scenario: Card degrades gracefully in a narrow terminal
    Given an open plan
    When the terminal is below the sidebar breakpoint
    Then the plan card is absent
    And the mode status line is still shown
