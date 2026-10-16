Feature: pi-hooks vendored extension

  Scenario: R-E2E-hook-fires — a SessionStart hook command runs through the wrapper
    Given a scratch project with .skill-pi/settings.json declaring a SessionStart hook
    When the wrapper launches pi in that project (--print "ok")
    Then the hook command's marker file exists and is non-empty

  Scenario: R-config-load — settings load from the isolated agent dir and .skill-pi
    Given getAgentDir() resolves to a temp agent dir
    When loadSettings(cwd) runs with a .skill-pi/settings.json in cwd
    Then the project hooks are returned and the source path is the .skill-pi file
    And a .pi/settings.json in the same cwd is ignored

  Scenario: R-matcher — matcher regex semantics match Claude Code
    Given a matcher of undefined or "" or "*"
    When matcherMatches is called with any value
    Then it returns true
    And an invalid regex falls back to exact string match

  Scenario: R-if-condition — if conditions gate tool hooks
    Given a PreToolUse context for tool bash with command "git push origin"
    When hookIfMatches is called with "Bash(git push*)"
    Then it returns true
    And for command "git status" it returns false

  Scenario: R-hook-input — hook input is Claude Code-shaped
    Given a HookExecutionContext for each supported event
    When buildHookInput is called
    Then the output has the event-specific fields documented in the README
