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

start_api() {
  node src/server.js >>"$LOG" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 40); do
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

for suite in verify verify:recipes; do
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

echo ""
if [ $status -eq 0 ]; then
  echo "All suites passed."
else
  echo "One or more suites failed."
fi
exit $status
