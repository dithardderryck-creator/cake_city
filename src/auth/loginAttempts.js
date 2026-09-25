/**
 * Brute-force protection for the login mutation.
 *
 * PINs are 4 digits, so without this an attacker can grind them freely. Two
 * independent counters are tracked, because either one alone is bypassable:
 *
 *   - per-account: stops one account being ground from many IPs
 *   - per-IP:      stops one IP grinding many accounts
 *
 * Locking out on both means a real shop owner who fat-fingers their PIN a few
 * times is only briefly delayed, while a systematic attack hits a wall either
 * way. In-memory is the right trade-off for a single-shop process on the
 * shop's own PC: it resets on restart, which is acceptable because an attacker
 * with the ability to restart the process already owns the machine.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // failures counted within this window
const LOCKOUT_MS = 15 * 60 * 1000; // how long a locked account stays locked
const SWEEP_MS = 5 * 60 * 1000;

/** @type {Map<string, {fails: number, firstAt: number, lockedUntil: number}>} */
const attempts = new Map();

function sweep(now) {
  for (const [key, rec] of attempts) {
    const expired = now > rec.lockedUntil && now - rec.firstAt > WINDOW_MS;
    if (expired) attempts.delete(key);
  }
}

let lastSweep = Date.now();
function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep > SWEEP_MS) {
    sweep(now);
    lastSweep = now;
  }
}

/** True when this key is currently locked out. */
function isLocked(key) {
  maybeSweep();
  const rec = attempts.get(key);
  if (!rec) return false;
  return rec.lockedUntil > Date.now();
}

/**
 * Record one failed attempt. Returns the number of failures still remaining
 * before lockout (0 once locked).
 */
function recordFailure(key) {
  maybeSweep();
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { fails: 1, firstAt: now, lockedUntil: 0 });
    return MAX_ATTEMPTS - 1;
  }
  rec.fails += 1;
  if (rec.fails >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
    return 0;
  }
  return MAX_ATTEMPTS - rec.fails;
}

/** Clear counters after a successful login. */
function clear(key) {
  attempts.delete(key);
}

/** Test seam: forget everything. */
function reset() {
  attempts.clear();
}

module.exports = {
  MAX_ATTEMPTS,
  WINDOW_MS,
  LOCKOUT_MS,
  isLocked,
  recordFailure,
  clear,
  reset,
};
