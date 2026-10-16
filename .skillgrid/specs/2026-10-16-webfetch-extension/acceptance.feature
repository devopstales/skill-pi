Feature: webfetch — bundled URL retrieval with trafilatura extraction

  Scenario: R-tool-contract — the webfetch tool registers with the expected contract
    Given the webfetch extension factory
    When it is invoked with a mock Extension API and SKILL_PI_WEBFETCH unset
    Then a tool named "webfetch" is registered
    And the tool parameters declare url, format, and timeout
    And format defaults to markdown

  Scenario: R-trafilatura-extraction — an HTML URL returns trafilatura-extracted markdown
    Given a live HTML URL served with content-type text/html
    When webfetch is called with format markdown
    Then the content is markdown extracted by trafilatura
    And details report extracted true with the detected runner label

  Scenario: R-plaintext-passthrough — a non-HTML response passes through unchanged
    Given a live URL served with content-type text/plain
    When webfetch is called with format markdown
    Then the content is the decoded body without extraction
    And details report extracted false

  Scenario: R-html-format — format html returns the raw document
    Given a live HTML URL
    When webfetch is called with format html
    Then the content is the raw HTML without extraction

  Scenario: R-github-redirect — a GitHub URL short-circuits to gh CLI suggestions
    Given a github.com issue URL
    When webfetch is called on it
    Then the result mentions the gh issue view command
    And no HTTP fetch is performed

  Scenario: R-eventbus-handler — an event-bus-registered handler wins over built-ins
    Given a handler registered via the webfetch:register event for a test domain
    When webfetch is called on that domain
    Then the event-bus handler's short-circuit result is returned

  Scenario: R-disable-env — SKILL_PI_WEBFETCH=0 disables the extension
    Given SKILL_PI_WEBFETCH set to 0
    When the extension factory is invoked
    Then no tool is registered
    And no event is subscribed

  Scenario: R-output-cap — oversized text is capped with a truncation notice
    Given a text longer than the 50KB output cap
    When it passes through the output capping
    Then the result is truncated at a line boundary
    And a truncation notice is appended

  Scenario: R-loader — the wrapper auto-discovers the extension
    Given the skill-pi package tree
    When the wrapper enumerates bundled extension entry points
    Then extensions/webfetch/index.ts is included in the list
