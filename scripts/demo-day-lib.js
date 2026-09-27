/**
 * Shared helpers for the demo-day seed and clear scripts.
 *
 * Both scripts talk to the running API for every real write, so the seed goes
 * through the same resolvers, permission checks, stock triggers and audit log
 * that a real day's activity would. Direct SQL is used only for two things
 * that have no API equivalent: reading/writing the staff PIN hashes so the
 * seed can act as each real staff member, and backdating timestamps.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Load .env the same way the app does, and force the shop's timezone so
// CURRENT_DATE here means the same business day it means in the running app.
require('dotenv').config({ quiet: true });
process.env.DB_TIMEZONE = process.env.DB_TIMEZONE || 'Africa/Dar_es_Salaam';

const API = process.env.CAKE_API || 'http://localhost:4000/graphql';
const MANIFEST = path.join(__dirname, '..', 'backups', 'demo-day-manifest.json');
const TEMP_PIN = '7734';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c timezone=${process.env.DB_TIMEZONE}`,
});

async function sql(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Minimal GraphQL caller. Throws with the server's own message on failure. */
async function gql(query, token, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    const e = new Error(json.errors[0].message);
    e.graphql = json.errors[0];
    e.raw = json;
    throw e;
  }
  return json.data;
}

async function login(id, pin) {
  const d = await gql(`mutation($id:ID!,$pin:String!){login(id:$id,pin:$pin){token mtumiaji{id jina jukumu}}}`, null, {
    id,
    pin,
  });
  return d.login;
}

/**
 * Swap in a known PIN for the given staff so the seed can act as them, then put
 * the original hashes back. The hashes are captured before anything is written
 * and restored in a finally block, so an interrupted run cannot leave the shop
 * with credentials only this script knows.
 */
async function withStaffPins(staffIds, fn) {
  const saved = await sql(
    'SELECT id, pin_hash FROM mtumiaji WHERE id = ANY($1::int[]) ORDER BY id',
    [staffIds]
  );
  const hash = await bcrypt.hash(TEMP_PIN, 10);
  try {
    await sql('UPDATE mtumiaji SET pin_hash = $1 WHERE id = ANY($2::int[])', [
      hash,
      staffIds,
    ]);
    const tokens = {};
    for (const row of saved) {
      const session = await login(row.id, TEMP_PIN);
      tokens[row.id] = { token: session.token, ...session.mtumiaji };
    }
    return await fn(tokens);
  } finally {
    // One statement, driven by the captured hashes, so restoring cannot depend
    // on the order the loop happens to run in.
    await sql(
      `UPDATE mtumiaji m
          SET pin_hash = s.pin_hash
         FROM (SELECT * FROM unnest($1::int[], $2::text[])) AS s(id, pin_hash)
        WHERE m.id = s.id`,
      [saved.map((r) => r.id), saved.map((r) => r.pin_hash)]
    );
  }
}

/** Confirm the PIN hashes came back byte-for-byte. */
async function assertPinsRestored(staffIds, before) {
  const after = await sql('SELECT id, pin_hash FROM mtumiaji WHERE id = ANY($1::int[]) ORDER BY id', [
    staffIds,
  ]);
  const same = before.every((b, i) => b.pin_hash === after[i]?.pin_hash);
  if (!same) throw new Error('PIN hashes were not restored correctly — do not continue.');
  return true;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function writeManifest(data) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2) + '\n');
}

function clearManifest() {
  if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
}

/**
 * The shop runs on Africa/Dar_es_Salaam, so "today" for a bakery is that date,
 * not whatever the host clock says. Every date in the seed is derived from the
 * database's own CURRENT_DATE so the demo lines up with the app's day boundary.
 */
async function shopToday() {
  const [row] = await sql('SELECT CURRENT_DATE::text AS d, to_char(now(), \'HH24:MI\') AS t');
  return row;
}

module.exports = {
  API,
  MANIFEST,
  TEMP_PIN,
  pool,
  sql,
  gql,
  login,
  withStaffPins,
  assertPinsRestored,
  readManifest,
  writeManifest,
  clearManifest,
  shopToday,
};
