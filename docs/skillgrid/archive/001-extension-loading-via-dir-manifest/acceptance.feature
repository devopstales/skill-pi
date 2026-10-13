# Source: docs/skillgrid/changes/001-extension-loading-via-dir-manifest/change.md
# Template: .agents/skills/_shared/templates/template-acceptance.feature
# Trace: change.md ## Goal + ## Definition of Done; tasks.md @step-NN verify lines.
# Mapping: @p0 scenarios ↔ change.md DoD / Testing strategy; @p1 = important failure paths.
# One Feature per step; tag each Feature with @step-NN matching tasks.md.

@step-01
Feature: Bundled extensions load from the dir-level pi manifest
  As a skill-pi operator
  I want bundled extensions to load exactly as declared in extensions/package.json
  So that the loaded extension set is explicit and matches omegon-pi's mechanism

  @happy @p0
  Scenario: manifest resolves to exactly the listed extension files
    Given a skill-pi install with extensions/package.json declaring pi.extensions: ["./skill-pi-banner.ts"]
    When pi's resolveExtensionEntries runs on the <pkg>/extensions dir (via --extension)
    Then it resolves to exactly extensions/skill-pi-banner.ts
    And no other bundled extension files are discovered

  @edge
  Scenario: manifest missing falls back to auto-discovery
    Given a skill-pi install with extensions/package.json deleted
    When pi resolves the <pkg>/extensions dir
    Then pi falls back to index.ts / index.js / auto-discovery of *.ts files
    And the prior (pre-change) load set is restored

  @failure @p1
  Scenario: manifest lists a non-existent extension file
    Given a manifest entry "./does-not-exist.ts" that is not on disk
    When pi resolves the manifest
    Then the missing entry is skipped (warn+continue)
    And the remaining valid entries still load

@step-02
Feature: README documents the manifest contract
  As a skill-pi maintainer
  I want the README to explain how bundled extensions are declared and added
  So that adding an extension never relies on tribal knowledge

  @happy @p0
  Scenario: adding a bundled extension is documented
    Given a maintainer reading the README "Adding your own extensions"
    When they add extensions/foo.ts
    Then the README instructs them to list it in pi.extensions in extensions/package.json
    And on the next launch the extension loads

  @edge
  Scenario: user extensions need no manifest
    Given a user dropping foo.ts into ~/.skill-pi/agent/extensions/
    When skill-pi launches
    Then the user extension loads via auto-discovery
    And no manifest entry is required

  @failure @p1
  Scenario: forgotten manifest entry
    Given a maintainer adds extensions/foo.ts but forgets the manifest entry
    When skill-pi launches
    Then foo.ts does not load (explicit list is the contract)
    And the "Bundled extensions always load" section states this behavior

# Rules:
# - ≥1 @happy + @edge + @failure per step
# - Every change.md per-step WHAT bullet → a Scenario
# - Every applicable threat-matrix row → a Scenario in its owning @step-NN
# - Scenario names unique and referenceable from tasks.md `Run:` / Expected lines
# - @p0 must cover change.md Definition of Done user-visible criteria
