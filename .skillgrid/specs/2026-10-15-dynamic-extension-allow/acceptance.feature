Feature: Dynamic extension tool allow
  Tools registered by local pi extensions are allowed by default by the
  permission gate, without per-tool rules. Explicit conf.d rules still win.

  Scenario: R1 an extension-registered tool resolves to allow with no rules
    Given a permission session with no conf.d rules
    When the tool "todo" is called and "todo" is registered by a local extension
    Then the resolved mode is "allow"
    G1: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "extension-registered tool resolves to allow"
         EXPECT: 1 passed

  Scenario: R2 builtin tools keep their existing resolution
    Given a permission session with no conf.d rules
    When the tool "bash" is called and "bash" is a builtin tool
    Then the resolved mode is "ask"
    G2: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "builtin tool keeps its existing resolution"
         EXPECT: 1 passed

  Scenario: R3 a deny rule beats the extension auto-allow
    Given conf.d deny rule ["todo"]
    When the tool "todo" is called and "todo" is registered by a local extension
    Then the resolved mode is "deny"
    G3: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "deny rule beats the extension auto-allow"
         EXPECT: 1 passed

  Scenario: R4 an ask rule beats the extension auto-allow
    Given conf.d ask rule ["todo"]
    When the tool "todo" is called and "todo" is registered by a local extension
    Then the resolved mode is "ask"
    G4: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "ask rule beats the extension auto-allow"
         EXPECT: 1 passed

  Scenario: R5 a newly registered extension tool is picked up dynamically
    Given no conf.d rules
    When a second extension tool "notebook" is registered after "todo"
    Then the resolved mode for "notebook" is "allow"
    G5: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "a newly registered extension tool is picked up"
         EXPECT: 1 passed

  Scenario: R6 namespaced (MCP) tools are not auto-allowed
    Given no conf.d rules
    When the tool "docs.search" has a namespace (MCP tool)
    Then the resolved mode is "ask"
    G6: CHECK: cd extensions/permission && npx vitest run extension-allow.spec.ts -t "namespaced (MCP) tool is not auto-allowed"
         EXPECT: 1 passed
