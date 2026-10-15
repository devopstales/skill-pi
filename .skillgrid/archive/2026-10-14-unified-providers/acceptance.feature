# Unified providers extension

One bundled extension registers the union of the three upstream provider
plugins: the pi-free base (26 free/paid providers + filter, telemetry,
fallback, quota, diagnostics), the opencode-zen OAuth provider, and the
antigravity OAuth multi-account provider. All state stays in the isolated
agent dir (per ADR 0002); the stock `~/.pi` install is never touched.

## Capability: base loading

### Requirement: The extension entry loads the pi-free base

The composition entry SHALL load the vendored pi-free base unchanged and
register its providers and commands into the same pi runtime it receives.

#### Scenario: happy path unified-extension-loads-base

The unified providers extension entry SHALL load the pi-free base without
import errors and register its providers and diagnostic commands.

```gherkin
Given the unified providers extension entry is loaded against a stub pi runtime
When the entry runs
Then the pi-free base loads without an import error
And at least 20 providers are registered
And the commands "toggle-free" and "pi-free-health" are registered
```

#### Scenario: edge base-setup-failure-degrades-not-kills

A failure inside one pi-free provider setup SHALL NOT abort the rest of the
base loading, and the entry SHALL still return.

```gherkin
Given the pi-free base is stubbed to reject one provider setup
When the unified providers extension entry runs
Then the entry returns without throwing
And the remaining provider setups still run
```

#### Scenario: failure base-missing-dep-fails-loudly

If a runtime dependency of the vendored base is not declared and hoisted,
the load SHALL fail with a module-resolution error, not a silent no-op.

```gherkin
Given a required pi-free runtime dependency is absent from node_modules
When the base is imported
Then the import fails with a module-not-found error naming the missing dependency
```

### Requirement: The base runs in a real skill-pi session

A real `skill-pi` launch SHALL load the base in-process: pi-free's startup
summary SHALL be logged and the process SHALL exit cleanly.

#### Scenario: happy path base-runs-in-real-session

A real `skill-pi --print` session SHALL log pi-free's startup summary with a
populated provider registry and exit 0.

```gherkin
Given a throwaway agent dir
When skill-pi runs a print request
Then the process exits with code 0
And the startup log contains the pi-free startup summary marker
And no module-not-found error appears in the log
```

#### Scenario: failure base-real-session-provider-setup-rejected

A pi-free provider whose setup is rejected in the real session SHALL be
reported in the startup log as a finding, not swallowed silently.

```gherkin
Given a real skill-pi print session
When a pi-free provider setup is rejected
Then the startup log names the rejected provider and the reason
```

## Capability: oauth providers

### Requirement: The opencode-zen provider registers

The `opencode-zen` OAuth provider (device flow) SHALL be registered as its
own provider with its free-tier handlers.

#### Scenario: happy path zen-provider-registers

The composition entry SHALL register the `opencode-zen` provider and its
free-tier event handlers.

```gherkin
Given the unified providers extension entry is loaded against a stub pi runtime
When the entry runs
Then a provider with id "opencode-zen" is registered
And the handlers "before_agent_start" and "message_end" are subscribed
```

#### Scenario: failure zen-provider-not-registered-when-disabled

When the enable seam disables `opencode-zen`, NO zen registration SHALL
occur.

```gherkin
Given the provider "opencode-zen" is disabled via the seam
When the unified providers extension entry runs
Then no provider with id "opencode-zen" is registered
And no zen free-tier handlers are subscribed
```

### Requirement: The antigravity provider registers

The `antigravity` OAuth multi-account provider SHALL be registered with its
commands and session handlers.

#### Scenario: happy path antigravity-provider-registers

The composition entry SHALL register the `antigravity` provider, its
`/antigravity*` commands, and its session handlers.

```gherkin
Given the unified providers extension entry is loaded against a stub pi runtime
When the entry runs
Then the antigravity provider is registered
And the commands "antigravity", "antigravity.usage", "antigravity.models", "antigravity.doctor" are registered
And the handlers "session_start" and "session_shutdown" are subscribed
```

#### Scenario: failure antigravity-provider-not-registered-when-disabled

When the enable seam disables `antigravity`, NO antigravity registration
SHALL occur.

```gherkin
Given the provider "antigravity" is disabled via the seam
When the unified providers extension entry runs
Then the antigravity provider is not registered
And no antigravity command is registered
```

### Requirement: The per-provider enable seam gates registration

The seam (env `SKILL_PI_DISABLE_PROVIDERS`, comma-separated ids) SHALL be the
single decision point for each OAuth provider; the pi-free base SHALL always
be on.

#### Scenario: happy path provider-toggle-disables-registration

Each listed provider id SHALL be omitted from registration; unlisted
providers SHALL register normally.

```gherkin
Given the seam disables only "antigravity"
When the unified providers extension entry runs
Then the "opencode-zen" provider is registered
And the "antigravity" provider is not registered
And the pi-free base providers are registered
```

#### Scenario: edge provider-toggle-disables-both

Disabling both OAuth providers SHALL leave only the pi-free base registered.

```gherkin
Given the seam disables "opencode-zen" and "antigravity"
When the unified providers extension entry runs
Then the pi-free base providers are registered
And neither OAuth provider is registered
```

### Requirement: OAuth providers survive the pi-free free filter

After the pi-free base applies its global free-only re-registration, the
OAuth providers SHALL remain registered with their own `filterModels`, not
pi-free's.

#### Scenario: happy path oauth-providers-survive-free-filter

After the full entry runs, the final provider registry SHALL contain
`opencode-zen` and `antigravity` unfiltered by pi-free.

```gherkin
Given the full unified providers entry has run against a capturing registry
When the pi-free global filter pass completes
Then the registry still contains provider ids "opencode-zen" and "antigravity"
And their filter behavior is the upstream one, not pi-free's
```

#### Scenario: failure oauth-provider-wiped-by-filter

If a free-filter pass removes an OAuth provider, the entry SHALL re-register
it after the pass so the final registry is complete.

```gherkin
Given the pi-free filter pass removes "opencode-zen"
When the entry completes
Then the final registry contains "opencode-zen"
```

## Capability: state confinement

### Requirement: All extension state stays in the agent dir

Every state write (auth tokens, telemetry, Antigravity account store) SHALL
resolve under `PI_CODING_AGENT_DIR`; NO write SHALL land in `~/.pi` or
`<repo>/.pi` (per ADR 0002).

#### Scenario: happy path state-confined-to-agent-dir

Running the extension under a temp agent dir SHALL produce state files only
under that dir.

```gherkin
Given PI_CODING_AGENT_DIR points to a temp dir
When the extension triggers its state write paths
Then the state files appear under the temp agent dir
And no file appears under ~/.pi
```

#### Scenario: failure hardcoded-home-write-detected

A vendored write that targets a literal `~/.pi/agent` path SHALL be detected
by the confinement test and fail it until fixed.

```gherkin
Given a vendored state write targets the literal path ~/.pi/agent
When the confinement check runs under a temp agent dir
Then the check reports a write outside the agent dir
```

## Capability: end to end

### Requirement: A real session serves free models and exposes the OAuth logins

A real `skill-pi` session SHALL stream a response through a pi-free provider
and SHALL expose the OAuth login commands for both added providers.

#### Scenario: happy path e2e-free-model-requests

A print request through a logged-in pi-free provider SHALL return a
streamed assistant message.

```gherkin
Given a real skill-pi session with a logged-in free provider
When a print request is made
Then the process exits with code 0
And the assistant message contains the expected reply text
```

#### Scenario: happy path e2e-oauth-commands-present

A real session SHALL expose the login and usage commands of both OAuth
providers.

```gherkin
Given a real skill-pi session
When the session's command list is inspected
Then the commands "/login opencode-zen" and "/login antigravity" are present
And the antigravity usage and doctor commands are present
```

#### Scenario: failure e2e-skip-guard-honored

When the e2e gate env is not set, the e2e test SHALL skip rather than fail
in headless CI.

```gherkin
Given SKILL_PI_E2E is not "1"
When the e2e test suite runs
Then the e2e scenarios are skipped
```

## Capability: documentation

### Requirement: Provenance and the seam contract are documented

The extension README SHALL carry a provenance table (upstream name@version +
license + any ADR 0002 edits) and the `SKILL_PI_DISABLE_PROVIDERS` contract.

#### Scenario: happy path docs-and-provenance-present

`extensions/providers/README.md` SHALL list all three upstreams with version
and license, and document the seam.

```gherkin
Given the extension README exists
When it is read
Then it names "pi-free" at its pinned version with its license
And it names "opencode-zen-oauth" and "pi-agy" at their pinned versions with their licenses
And it documents the SKILL_PI_DISABLE_PROVIDERS contract and the ids it gates
```

#### Scenario: failure full-suite-green

The full root test suite SHALL pass with the new provider tests wired in.

```gherkin
Given the new provider test files exist
When node --test "test/**/*.test.js" runs
Then all tests pass (e2e skipped unless SKILL_PI_E2E=1)
```
