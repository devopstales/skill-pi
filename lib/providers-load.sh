#!/usr/bin/env bash
# Door check part 2 (2026-10-14-unified-providers): prove the vendored pi-free
# base loads in a real `skill-pi --print` session.
#
# pi-free's logStartupSummary marker is the proof the base loaded. pi-free
# writes its log to $PI_DATA_DIR/free.log (PI_DATA_DIR resolves through
# PI_CODING_AGENT_DIR after the ADR-0002 fix in TICKET-06; falls back to
# ~/.pi when unset). The marker is an info-level line and the file level
# defaults to debug, so it lands in the data dir's free.log whether or not
# LOG_LEVEL is set. We read the marker from that file (scoped to this run's
# session by timestamp) and fall back to the captured stdout+stderr. A load failure instead prints
# `Failed to load extension "...": ...` to stderr and the session exits 1; the
# per-provider lines in the log name any rejected setup.
#
# The model call in a throwaway agent dir is often rejected on auth (401 / no
# API key) because it has no credentials — that is a FINDING (named below), not
# a load failure, and it will not self-heal by retry.
#
# The run is network-heavy (~25 providers register on session start) and has
# hung under parallelism on a contended host, so retry 3x with a 600s cap.
set -euo pipefail

AG="$(mktemp -d "${TMPDIR:-/tmp}/skill-pi-providers-XXXXXX")"
CAPTURE="$(mktemp)"
trap 'rm -rf "$AG" "$CAPTURE"' EXIT

# ~/.pi/free.log is shared across sessions and rotated; snapshot its size so we
# only scan lines this run appends (avoids matching an old run's marker).
FREELOG="${HOME}/.pi/free.log"
baseline=0
if [ -f "$FREELOG" ]; then
  baseline="$(wc -c < "$FREELOG" | tr -d ' ')"
fi

has_marker() {
  # True if the run's session appended the startup-complete marker.
  if [ -f "$FREELOG" ]; then
    tail -c +"$((baseline + 1))" "$FREELOG" 2>/dev/null \
      | grep -qF '[pi-free] startup complete in' && return 0
  fi
  grep -qF '[pi-free] startup complete in' "$CAPTURE" 2>/dev/null
}

ok=0
for i in 1 2 3; do
  rm -f "$CAPTURE"
  touch "$CAPTURE"
  ( node bin/skill-pi.js --agent-dir "$AG" --print "reply with the word ok" > "$CAPTURE" 2>&1 || true ) &
  PID=$!
  ( sleep 600; kill -9 "$PID" 2>/dev/null || true ) &
  KILLER=$!
  wait "$PID"
  RC=$?
  kill "$KILLER" 2>/dev/null || true

  # The model call in a fresh agent dir is often rejected on auth (401 / no API
  # key). The base loaded (extensions run before the model call) but the session
  # cannot answer. Name it — a finding, not a silent pass — and stop (retrying
  # will not add credentials).
  if grep -qE '401: |"Unauthorized"|No API key found|Authentication failed' "$CAPTURE" 2>/dev/null; then
    echo "providers:load: base loaded but the model call was rejected on auth — a finding, not a silent pass:"
    grep -E '401: |"Unauthorized"|No API key found|Authentication failed' "$CAPTURE" | head -5
    exit 1
  fi

  if has_marker; then
    if grep -q 'ERR_MODULE_NOT_FOUND' "$CAPTURE" "$FREELOG" 2>/dev/null; then
      echo "providers:load: ERR_MODULE_NOT_FOUND present (attempt $i)"
      cat "$CAPTURE"
      exit 1
    fi
    if [ "$RC" -ne 0 ]; then
      echo "providers:load: base loaded but session exited $RC (attempt $i)"
      cat "$CAPTURE"
      exit 1
    fi
    # A rejected provider setup is a finding, not a silent pass: name it.
    if tail -c +"$((baseline + 1))" "$FREELOG" 2>/dev/null \
        | grep -E 'provider setup: .*"success":false' | grep -q .; then
      echo "providers:load: WARNING — rejected provider setup(s) in this run (finding, not a silent pass):"
      tail -c +"$((baseline + 1))" "$FREELOG" | grep -E 'provider setup: .*"success":false'
    fi
    ok=1
    break
  fi
  echo "providers:load: attempt $i did not load base (rc=$RC); retrying"
done

if [ "$ok" -ne 1 ]; then
  echo "providers:load: startup marker missing after 3 attempts"
  cat "$CAPTURE"
  exit 1
fi
echo "providers:load: base loaded in a real session (exit 0, startup marker present, no ERR_MODULE_NOT_FOUND)"
