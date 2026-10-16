# skill-pi update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skillgrid:subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2

**Build shape:** Tracer thread (the thin end-to-end path — `skill-pi update` on the real CLI — works first, then thickens with failure paths and docs)

**Goal:** Make the in-TUI "Update Available — Run `skill-pi update`" banner truthful: the wrapper intercepts `update`, refreshes its own dependency tree, and re-links the global `skill-pi` binary.

**Architecture:** The wrapper (`bin/skill-pi.js`) checks for a bare `update` argument before building pi's passthrough args and, when present, delegates to a new `lib/update.js` module that runs `npm install` then `npm link --force` in the skill-pi package root (same step order as `task install`), then reports the real skill-pi + pi version transition. Everything else is forwarded to pi exactly as today; pi's source is untouched (ADR-0006) and its version-check banner is left as the passive heads-up.

**Tech Stack:** Node.js >= 22.19.0, ESM, `node:child_process` spawnSync, node:test

**Spec:** `.skillgrid/specs/2026-10-16-skill-pi-update/briefing.md`

## Terms

None beyond the spec's (no new terms; "the wrapper", "the overlay", "agent dir" are already canonical — see `.skillgrid/artifacts/01-business-terms.md` / `02-technical-terms.md`).

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- Running `skill-pi update` runs `npm install` then `npm link --force` with cwd = skill-pi package root, and the word `update` is NOT forwarded into pi's passthrough args.
- On npm success, stdout ends with a line matching `Updated pi from <semver> to <semver>` and contains `https://pi.dev/changelog`.
- On `npm install` or `npm link --force` non-zero exit, the process exits non-zero and stderr contains `skill-pi: update failed`.
- Pi's in-TUI "Update Available" banner behavior is unchanged (the wrapper sets no `PI_SKIP_VERSION_CHECK` / `PI_OFFLINE`). `backstop` — verified by running the real TUI after update (held-out check: launch `skill-pi` interactively against a throwaway `--agent-dir`, confirm the banner still renders when pi.dev reports a newer version, or that the version-check fetch still fires).
- `skill-pi --help` output contains an `update` line describing the subcommand.
- All other invocations (launch, `--import-auth`, `--version`, passthrough args) are byte-identical in behavior to before the change.

**Artifacts** (files that must exist with real implementation, not stubs):
- `lib/update.js` — `runUpdate()` (npm install + npm link --force + version report) and `readVersions()`.
- `bin/skill-pi.js` — modified `parseArgs`/`main` to intercept `update` and call `runUpdate()`.
- `test/update.test.js` — node:test suite covering the truths above.
- `README.md` — updated usage section (documents `skill-pi update`).
- `.skillgrid/specs/2026-10-16-skill-pi-update/acceptance.feature` — scenarios for the truths.

**Key links** (critical connections between artifacts that must work together):
- `bin/skill-pi.js` must consume `update` **before** `collectExtensionFiles`/pi spawn and must return its exit code from `runUpdate()` without falling through to the pi spawn.
- `runUpdate()` must run both npm steps in the same cwd (`pkgRoot`, computed the same way `bin/skill-pi.js` computes it) and must not spawn pi.
- The version report must read the installed pi version from `node_modules/@earendil-works/pi-coding-agent/package.json` **after** the npm steps, so the "to" number shown is the one now on disk. (Unlike `printVersion()`'s dynamic import, the update path reads `package.json` directly — synchronous, no pi runtime loaded.)

**One-way-door decisions:**
- None (additive subcommand; no migration, no public contract break, no pi source coupling).

## Global Constraints

- Node >= 22.19.0, ESM (`"type": "module"`) — per `package.json` `engines`.
- No comments in code unless asked — per ASSUMPTIONS.md § VERIFIED / AGENTS.md.
- Never modify pi source — per `.skillgrid/artifacts/04-adr-0006-never-modify-pi-source.md`.
- Thin wrapper, pi via npm semver — per `.skillgrid/artifacts/` dependency policy (ASSUMPTIONS.md § VERIFIED).
- Taskfile is the canonical automation surface — per `.skillgrid/artifacts/04-adr-0003-taskfile-as-automation-standard.md`; this change adds NO Taskfile task.
- Never read or write `~/.pi/agent` — per ASSUMPTIONS.md § VERIFIED (isolation is the product).
- Conventional commits, no Co-Authored-By — per AGENTS.md.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Subprocess invocation | Applicable: `runUpdate` spawns `npm` (user-supplied PATH, inherited env) | spawnSync with fixed argv arrays (no shell interpolation), fixed cwd = pkgRoot, exit-code propagation, no `shell: true` | `test/update.test.js`: failing-npm case asserts non-zero exit + `skill-pi: update failed` on stderr; success case asserts both steps ran in pkgRoot in order |
| CLI arg routing | Applicable: a new bare `update` arg is consumed before pi passthrough; mis-routing would send it to pi (updates stock pi) or swallow a legitimate positional | explicit early check for first bare positional === `update`; all other arg shapes untouched; existing arg tests re-run unchanged | `test/update.test.js`: `update` is consumed (not in passthrough); `skill-pi /some/path update`-style ambiguity resolved by "first bare positional wins" rule; existing `--import-auth` / `--version` / project-arg tests stay green |
| Version display | Applicable: the reported transition reads from disk after the install | `readVersions()` reads skill-pi `package.json` + the installed pi `package.json` synchronously; the "to" side is read AFTER the npm steps | `test/update.test.js`: report line matches `Updated pi from <old> to <new>` with the "to" value read post-install |

## File Structure

- `lib/update.js` (new) — owns the update: `readVersions()`, `runUpdate()`. No pi imports, no agent-dir imports; depends only on `node:child_process`, `node:fs`, `node:path`, `node:url`.
- `bin/skill-pi.js` (modify) — `parseArgs` gains `update: false`; `main` intercepts it after `--version` handling and before agent-dir/extension setup; `--help` text gains one line.
- `test/update.test.js` (new) — unit tests for `lib/update.js` with injected spawn; routing tests for the arg interception.
- `README.md` (modify) — Usage section: document `skill-pi update`; one line explaining the in-TUI banner is pi's check and this command handles it.
- `.skillgrid/specs/2026-10-16-skill-pi-update/acceptance.feature` (new) — scenarios mirroring the Must-Have truths.

Design notes:

- `pkgRoot` already exists in `bin/skill-pi.js` (`join(dirname(fileURLToPath(import.meta.url)), "..")`). `lib/update.js` computes its own default root from its own `import.meta.url` (`join(dirname(fileURLToPath(import.meta.url)), "..")` — `lib/`'s parent = the package root) and accepts an override for tests.
- Version capture for the "from" side happens **before** `npm install` runs; the "to" side is re-read **after** both steps. This is what makes the transition line honest.
- `runUpdate` takes an optional `spawn` injection (defaults to `spawnSync`) so tests can stub both npm steps without hitting the network.
- `--version` must still take precedence over `update` if both are somehow present (`skill-pi --version update` → version output); this matches the existing "flags before positionals" precedence in `main`.

---

### Task 1: `lib/update.js` — runUpdate + readVersions

**Files:**
- Create: `lib/update.js`
- Test: `test/update.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (leaf module). Node builtins only.
- Produces:
  - `readVersions(pkgRoot?: string): { skillPi: string, pi: string }` — reads `<pkgRoot>/package.json` `version` and `<pkgRoot>/node_modules/@earendil-works/pi-coding-agent/package.json` `version` (synchronous; placeholder `"?"` on read failure, same placeholder convention as `printVersion()` in `bin/skill-pi.js`). `pkgRoot` defaults to the module's own package root.
  - `runUpdate(opts?: { spawn?: typeof spawnSync, pkgRoot?: string }): number` — captures `readVersions(pkgRoot)` (the "from" side), spawns `["npm", "install"]` then `["npm", "link", "--force"]` with `stdio: "inherit"` and cwd = pkgRoot; on any non-zero exit writes `skill-pi: update failed — run \`npm install && npm link --force\` in the skill-pi checkout.` to stderr and returns the child's exit code (or 1); on success re-reads `readVersions(pkgRoot)` (the "to" side) and writes `Updated pi from <piFrom> to <piTo> (skill-pi <skillPi>)\nChangelog: https://pi.dev/changelog\n` to stdout, returns 0.
- Seam: the `spawn` parameter of `runUpdate` — behavior can be altered without editing the npm logic.
- Deletion test: if `lib/update.js` is deleted, the npm step-ordering + version-transition reporting logic reappears inline in `bin/skill-pi.js`, and its tests lose their module under test.
- Adapters: 2 (real `spawnSync` in prod; stub in `test/update.test.js`).

**SATISFIES:** `R-update-runs-npm-steps`, `R-update-reports-transition`, `R-update-fails-on-npm-error`

- [ ] **Step 1: Write the failing test**

```js
// test/update.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runUpdate } from "../lib/update.js";

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "skillpi-update-"));
  mkdirSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "skill-pi-test", version: "0.1.0", type: "module" }));
  writeFileSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.2.0" }));
  return root;
}

function withStreams(fn) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = "", err = "";
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  try {
    const status = fn();
    return { status, stdout: out, stderr: err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test("runUpdate runs npm install then npm link --force in pkgRoot (in order)", () => {
  const root = makeSandbox();
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push([cmd, args.join(" "), opts.cwd]);
    return { status: 0 };
  };
  try {
    const { status } = withStreams(() => runUpdate({ spawn, pkgRoot: root }));
    assert.equal(status, 0);
    assert.deepEqual(calls.map((c) => c[1]), ["install", "link --force"]);
    assert.equal(calls[0][0], "npm");
    assert.equal(calls[1][0], "npm");
    assert.equal(calls[0][2], root);
    assert.equal(calls[1][2], root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runUpdate reports the pi version transition after install", () => {
  const root = makeSandbox();
  const piPkg = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  const spawn = (cmd, args) => {
    if (args[0] === "install") {
      const pkg = JSON.parse(readFileSync(piPkg, "utf8"));
      pkg.version = "1.3.0";
      writeFileSync(piPkg, JSON.stringify(pkg));
    }
    return { status: 0 };
  };
  try {
    const { status, stdout } = withStreams(() => runUpdate({ spawn, pkgRoot: root }));
    assert.equal(status, 0);
    assert.match(stdout, /Updated pi from 1\.2\.0 to 1\.3\.0 \(skill-pi 0\.1\.0\)/);
    assert.match(stdout, /https:\/\/pi\.dev\/changelog/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runUpdate exits non-zero with a hint when npm install fails", () => {
  const root = makeSandbox();
  try {
    const { status, stderr } = withStreams(() => runUpdate({ spawn: () => ({ status: 1 }), pkgRoot: root }));
    assert.equal(status, 1);
    assert.match(stderr, /skill-pi: update failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

NOTE for implementer: `runUpdate` therefore takes `opts = { spawn?, pkgRoot? }` — `pkgRoot` defaults to the module's own package root in prod and is injected by tests (the tests run against a temp sandbox, not the real checkout, so they must not hit the network and must not re-read the real `package.json`). Keep the three asserted behaviors: ordered calls in pkgRoot, honest transition line, failure hint.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/update.test.js`
Expected: FAIL — `Cannot find module '../lib/update.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// lib/update.js
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readVersions(pkgRoot = defaultRoot) {
  let skillPi = "?";
  try {
    skillPi = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
  } catch {
    // keep placeholder
  }
  let pi = "?";
  try {
    pi = JSON.parse(readFileSync(join(pkgRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8")).version;
  } catch {
    // keep placeholder
  }
  return { skillPi, pi };
}

export function runUpdate(opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const pkgRoot = opts.pkgRoot ?? defaultRoot;
  const from = readVersions(pkgRoot);
  for (const args of [["install"], ["link", "--force"]]) {
    const res = spawn("npm", args, { cwd: pkgRoot, stdio: "inherit" });
    const code = res.status ?? 1;
    if (code !== 0) {
      process.stderr.write("skill-pi: update failed — run `npm install && npm link --force` in the skill-pi checkout.\n");
      return code;
    }
  }
  const to = readVersions(pkgRoot);
  process.stdout.write(`Updated pi from ${from.pi} to ${to.pi} (skill-pi ${to.skillPi})\n`);
  process.stdout.write(`Changelog: https://pi.dev/changelog\n`);
  return 0;
}
```

NOTE for implementer: `readVersions` reads the installed pi `package.json` directly (synchronous, no dynamic-import await) so `runUpdate` stays synchronous and the bin file can call it without async plumbing. This differs from `printVersion()`'s dynamic import by design — the update path must not load pi's runtime. `pkgRoot` is injected by tests (temp sandbox); in prod it defaults to the module's own package root.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/update.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/update.js test/update.test.js
git commit -m "feat: add update module (npm install + npm link --force + version report)"
```

---

### Task 2: CLI interception + help text in `bin/skill-pi.js`

**Files:**
- Modify: `bin/skill-pi.js` (`parseArgs` ~lines 74-107, `main` ~lines 169-183, `printHelp` ~lines 139-156)
- Test: `test/update.test.js` (append routing tests)

**Interfaces:**
- Consumes: `runUpdate` from `lib/update.js` (Task 1) — `runUpdate(opts?) => number`.
- Produces: `skill-pi update` exits with `runUpdate`'s code without spawning pi; all other arg shapes unchanged. Exported `parseArgs(argv) => args` (with `args.update: boolean`) and `isUpdateCommand(args) => boolean`.
- Seam: the `parseArgs` output — `args.update` boolean — and `isUpdateCommand` as the single decision point `main` uses.
- Deletion test: if the interception is removed, `update` flows into `args.passthrough`, pi receives it, and pi's package command updates stock pi (the original bug).
- Adapters: 1 (no seam for parse itself; tested end-to-end via the routing assertions).

**SATISFIES:** `R-update-intercepted`, `R-update-help`

- [ ] **Step 1: Write the failing test**

Append to `test/update.test.js`. Routing is tested by invoking the real CLI with `update` and a stubbed npm — but the cleanest seam is to test the arg contract directly:

```js
test("parseArgs: bare 'update' is consumed, not passed through", () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["update"]);
  assert.equal(args.update, true);
  assert.deepEqual(args.passthrough, []);
  assert.equal(args.project, process.cwd());
});

test("parseArgs: 'update' with a project still routes to update (first bare positional wins)", () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["/tmp/foo", "update"]);
  assert.equal(args.update, true);
  assert.deepEqual(args.passthrough, []);
});

test("parseArgs: '--update' (flag form) is NOT the subcommand", () => {
  const { parseArgs } = await import("../bin/skill-pi.js");
  const args = parseArgs(["--update"]);
  assert.equal(args.update, false);
  assert.deepEqual(args.passthrough, ["--update"]);
});

test("printHelp documents the update subcommand", () => {
  const { printHelp } = await import("../bin/skill-pi.js");
  const { stdout } = withStreams(() => printHelp());
  assert.match(stdout, /skill-pi update/);
});
```

NOTE for implementer: the bin file currently has no exports and calls `main()` at top level. Adding an `export` statement is safe on its own (a file with any `export` is a module anyway), but importing it from a test would still run the top-level `main()` — which is async and only calls `process.exit` on the `--version` / `--import-auth` / `update` paths, so a plain import with the test runner's own argv does not exit the test process (it just starts a pending promise). To keep the routing tests hermetic regardless, guard the top-level call:

```js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

Then the tests can `await import("../bin/skill-pi.js")` and call the exported `parseArgs` directly. Extract the interception decision into an exported pure helper `isUpdateCommand(args)` (returns `args.update === true`) and have `main` use it — the `args.update` field from `parseArgs` is the routing contract, and the spawn side is already covered by Task 1's `runUpdate` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/update.test.js`
Expected: FAIL — `parseArgs` not exported / `args.update` is `undefined`

- [ ] **Step 3: Write minimal implementation**

In `bin/skill-pi.js`:

1. `parseArgs`: add `update: false` to the returned object. In the positional branch (`else if (!args.project && !a.startsWith("-"))`), if `args.project` is already set and `a === "update"`, set `args.update = true` and `continue`; if `args.project` is not set and `a === "update"`, set `args.update = true` and `continue` (project stays null → defaults to cwd later). Do NOT treat `--update` as the subcommand (it falls through to passthrough).
2. `main`: after the `args.version` block and before `args.importAuthFrom`, add:
   ```js
   if (isUpdateCommand(args)) {
     const { runUpdate } = await import("../lib/update.js");
     process.exit(runUpdate());
   }
   ```
   (Dynamic import keeps the update path out of the normal launch cold path.)
3. `printHelp`: add one line in the Usage block:
   ```
     skill-pi update                       Update skill-pi + bundled pi (npm install + npm link --force)
   ```
4. Add `export { parseArgs, isUpdateCommand, printHelp };` at the bottom of the file (so the help-text test can assert against it without spawning a process).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/update.test.js`
Expected: PASS (all, including Task 1 tests)

Then run the full root suite to prove no regression:

Run: `node --test "test/**/*.test.js"`
Expected: PASS (no new failures vs. baseline; the 7 pre-existing skips remain skips)

- [ ] **Step 5: Commit**

```bash
git add bin/skill-pi.js test/update.test.js
git commit -m "feat: intercept 'skill-pi update' before pi passthrough"
```

---

### Task 3: README docs + acceptance feature

**Files:**
- Modify: `README.md` (Usage section)
- Create: `.skillgrid/specs/2026-10-16-skill-pi-update/acceptance.feature`

**Interfaces:**
- Consumes: the final CLI surface from Tasks 1-2.
- Produces: documented behavior + BDD scenarios.
- Seam: none (docs).
- Deletion test: docs-only; no code complexity reappears.
- Adapters: n/a.

**SATISFIES:** `R-update-help` (docs half), `R-update-runs-npm-steps`, `R-update-reports-transition`, `R-update-fails-on-npm-error`, `R-update-intercepted` (scenario-level mirrors)

- [ ] **Step 1: Write the acceptance feature**

```gherkin
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
```

- [ ] **Step 2: Update README**

In `README.md`, in the Usage/commands section, add:

```markdown
### Updating

`skill-pi update` refreshes the wrapper and its bundled pi
(`npm install` + `npm link --force` in the skill-pi checkout) and prints the
resulting pi version transition. This is what the in-TUI "Update Available"
banner (pi's own version check) points at — the banner stays as a passive
heads-up; running the command updates skill-pi, never stock pi. Bundled
extensions update via their own package lifecycle (`@devopstales/pi-*`).
```

- [ ] **Step 3: Verify docs render and feature is well-formed**

Run: `node --test "test/**/*.test.js"` (regression guard)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md .skillgrid/specs/2026-10-16-skill-pi-update/acceptance.feature
git commit -m "docs: document skill-pi update + acceptance scenarios"
```

---

## Rollback plan

Each task is an independently revertable commit. Rollback order is reverse: Task 3 (docs/feature) → Task 2 (interception) → Task 1 (module). Reverting Task 2 alone restores the original behavior exactly (update passes through to pi) — no data, no state, no migration to undo.

## Success criteria (measurable)

- `node --test "test/**/*.test.js"`: 0 new failures vs. baseline.
- `skill-pi update` on a real checkout: pi version advances to the latest published `@earendil-works/pi-coding-agent`, `which skill-pi` resolves, `skill-pi --version` prints the new pi version.
- `skill-pi --help` shows the `update` line (asserted via the `printHelp` output — the routing tests import the bin module, so a fourth routing test asserts `printHelp`'s usage text contains `skill-pi update`).
- In-TUI banner still renders (backstop truth) with a now-truthful command.
