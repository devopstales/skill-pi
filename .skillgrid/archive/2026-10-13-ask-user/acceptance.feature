# Source: .skillgrid/specs/2026-10-13-ask-user/change.md
# Template: .agents/skills/_shared/templates/template-acceptance.feature
# Trace: change.md ## Goal + ## Definition of Done; tasks.md @step-NN verify lines.
# Mapping: @p0 scenarios ↔ change.md DoD / Testing strategy; @p1 = important failure paths.
# One Feature per step; tag each Feature with @step-NN matching tasks.md.

@step-01
Feature: ask_user tool contract — schema, validation, result details, renders, events
  As a skill-pi operator
  I want the agent's ask_user calls to be validated and to return structured, reconstructible answers
  So that I never see the agent guess a decision and the transcript shows exactly what was asked and answered

  @happy @p0
  Scenario: Single question selection returns structured details
    Given a valid single question with three options is submitted in RPC mode
    When the user selects the second option in the dialog
    Then the result details contain the question, all option labels, answer kind selection with that option's label, and cancelled false

  @happy @p0
  Scenario: Single question freeform returns structured details
    Given a valid single question with freeform enabled is submitted in RPC mode
    When the user chooses the freeform path and types a custom answer
    Then the result details contain answer kind freeform with the typed text and cancelled false

  @happy @p0
  Scenario: Batch of two returns index-aligned answers
    Given a valid batch of two independent questions is submitted in RPC mode
    When the user answers both questions
    Then the result details are a batch with a question entry per question and index-aligned answers in the asked order

  @edge
  Scenario: Multi-select commits the explicit selection on Done
    Given a valid multi-select question with four options is submitted in RPC mode
    When the user toggles the first and third options on and confirms Done
    Then the result details contain answer kind selection with exactly those two labels and no others

  @edge
  Scenario: Multi-select round cap without Done cancels without partial commit
    Given a valid multi-select question with four options is submitted in RPC mode
    When the user toggles options back and forth until the safety cap is reached without confirming Done
    Then the result details are cancelled with no answer and no partial selection is committed

  @edge
  Scenario: Render call summarizes question and options
    Given a tool call for ask_user is displayed in the transcript
    When the call is rendered
    Then the rendered call shows the question and the option labels, truncated to at most 120 characters for a batch

  @edge
  Scenario: Prompt guidelines steer the model to focused questions
    Given the ask_user tool is active in a session
    When its prompt guidelines are included in the system prompt
    Then they instruct the model to ask one focused question per call with two to five mutually exclusive options

  @failure @p1
  Scenario: Validation rejects conflicting or missing question parameters
    Given a call that provides both a single question and a questions batch (or neither)
    When the tool executes
    Then the result is an error naming the fix and no prompt is shown

  @failure @p1
  Scenario: Validation rejects out-of-bounds option counts
    Given a call with a question that has one option (or six options)
    When the tool executes
    Then the result is an error naming the expected two to five option range

  @failure @p1
  Scenario: Validation rejects oversized batches
    Given a call with five questions in the batch
    When the tool executes
    Then the result is an error naming the expected two to four question limit

  @failure @p1
  Scenario: Dialog cancellation returns cancelled with no answer
    Given a valid single question is submitted in RPC mode
    When the user cancels the dialog
    Then the result details are cancelled true with answer null and the model is told the user declined

  @failure @p1
  Scenario: Cancelling any batch question cancels the whole batch
    Given a valid batch of two questions is submitted in RPC mode
    When the user cancels the second question's dialog
    Then the batch result details are cancelled true with no answers committed

  @failure @p1
  Scenario: Non-dialog mode returns a graceful unavailable result
    Given a call in a mode without dialog-capable UI
    When the tool executes
    Then the result is a clear unavailable message with cancelled true and the call neither hangs nor throws

  @failure @p1
  Scenario: Answer outcome emits the answered event once
    Given a valid single question is submitted
    When the user provides any answer
    Then the answered event fires exactly once with the question and response kind

  @failure @p1
  Scenario: Cancellation emits the cancelled event once
    Given a valid single question is submitted
    When the user cancels the prompt
    Then the cancelled event fires exactly once with the question

@step-02
Feature: ask_user TUI popup — single-select, multi-select, freeform, batch review
  As a skill-pi operator in the terminal
  I want an interactive popup that lets me navigate, select, type, or cancel
  So that answering a decision takes seconds of keyboard input and the transcript records my exact choice

  @happy @p0
  Scenario: TUI single-select popup confirms a focused option
    Given a valid single question is submitted in TUI mode
    When I navigate to the second option and press Enter
    Then the agent receives the selection result for that option and the result row shows a success marker with the option

  @happy @p0
  Scenario: TUI popup number keys jump to an option
    Given a valid single question with three options is submitted in TUI mode
    When I press the number three key
    Then the third option is confirmed immediately

  @happy @p0
  Scenario: TUI freeform editor submits non-empty text
    Given a valid single question with freeform enabled is submitted in TUI mode
    When I open the freeform row, type a response, and press Enter
    Then the agent receives answer kind freeform with my text

  @happy @p0
  Scenario: TUI multi-select commits the selected set on Done
    Given a valid multi-select question is submitted in TUI mode
    When I toggle two options on and confirm Done
    Then the agent receives answer kind selection with exactly those two labels

  @happy @p0
  Scenario: TUI batch switches pages without losing answers
    Given a valid batch of two questions is submitted in TUI mode
    When I answer the first question and switch to the second question with the page keys
    Then the first answer is retained and the second question renders fresh

  @happy @p0
  Scenario: TUI review page warns then submits with skips
    Given a valid batch of two questions is submitted in TUI mode and only the first is answered
    When I reach the review page and confirm submission
    Then the first confirm warns that a question is unanswered and the second confirm submits with the unanswered question recorded as skipped

  @edge
  Scenario: TUI freeform Esc returns to options without answering
    Given a valid single question with freeform enabled is submitted in TUI mode
    When I open the freeform row and press Esc
    Then the options are shown again and no answer has been committed

  @edge
  Scenario: TUI multi-select toggling is reversible before Done
    Given a valid multi-select question is submitted in TUI mode
    When I toggle an option on, then off, then on a different option before confirming
    Then only the final toggled-on set is committed on Done

  @edge
  Scenario: Render result shows success or cancelled rows
    Given an ask_user call has resolved
    When its result is rendered in the transcript
    Then answered calls show a success row with the chosen option or custom text and cancelled calls show a warning row

  @failure @p1
  Scenario: TUI Esc cancels the prompt with cancelled details
    Given a valid single question is submitted in TUI mode
    When I press Esc on the options
    Then the result details are cancelled true with answer null

  @failure @p1
  Scenario: Aborting the agent dismisses the open prompt
    Given a valid single question popup is open in TUI mode
    When the agent is interrupted while the prompt is open
    Then the prompt is dismissed and the result details are cancelled true

@step-03
Feature: ask_user E2E — real PTY, real local model, scripted keys
  As a skill-pi maintainer
  I want the test suite to drive a real skill-pi session in a PTY against a local model
  So that the shipped popup is proven end-to-end and the suite stays green without a local model

  @happy @p0
  Scenario: E2E selection renders the success result row
    Given a real skill-pi session is running in a PTY against a local model
    When the model calls ask_user, I wait for the popup, and I select the second option with PTY keys
    Then the TUI output contains the success result row naming that option

  @happy @p0
  Scenario: E2E freeform renders the custom answer row
    Given a real skill-pi session is running in a PTY against a local model
    When the model calls ask_user, I open the freeform row, type an answer, and submit
    Then the TUI output contains the result row with my custom text

  @happy @p0
  Scenario: E2E Esc renders the cancelled row
    Given a real skill-pi session is running in a PTY against a local model
    When the model calls ask_user and I press Esc on the popup
    Then the TUI output contains the cancelled result row

  @edge
  Scenario: E2E batch review submits index-aligned answers
    Given a real skill-pi session is running in a PTY against a local model
    When the model calls ask_user with a two-question batch, I switch to the review page, and submit
    Then the TUI output renders both questions' answers in the asked order
    # Best-effort: if the small model does not emit a batch call within the timeout, the scenario skips with a reason rather than failing.

  @edge
  Scenario: E2E skips cleanly when Ollama is unreachable
    Given the local Ollama endpoint is not listening
    When the E2E suite runs
    Then every E2E scenario skips with a reason and the suite does not fail or hang
    # Also holds when node-pty fails to load.

  @failure @p1
  Scenario: E2E harness cleans up the child process and temp agent dir
    Given the E2E harness spawns a child session with a temp agent dir
    When the child hangs or exits early
    Then the harness kills the child and removes the temp agent dir leaving no lingering process or leftover directory
