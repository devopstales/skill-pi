Feature: pi-swarm — parallel isolated child agents with fleet UI

  Scenario: R-core-spawn-wait — a child is spawned, settles, and its result is delivered
    Given a pi-swarm session with a working child harness
    When swarm_spawn is called with a self-contained prompt and background true
    Then it returns an agent id immediately and the child runs as an isolated skill-pi rpc subprocess
    And when the child settles its final text is delivered to the parent as a swarm-result message that triggers a follow-up turn
    And swarm_wait on the id resolves once and the result is not delivered twice

  Scenario: R-child-cap — the concurrency cap is enforced
    Given MAX_RUNNING running children
    When another swarm_spawn is called
    Then it is queued, not rejected, and starts when a running child settles

  Scenario: R-send-steers — swarm_send steers a running child
    Given a running child
    When swarm_send is called with new instructions
    Then an RPC steer is written to the child stdin and the child's next behavior reflects it
    And swarm_send on a settled child queues a follow_up that starts a new run

  Scenario: R-cancel-aborts — swarm_cancel stops a child cleanly
    Given a running child
    When swarm_cancel is called
    Then an RPC abort is sent and the child settles with an interrupted status within the bounded timeout
    And a forced kill happens if the child does not exit in time

  Scenario: R-check-and-list — non-consuming inspection
    Given one running and one settled child
    When swarm_check is called on each
    Then status, turns, and a bounded output preview are returned without consuming the result
    And swarm_list returns one describe line per tracked child

  Scenario: R-fleetview-visible — the fleet list renders below the prompt
    Given at least one running child
    When the FleetView is rendered
    Then it shows a main row and one row per child with status glyph, title, model, tokens, and elapsed
    And pressing down arrow at an empty prompt moves focus into the list and up arrow or esc returns

  Scenario: R-fleetview-open-transcript — a child transcript is inspectable live
    Given a running child in the FleetView
    When it is selected and opened
    Then its live transcript renders from the event stream and new events appear without restarting the view

  Scenario: R-fleetview-stop — a child can be stopped from the FleetView
    Given a running child selected in the FleetView
    When x is pressed
    Then the child is aborted and its row shows the stopped status

  Scenario: R-agent-types-discovered — agent types are discovered from the isolated paths
    Given a project .skill-pi/agents/auditor.md and a global agent file with the same name
    When agent types are listed
    Then the project file wins for that name and both directories are otherwise merged

  Scenario: R-target-default-build — the prompt target defaults to build
    Given a fresh session with or without agent types and plan-build installed or not
    When the target selector is read
    Then it shows build with no agent config applied to the main session

  Scenario: R-target-cycle — shift+tab cycles targets
    Given the cycle build, plan (when plan-build present), then agent types in load order
    When shift+tab is pressed repeatedly
    Then the visible target cycles through the cycle and returns to build
    And the cycle never contains a target whose source does not resolve

  Scenario: R-target-spawns — an agent target spawns a child instead of prompting main
    Given the target is set to an existing agent type
    When a prompt is submitted
    Then a swarm child of that agent type is spawned with the prompt and the text does not enter the main conversation
    And the parent shows a spawn confirmation

  Scenario: R-rpc-protocol — other extensions can drive the swarm
    Given another extension on the same pi.events bus
    When it emits swarm:rpc:spawn with a valid envelope
    Then a child is spawned and the reply envelope returns the agent id
    And swarm:rpc:ping returns the protocol version and counts
    And swarm:created, swarm:completed, and swarm:usage events are emitted on the bus

  Scenario: R-rpc-version — an unsupported protocol version is rejected
    Given another extension emitting a swarm:rpc request with an unsupported v
    When the request is handled
    Then the reply envelope carries a version error and no side effect occurs
