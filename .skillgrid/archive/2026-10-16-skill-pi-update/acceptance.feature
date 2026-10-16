Feature: skill-pi update — wrapper-owned update for wrapper + bundled pi

  Scenario: R-update-runs-npm-steps — update runs the wrapper's install steps
    Given a skill-pi checkout at package root
    When skill-pi update is run
    Then npm install runs in the package root
    And npm link --force runs in the package root after npm install
    And no pi process is spawned

  Scenario: R-update-reports-transition — the reported versions are the real ones
    Given skill-pi with pi 1.2.0 installed
    When skill-pi update completes and npm install bumped pi to 1.3.0
    Then stdout contains "Updated pi from 1.2.0 to 1.3.0"
    And stdout contains "https://pi.dev/changelog"

  Scenario: R-update-fails-on-npm-error — a failing npm step fails the command
    Given a skill-pi checkout where npm install exits 1
    When skill-pi update is run
    Then the process exits non-zero
    And stderr contains "skill-pi: update failed"

  Scenario: R-update-intercepted — update never reaches pi
    Given a skill-pi checkout
    When skill-pi update is run
    Then the argument "update" is not forwarded into pi's passthrough args
    And stock pi (~/.pi/agent) is never read or written

  Scenario: R-update-help — the subcommand is documented
    When skill-pi --help is run
    Then the usage text documents "skill-pi update"
