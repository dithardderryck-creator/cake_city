/**
 * Date helpers pinned to Tanzania time.
 *
 * Tanzania observes no daylight saving, so EAT is a fixed UTC+03:00 year
 * round. Pinning the offset explicitly means these helpers give the same
 * answer whether the Node process runs in Dar es Salaam, UTC, or anywhere
 * else — which is what stops a 00:00-03:00 EAT sale from being attributed to
 * the previous business day.
 *
 * Prefer Postgres CURRENT_DATE for anything that filters stored `tarehe`
 * columns (see tickets/engine.js and migrations). These helpers are for the
 * places that must build a JS Date or a display key.
 */

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+03:00, no DST in Tanzania
const EAT_OFFSET_SUFFIX = '+03:00';

const pad2 = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the given instant, as seen in Tanzania. */
function eatDateKey(d = new Date()) {
  const shifted = new Date(d.getTime() + EAT_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Current instant as an EAT-anchored wall-clock Date (for arithmetic only). */
function eatNow() {
  return new Date(Date.now() + EAT_OFFSET_MS);
}

/**
 * Build a Date for a Tanzania wall-clock time on a given YYYY-MM-DD.
 * `hour`/`minute` are EAT local time. Returns a real UTC instant.
 */
function eatWallClock(isoDate, hour = 0, minute = 0) {
  return new Date(`${isoDate}T${pad2(hour)}:${pad2(minute)}:00${EAT_OFFSET_SUFFIX}`);
}

module.exports = { EAT_OFFSET_MS, EAT_OFFSET_SUFFIX, eatDateKey, eatNow, eatWallClock };
