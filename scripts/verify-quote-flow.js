/**
 * BR-05 / D-28: a custom cake's price comes from an owner quote.
 *
 *   node scripts/verify-quote-flow.js    (or: npm run verify:br05)
 *
 * The build had pricing the wrong way round: bei_jumla was required and the
 * cashier typed the number at the till. These checks pin the corrected flow —
 *
 *   cashier describes the cake with no price -> order is awaiting_quote,
 *   an owner quote request exists, no ticket, no money taken
 *   -> owner prices it -> order becomes 'ordered', price set, ticket issued
 *   -> non-owner cannot price it
 *
 * and prove the old path still works, because pricing at the till is still
 * allowed when the price is supplied — this is a permission change, not a
 * removal.
 *
 * Start the API first (npm start).
 */

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;
const FIXTURE_PIN = 'bq0509';
const PREFIX = 'ZZ BQ05';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function gql(query, token, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const errOf = (j) => j?.errors?.[0];
const codeOf = (j) => errOf(j)?.extensions?.code;
const msgOf = (j) => errOf(j)?.message || '';

let pool;
async function sql(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

const created = { staff: [], agizo: [], ombi: [] };
const cleanupErrors = [];
async function del(text, params) {
  try {
    await sql(text, params);
  } catch (e) {
    cleanupErrors.push(`${text.replace(/\s+/g, ' ').trim()} -> ${e.message}`);
  }
}

async function assertFixture(table, ids) {
  if (!ids || !ids.length) return;
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = ANY($1::int[]) LIMIT 1`,
    [ids]
  );
  if (rows.length) {
    throw new Error(
      `refusing to touch ${table}: it holds rows this run did not create (ids ${ids.join(',')})`
    );
  }
}

async function login(id, pin) {
  const j = await gql(
    `mutation ($id: ID!, $pin: String!) { login(id: $id, pin: $pin) { token } }`,
    null,
    { id: String(id), pin: pin || FIXTURE_PIN }
  );
  if (errOf(j)) throw new Error(`login ${id} failed: ${msgOf(j)}`);
  return j.data.login.token;
}

async function cleanup() {
  // Keyed on the sender, not on the order link. ombi.agizo_id is ON DELETE SET
  // NULL, so a request whose order was already cleaned up is left orphaned with
  // a null agizo_id — and that orphaned row then blocks the staff delete on
  // ombi_kutoka_kwa. Deleting by kutoka_kwa catches it either way.
  const ombiIds = await sql(`SELECT id FROM ombi WHERE kutoka_kwa = ANY($1::int[])`, [
    created.staff,
  ]);
  if (ombiIds.length) {
    await del('DELETE FROM ombi WHERE id = ANY($1::int[])', [ombiIds.map((r) => r.id)]);
  }
  if (created.ombi.length) await del('DELETE FROM ombi WHERE id = ANY($1::int[])', [created.ombi]);
  if (created.agizo.length) {
    for (const t of ['kumbukumbu_matumizi', 'mauzo', 'tikiti', 'ukumbusho']) {
      await del(`DELETE FROM ${t} WHERE agizo_id = ANY($1::int[])`, [created.agizo]);
    }
    await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [created.agizo]);
  }
  await del(
    `DELETE FROM mtumiaji WHERE id = ANY($1::int[]) AND jina ILIKE $2`,
    [created.staff, `${PREFIX}%`]
  );
}

async function purgeStrays() {
  // Requests first, keyed on the sender, so a request from a previous crashed
  // run is gone before its (already-orphaned) order row is touched.
  const strayStaff = await sql(`SELECT id FROM mtumiaji WHERE jina ILIKE $1`, [`${PREFIX}%`]);
  if (strayStaff.length) {
    await del('DELETE FROM ombi WHERE kutoka_kwa = ANY($1::int[])', [strayStaff.map((r) => r.id)]);
    await del(`DELETE FROM mtumiaji WHERE id = ANY($1::int[])`, [strayStaff.map((r) => r.id)]);
  }
  const strayOrders = await sql('SELECT id FROM agizo_maalum WHERE ladha ILIKE $1', [`${PREFIX}%`]);
  if (strayOrders.length) {
    const ids = strayOrders.map((r) => r.id);
    for (const t of ['kumbukumbu_matumizi', 'mauzo', 'tikiti', 'ukumbusho']) {
      await del(`DELETE FROM ${t} WHERE agizo_id = ANY($1::int[])`, [ids]);
    }
    await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [ids]);
  }
}

async function main() {
  require('dotenv').config({ quiet: true });
  const ownerPin = process.env.CAKE_OWNER_PIN;
  if (!ownerPin) throw new Error('CAKE_OWNER_PIN is not set. Add it to .env before running this suite.');

  await purgeStrays();
  const owner = await login(1, ownerPin);

  // A cashier to describe the cake with no price. Created by this run on a
  // fixture PIN; the owner PIN is the seeded one.
  const cashier = (
    await gql(
      `mutation ($jina: String!, $jukumu: Jukumu!, $pin: String!) {
         ongeza_mfanyakazi(jina: $jina, jukumu: $jukumu, pin: $pin) { id }
       }`,
      owner,
      { jina: `${PREFIX} Cashier`, jukumu: 'cashier', pin: FIXTURE_PIN }
    )
  ).data?.ongeza_mfanyakazi;
  if (!cashier) throw new Error('could not create the cashier fixture');
  created.staff.push(cashier.id);
  const till = await login(cashier.id);

  // ---- the cashier describes a cake with no price -------------------------
  const unquoted = await gql(
    `mutation ($input: AgizoInput!) {
       unda_agizo(input: $input) {
         id hali bei_jumla salio tikiti { id } ombi_bei { id hali jukumu_anayehudumiwa }
       }
     }`,
    till,
    {
      input: {
        ladha: `${PREFIX} Unquoted`,
        ukubwa: '10 inch',
        tarehe_ya_kuchukua: '2026-10-01',
        malipo_ya_awali: 0,
      },
    }
  );
  check('cashier can describe a cake with no price', !errOf(unquoted), msgOf(unquoted));
  const o = unquoted.data?.unda_agizo;
  if (!o) throw new Error('order not created');
  created.agizo.push(o.id);

  check(
    'BR-05: the order is awaiting_quote, not ordered',
    o.hali === 'awaiting_quote',
    `hali=${o.hali}`
  );
  check('an unquoted order carries no price', Number(o.bei_jumla) === 0, `bei=${o.bei_jumla}`);
  check('an unquoted order gets no kitchen ticket', o.tikiti === null, 'a ticket was issued');
  check(
    'BR-05: a quote request was raised to the owner',
    !!o.ombi_bei && o.ombi_bei.jukumu_anayehudumiwa === 'owner',
    `ombi=${JSON.stringify(o.ombi_bei)}`
  );
  if (o.ombi_bei) created.ombi.push(o.ombi_bei.id);

  // no money was taken for an unpriced cake
  const sales = await sql('SELECT id FROM mauzo WHERE agizo_id = $1', [o.id]);
  check('no money was taken for an unpriced cake', sales.length === 0, `sales=${sales.length}`);

  // ---- an unquoted order cannot enter production --------------------------
  const advance = await gql(
    `mutation ($id: ID!) { badge_hali_order(id: $id, hali: in_progress) { id hali } }`,
    owner,
    { id: o.id }
  );
  check(
    'an unquoted order cannot be put into production',
    !!errOf(advance),
    'no error raised'
  );

  // ---- the owner prices it -----------------------------------------------
  const priced = await gql(
    `mutation ($id: ID!, $bei: Float!) { toa_bei(id: $id, bei: $bei) { id hali bei_jumla salio } }`,
    owner,
    { id: o.id, bei: 75000 }
  );
  check('owner can price an awaiting_quote order', !errOf(priced), msgOf(priced));
  check(
    'the price is set and the order is now ordered',
    priced.data?.toa_bei?.hali === 'ordered' && Number(priced.data?.toa_bei?.bei_jumla) === 75000,
    `hali=${priced.data?.toa_bei?.hali} bei=${priced.data?.toa_bei?.bei_jumla}`
  );

  const ticket = await sql('SELECT id FROM tikiti WHERE agizo_id = $1', [o.id]);
  check('pricing issues the kitchen ticket', ticket.length === 1, `tickets=${ticket.length}`);

  const closed = await sql(
    `SELECT hali FROM ombi WHERE id = $1`,
    [o.ombi_bei?.id]
  );
  check(
    'the quote request is closed by the quote',
    closed[0]?.hali === 'imekamilika',
    `hali=${closed[0]?.hali}`
  );

  // a second quote is refused — the price is not casually re-decided
  const requote = await gql(
    `mutation ($id: ID!) { toa_bei(id: $id, bei: 1) { id } }`,
    owner,
    { id: o.id }
  );
  check('a priced order cannot be re-quoted', !!errOf(requote), 'no error raised');

  // ---- only the owner may quote (D-28) -----------------------------------
  const unquoted2 = await gql(
    `mutation ($input: AgizoInput!) {
       unda_agizo(input: $input) { id hali }
     }`,
    till,
    {
      input: {
        ladha: `${PREFIX} Unquoted2`,
        tarehe_ya_kuchukua: '2026-10-02',
        malipo_ya_awali: 0,
      },
    }
  );
  const o2 = unquoted2.data?.unda_agizo;
  if (o2) created.agizo.push(o2.id);
  const cashierQuotes = await gql(
    `mutation ($id: ID!) { toa_bei(id: $id, bei: 100) { id } }`,
    till,
    { id: o2.id }
  );
  check(
    'the cashier cannot price their own order (D-28)',
    codeOf(cashierQuotes) === 'FORBIDDEN',
    `code=${codeOf(cashierQuotes)}`
  );

  // ---- the old priced-at-the-till path still works -----------------------
  const pricedAtTill = await gql(
    `mutation ($input: AgizoInput!) {
       unda_agizo(input: $input) { id hali bei_jumla tikiti { id } }
     }`,
    till,
    {
      input: {
        ladha: `${PREFIX} PricedAtTill`,
        tarehe_ya_kuchukua: '2026-10-03',
        bei_jumla: 30000,
        malipo_ya_awali: 5000,
      },
    }
  );
  check('a cashier can still price at the till when a price is given', !errOf(pricedAtTill), msgOf(pricedAtTill));
  const pt = pricedAtTill.data?.unda_agizo;
  if (pt) created.agizo.push(pt.id);
  check(
    'a till-priced order goes straight to ordered',
    pt?.hali === 'ordered' && Number(pt?.bei_jumla) === 30000,
    `hali=${pt?.hali} bei=${pt?.bei_jumla}`
  );
}

async function run() {
  try {
    await main();
  } catch (e) {
    failed += 1;
    failures.push(`harness error — ${e.message}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  harness error — ${e.message}`);
  } finally {
    await cleanup();
    if (cleanupErrors.length) {
      console.log('\n  cleanup problems (rows may have been left behind):');
      cleanupErrors.forEach((e) => console.log(`    - ${e}`));
    }
  }
  console.log(`\n  BR-05 quote flow: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  failures:');
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

(async () => {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/cakecity',
  });
  await run();
  await pool.end();
})();
