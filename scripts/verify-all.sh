#!/usr/bin/env bash
# Runs both verification suites against a live API.
#
# The API is restarted between them on purpose. The brute-force lockout check
# in verify-fixes.js deliberately trips the per-IP throttle, and that state is
# held in server memory for 15 minutes. Without a restart, the second suite
# cannot authenticate as the owner and every check in it fails for a reason
# that has nothing to do with the code under test.
#
# A single API process is reused within each suite so the suites stay fast.
set -uo pipefail
cd "$(dirname "$0")/.."

API_PID=""
LOG=/tmp/cakecity-verify-all.log

# True when something is already listening on the API port. The suites need a
# server nobody else is using, and the brute-force lockout check deliberately
# trips the per-IP throttle inside whichever process serves them.
port_in_use() {
  lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1
}

start_api() {
  # Refuse to start if the port is taken. Without this check the spawned server
  # dies with EADDRINUSE, the health probe below is answered by whatever else
  # owns the port, and the suites quietly run against that other process. The
  # lockout test then throttles an IP in someone else's long-lived dev server,
  # which locks the operator out of their own browser for 15 minutes and fails
  # the next suite for a reason that has nothing to do with the code.
  if port_in_use; then
    echo "Port 4000 is already in use, so these suites cannot run." >&2
    echo "Stop the other server first (an 'npm start' or 'npm run dev' you left" >&2
    echo "running), then try again." >&2
    return 1
  fi

  node src/server.js >>"$LOG" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 40); do
    # A dead PID means the server exited — most likely a port clash that slipped
    # past the check above. Report it instead of waiting out the full timeout.
    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "API exited during startup; see $LOG" >&2
      API_PID=""
      return 1
    fi
    if curl -sf -o /dev/null http://localhost:4000/health; then return 0; fi
    sleep 0.5
  done
  echo "API failed to start; see $LOG" >&2
  return 1
}

stop_api() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
  fi
  API_PID=""
}

# Never leave a stray server behind, however this script exits.
trap stop_api EXIT INT TERM

: >"$LOG"
status=0

  # The pure unit suites come first because they need neither a database nor a
  # server, so a broken band or state machine is reported in a second rather
  # than after a minute of API and fixture work.
  for suite in "node scripts/verify-matcher.js" "node scripts/verify-chef-and-requests.js"; do
    echo ""
    echo "=== $suite ==="
    $suite
    rc=$?
    if [ $rc -ne 0 ]; then
      status=$rc
      echo "=== $suite FAILED ==="
    fi
  done

  for suite in verify verify:recipes verify:br13 verify:br05 verify:grid; do
    echo ""
    echo "=== $suite ==="
    start_api || exit 1
    npm run "$suite"
    rc=$?
    stop_api
    if [ $rc -ne 0 ]; then
      status=$rc
      echo "=== $suite FAILED ==="
    fi
  done

  # The suites above create real rows through the API on purpose and delete them
  # again. This is the check that they actually did: a suite can pass every
  # assertion and still leave a sale or a reminder behind, and the day then stops
  # matching its own takings without anything reporting a failure. Skipped when
  # no demo day has been seeded, since there is then nothing to compare against.
  echo ""
  echo "=== demo:audit ==="
  if [ -f backups/demo-day-manifest.json ]; then
    npm run --silent demo:audit
    rc=$?
    if [ $rc -ne 0 ]; then
      status=$rc
      echo "=== demo:audit FAILED ==="
      echo "The suites changed data they did not clean up. See above for the exact rows."
    fi
  else
    echo "No demo manifest, nothing to audit. Skipped."
  fi

  echo ""
  if [ $status -eq 0 ]; then
    echo "All suites passed."
  else
    echo "One or more suites failed."
  fi
  exit $status
