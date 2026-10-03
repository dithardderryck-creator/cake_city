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
 * way.
 *
 * The counters live in Postgres, not in this process. That matters as soon as
 * the API runs as more than one instance: an in-memory Map gives every instance
 * its own fresh allowance and is wiped by a restart or a redeploy, so an
 * attacker facing an internet-facing API simply retries until they land on a
 * clean instance. Storing the state in the database means every instance sees
 * every failure, a deploy cannot be used to clear a lockout, and the per-account
 * counter cannot be reset by an attacker rotating source IPs.
 *
 * Every function here is async now, which is the cost of doing this properly.
 * The two queries it runs are indexed lookups on a primary key, so the cost is
 * one round trip each on a path the caller already pays a bcrypt comparison for
 * — bcrypt deliberately dominates that cost, so the queries are in the noise.
 */

const pool = require('../db/pool');

/**
 * Tunable so a deployment can be tuned without a code change, but defaulting to
 * the values decision A1 was verified against.
 */
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60 * 1000);

/**
 * How many counter rows may be swept in one pass.
 *
 * A plain DELETE ... LIMIT is not available, so the oldest-expiring rows are
 * taken by id-ordered selection and deleted by key. Capped so a cleanup can
 * never turn into a long lock-taking statement on a busy table.
 */
const SWEEP_BATCH = Number(process.env.LOGIN_SWEEP_BATCH || 500);

/** How often the opportunistic sweep may run. */
const SWEEP_INTERVAL_MS = Number(process.env.LOGIN_SWEEP_INTERVAL_MS || 5 * 60 * 1000);

let lastSweep = 0;

async function sweep(now) {
  const before = new Date(now - WINDOW_MS).toISOString();
  const until = new Date(now - LOCKOUT_MS).toISOString();
  await pool.query(
    `DELETE FROM jaribio_la_ingia
      WHERE kituo IN (
        SELECT kituo FROM jaribio_la_ingia
         WHERE hadi_kufungwa < $1 AND bila_start < $2
         ORDER BY hadi_kufungwa
         LIMIT $3
      )`,
    [until, before, SWEEP_BATCH]
  );
}

async function maybeSweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  // Best effort: a failed cleanup must never block a real login, and the rows it
  // would remove are already harmless to keep.
  await sweep(now).catch((err) =>
    console.error('[jaribio_la_ingia] kusafisha imeshindwa:', err.message)
  );
}

/** True when this key is currently locked out. */
async function isLocked(key) {
  const now = Date.now();
  await maybeSweep(now);
  const { rows } = await pool.query(
    'SELECT hadi_kufungwa FROM jaribio_la_ingia WHERE kituo = $1',
    [key]
  );
  if (!rows[0]) return false;
  return new Date(rows[0].hadi_kufungwa).getTime() > now;
}

/**
 * Record one failed attempt. Returns the number of failures still remaining
 * before lockout (0 once locked).
 *
 * The read and the write are done in one statement so two simultaneous wrong
 * PINs cannot both read "4 failures" and both decide there is one attempt left.
 * COALESCE resets the count when the window has lapsed, which is the same rule
 * the in-memory version applied.
 */
async function recordFailure(key) {
  const now = Date.now();
  await maybeSweep(now);
  const { rows } = await pool.query(
    `INSERT INTO jaribio_la_ingia (kituo, majaribio, bila_start, hadi_kufungwa, iliyosasishwa)
          VALUES ($1, 1, now(), to_timestamp(0), now())
     ON CONFLICT (kituo) DO UPDATE SET
          majaribio = CASE
            WHEN jaribio_la_ingia.bila_start < now() - ($2 || ' milliseconds')::interval
              THEN 1
            ELSE jaribio_la_ingia.majaribio + 1
          END,
          bila_start = CASE
            WHEN jaribio_la_ingia.bila_start < now() - ($2 || ' milliseconds')::interval
              THEN now()
            ELSE jaribio_la_ingia.bila_start
          END,
          hadi_kufungwa = CASE
            WHEN jaribio_la_ingia.bila_start < now() - ($2 || ' milliseconds')::interval
              THEN to_timestamp(0)
            ELSE CASE
              WHEN jaribio_la_ingia.majaribio + 1 >= $3
                THEN now() + ($4 || ' milliseconds')::interval
              ELSE jaribio_la_ingia.hadi_kufungwa
            END
          END,
          iliyosasishwa = now()
      RETURNING majaribio, (hadi_kufungwa > now()) AS imefungwa`,
    [key, WINDOW_MS, MAX_ATTEMPTS, LOCKOUT_MS]
  );
  const rec = rows[0];
  if (!rec) return MAX_ATTEMPTS - 1;
  if (rec.imefungwa) return 0;
  return Math.max(0, MAX_ATTEMPTS - rec.majaribio);
}

/** Clear counters after a successful login. */
async function clear(key) {
  await pool.query('DELETE FROM jaribio_la_ingia WHERE kituo = $1', [key]);
}

/** Test seam: forget everything. */
async function reset() {
  lastSweep = 0;
  await pool.query('DELETE FROM jaribio_la_ingia');
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
