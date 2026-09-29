/**
 * BR-13: submitting a usage report auto-creates a request to Inventory, and
 * resolving that request is the confirmation.
 *
 *   node scripts/verify-usage-request.js    (or: npm run verify:br13)
 *
 * Before this, a report only ever sat in a verification queue that nobody had
 * been asked to act on: no request, no thread on the audit trail, and the
 * confirmation had no owner. These checks pin the whole chain —
 *
 *   submit -> request exists -> stock has NOT moved
 *          -> confirm sheet -> stock moved exactly once AND request closed
 *
 * The "exactly once" part is the one that matters. The DB trigger decrements
 * when a line flips to imethibitishwa, so a resolver that also subtracted by
 * hand would quietly halve the stock. The count is asserted, not assumed.
 *
 * Self-provisioning like its siblings: it creates its own ingredient, recipe,
 * order and staff, and removes them on the way out.
 *
 * Start the API first (npm start).
 */

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;
const FIXTURE_PIN = 'br1309';
const PREFIX = 'ZZ BR13';

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

const created = { staff: [], malighafi: [], mapishi: [], agizo: [], ombi: [] };
const cleanupErrors = [];
async function del(text, params) {
  try {
    await sql(text, params);
  } catch (e) {
    cleanupErrors.push(`${text.replace(/\s+/g, ' ').trim()} -> ${e.message}`);
  }
}

/** Refuse to delete anything not created by this run. */
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

/** BR-13 routes the request to the Inventory role, resolved to a real member —
 *  which on a seeded shop is the oldest one, not the fixture this run created.
 *  So the test works with whoever actually received it. Seeded staff share the
 *  owner PIN; the fixture this run creates has its own. Try both. */
async function loginAsRecipient(id, ownerPin) {
  for (const pin of [FIXTURE_PIN, ownerPin]) {
    const j = await gql(
      `mutation ($id: ID!, $pin: String!) { login(id: $id, pin: $pin) { token } }`,
      null,
      { id: String(id), pin }
    );
    if (!errOf(j)) return j.data.login.token;
  }
  throw new Error(`could not log in as the request recipient (id ${id})`);
}

async function cleanup() {
  await del('DELETE FROM ombi WHERE id = ANY($1::int[])', [created.ombi]);
  if (created.agizo.length) {
    for (const t of ['kumbukumbu_matumizi', 'mauzo', 'tikiti', 'ukumbusho']) {
      await del(`DELETE FROM ${t} WHERE agizo_id = ANY($1::int[])`, [created.agizo]);
    }
    await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [created.agizo]);
  }
  if (created.mapishi.length) {
    await del('DELETE FROM mapishi_kipengele WHERE mapishi_id = ANY($1::int[])', [created.mapishi]);
    await del('DELETE FROM mapishi WHERE id = ANY($1::int[])', [created.mapishi]);
  }
  if (created.malighafi.length) {
    for (const t of ['kumbukumbu_matumizi', 'mapishi_kipengele', 'marekebisho_hisa', 'ukumbusho']) {
      await del(`DELETE FROM ${t} WHERE malighafi_id = ANY($1::int[])`, [created.malighafi]);
    }
    await del('DELETE FROM malighafi WHERE id = ANY($1::int[])', [created.malighafi]);
  }
  await del(
    `DELETE FROM mtumiaji WHERE id = ANY($1::int[]) AND jina ILIKE $2`,
    [created.staff, `${PREFIX}%`]
  );
}

async function purgeStrays() {
  await sql('DELETE FROM ombi WHERE ujumbe ILIKE $1', [`${PREFIX}%`]);
  const strayOrders = await sql('SELECT id FROM agizo_maalum WHERE ladha ILIKE $1', [`${PREFIX}%`]);
  if (strayOrders.length) {
    const ids = strayOrders.map((r) => r.id);
    for (const t of ['kumbukumbu_matumizi', 'mauzo', 'tikiti', 'ukumbusho']) {
      await del(`DELETE FROM ${t} WHERE agizo_id = ANY($1::int[])`, [ids]);
    }
    await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [ids]);
  }
  await del('DELETE FROM mapishi WHERE ladha ILIKE $1', [`${PREFIX}%`]);
  await sql('DELETE FROM malighafi WHERE jina ILIKE $1', [`${PREFIX}%`]);
  await del(`DELETE FROM mtumiaji WHERE jina ILIKE $1`, [`${PREFIX}%`]);
}

async function onHand(ingId) {
  const r = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id = $1', [ingId]);
  return Number(r[0]?.kiasi_kilichopo);
}

async function main() {
  require('dotenv').config({ quiet: true });
  // The owner PIN comes from .env like the sibling suites. This run creates its
  // own chef and inventory staff on a known fixture PIN, but it still needs a
  // real owner token to create them.
  const ownerPin = process.env.CAKE_OWNER_PIN;
  if (!ownerPin) {
    throw new Error('CAKE_OWNER_PIN is not set. Add it to .env before running this suite.');
  }

  await purgeStrays();

  // The three people BR-13 needs: a chef who reports, an inventory member who
  // receives, and the owner who is not involved. The inventory member is
  // created by this run precisely because the request routes to that role, and
  // a shop with no one holding it is a staffing gap the rule skips over.
  const staff = {};
  for (const [key, jina, jukumu] of [
    ['chef', `${PREFIX} Chef`, 'chef'],
    ['inventory', `${PREFIX} Inv`, 'inventory'],
  ]) {
    const j = await gql(
      `mutation ($jina: String!, $jukumu: Jukumu!, $pin: String!) {
         ongeza_mfanyakazi(jina: $jina, jukumu: $jukumu, pin: $pin) { id jina jukumu }
       }`,
      await login(1, ownerPin),
      { jina, jukumu, pin: FIXTURE_PIN }
    );
    if (errOf(j)) throw new Error(`create ${key}: ${msgOf(j)}`);
    staff[key] = j.data.ongeza_mfanyakazi.id;
    created.staff.push(j.data.ongeza_mfanyakazi.id);
  }

  const chef = await login(staff.chef);
  const inventory = await login(staff.inventory);
  const owner = await login(1, ownerPin);
  void owner;
  const ing = (
    await sql(
      `INSERT INTO malighafi (jina, kiasi_kilichopo, kiwango_cha_chini, unit, active)
       VALUES ($1, 50, 5, 'kg', true) RETURNING id`,
      [`${PREFIX} Flour`]
    )
  )[0];
  created.malighafi.push(ing.id);

  const rec = (
    await sql(
      `INSERT INTO mapishi (ladha, ukubwa, active) VALUES ($1, $2, true) RETURNING id`,
      [`${PREFIX} Cake`, '10 inch']
    )
  )[0];
  created.mapishi.push(rec.id);
  await sql(
    `INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
     VALUES ($1, $2, 1, 3, 'base')`,
    [rec.id, ing.id]
  );

  const order = (
    await sql(
      `INSERT INTO agizo_maalum (ladha, mapishi_id, bei_jumla, hali, tarehe_ya_kuchukua, created_by)
       VALUES ($1, $2, 50000, 'ordered', CURRENT_DATE, $3) RETURNING id`,
      [`${PREFIX} Order`, rec.id, staff.chef]
    )
  )[0];
  created.agizo.push(order.id);

  // ---- the chef submits a report -----------------------------------------
  const report = await gql(
    `mutation ($input: MatumiziKundiInput!) {
       log_matumizi_kundi(input: $input) { id zingumiaji { id } malighafi { id } kiasi }
     }`,
    chef,
    {
      input: {
        agizo_id: order.id,
        vitu: [
          { malighafi_id: ing.id, kiasi_cha_chini: 2, kiasi_cha_juu: 4, hali_sheeti: 'imechaguliwa' },
        ],
      },
    }
  );
  check('chef can submit a usage report', !errOf(report), msgOf(report));

  const sheetId = report.data?.log_matumizi_kundi?.[0]?.zingumiaji?.id;
  check('the report created a sheet', !!sheetId, `sheet=${sheetId}`);

  const stockBefore = await onHand(ing.id);
  check(
    'BR-12: submitting moved no stock',
    stockBefore === 50,
    `on_hand=${stockBefore}`
  );

  // ---- BR-13: a request to inventory now exists ---------------------------
  const reqRows = await sql(
    `SELECT id, hali, jukumu_anayehudumiwa, zingumiaji_id, kwenda_kwa
       FROM ombi WHERE zingumiaji_id = $1`,
    [sheetId]
  );
  check('BR-13: submitting raised a request', reqRows.length === 1, `found ${reqRows.length}`);
  const req = reqRows[0];
  let recipientToken = inventory;
  if (req) {
    const recipientRole = (
      await sql('SELECT jukumu FROM mtumiaji WHERE id = $1', [req.kwenda_kwa])
    )[0]?.jukumu;
    check(
      'the request is routed to the inventory role',
      req.jukumu_anayehudumiwa === 'inventory' && recipientRole === 'inventory',
      `role=${req.jukumu_anayehudumiwa} recipient_role=${recipientRole}`
    );
    check(
      'the request is already waiting, not a draft',
      req.hali === 'inasubiri',
      `hali=${req.hali}`
    );
    recipientToken = await loginAsRecipient(req.kwenda_kwa, ownerPin);
  }

  const requestsBeforeConfirm = (await sql('SELECT count(*)::int c FROM ombi WHERE id = $1', [req?.id]))[0].c;
  check('the request exists exactly once', requestsBeforeConfirm === 1, `n=${requestsBeforeConfirm}`);

  // dedupe: the partial unique index means an amendment gets a fresh request
  // for the new sheet rather than a second one on the same sheet.

  // ---- the inventory member sees it in their queue ------------------------
  const inbox = await gql(
    `query { ombi(fungua: true) { id zingumiaji { id } zingumiaji { hali } } }`,
    recipientToken
  );
  check('the request is visible to the inventory member', !errOf(inbox), msgOf(inbox));

  // The schema promises created_at on a usage sheet, but the table column is
  // tarehe. A field resolver bridges the two, and this pins it: without it any
  // client sorting a queue by when the sheet was raised sorts by null.
  const sheetRow = await sql('SELECT tarehe FROM zingumiaji_matumizi WHERE id = $1', [sheetId]);
  const viaGraphQL = await gql(
    `query { ombi(fungua: true) { zingumiaji { id created_at } } }`,
    recipientToken
  );
  const sheetViaGraphQL = (viaGraphQL.data?.ombi || [])
    .map((r) => r.zingumiaji)
    .find((s) => s && String(s.id) === String(sheetId));
  check(
    'the sheet reports created_at, matching the tarehe the table stores',
    !!sheetViaGraphQL?.created_at &&
      new Date(sheetViaGraphQL.created_at).toISOString() ===
        new Date(sheetRow[0]?.tarehe).toISOString(),
    `gql=${sheetViaGraphQL?.created_at} db=${sheetRow[0]?.tarehe}`
  );
  const inInbox = (inbox.data?.ombi || []).some(
    (r) => r.zingumiaji && Number(r.zingumiaji.id) === Number(sheetId)
  );
  check('the request appears in the inventory queue', inInbox);

  // ---- BR-13: confirming the sheet closes the request, atomically ---------
  const before = await onHand(ing.id);
  const confirm = await gql(
    `mutation ($id: ID!) { thibitisha_matumizi_kundi(zingumiaji_id: $id) { id hali } }`,
    recipientToken,
    { id: sheetId }
  );
  check('inventory can confirm the whole sheet', !errOf(confirm), msgOf(confirm));
  check(
    'the sheet reads as confirmed',
    confirm.data?.thibitisha_matumizi_kundi?.hali === 'imethibitishwa',
    `hali=${confirm.data?.thibitisha_matumizi_kundi?.hali}`
  );

  const after = await onHand(ing.id);
  check(
    'BR-12: stock moved on confirmation',
    after < before,
    `before=${before} after=${after}`
  );
  // "Exactly once" means the on-hand drop equals the confirmed quantity and not
  // twice that. The decrement trigger writes kiasi_kilichopo directly and does
  // not append a marekebisho_hisa row, so the on-hand delta is the instrument —
  // a resolver that also subtracted by hand would drop it to before - 2x.
  const expectedDrop = 3; // midpoint of the 2..4 band the chef tapped
  check(
    'stock moved exactly once, by the confirmed amount',
    before - after === expectedDrop,
    `dropped ${before - after}, expected ${expectedDrop}`
  );

  const closed = await sql('SELECT hali FROM ombi WHERE id = $1', [req?.id]);
  check(
    'BR-13: resolving the request is the confirmation — the request is closed',
    closed[0]?.hali === 'imekamilika',
    `hali=${closed[0]?.hali}`
  );

  // ---- guards -------------------------------------------------------------
  const again = await gql(
    `mutation ($id: ID!) { thibitisha_matumizi_kundi(zingumiaji_id: $id) { id } }`,
    recipientToken,
    { id: sheetId }
  );
  check('a confirmed sheet cannot be confirmed again', !!errOf(again), 'no error raised');
  const afterAgain = await onHand(ing.id);
  check(
    'the double confirm did not move stock again',
    afterAgain === after,
    `on_hand ${after} -> ${afterAgain}`
  );

  const chefTries = await gql(
    `mutation ($id: ID!) { thibitisha_matumizi_kundi(zingumiaji_id: $id) { id } }`,
    chef,
    { id: sheetId }
  );
  check(
    'the chef cannot confirm their own report',
    codeOf(chefTries) === 'FORBIDDEN' || codeOf(chefTries) === 'ALREADY_VERIFIED',
    `code=${codeOf(chefTries)}`
  );

  const stray = await gql(
    `mutation ($id: ID!) {
       thibitisha_matumizi_kundi(zingumiaji_id: $id, kuchagua: [{ id: 999999, kiasi_halisi: 1 }]) { id }
     }`,
    recipientToken,
    { id: sheetId }
  );
  check('a line from another sheet is rejected', !!errOf(stray), 'no error raised');

  // ---- BR-13: the request cannot be closed without moving the stock -------
  // A second sheet, left open on purpose, so the guard can be tried against a
  // request that is still genuinely waiting. Closing this one with the generic
  // mutation would be the incoherence BR-13 exists to remove: the request says
  // the usage is handled, the sheet is still unconfirmed, and the stock on the
  // shelf is still whatever the chef guessed.
  const order2 = (
    await sql(
      `INSERT INTO agizo_maalum (ladha, mapishi_id, bei_jumla, hali, tarehe_ya_kuchukua, created_by)
       VALUES ($1, (SELECT id FROM mapishi ORDER BY id LIMIT 1), 50000, 'ordered', CURRENT_DATE, $2) RETURNING id`,
      [`${PREFIX} Order2`, staff.chef]
    )
  )[0];
  created.agizo.push(order2.id);

  const report2 = await gql(
    `mutation ($input: MatumiziKundiInput!) {
       log_matumizi_kundi(input: $input) { id zingumiaji { id } }
     }`,
    chef,
    {
      input: {
        agizo_id: order2.id,
        vitu: [{ malighafi_id: ing.id, kiasi_cha_chini: 1, kiasi_cha_juu: 1, hali_sheeti: 'imechaguliwa' }],
      },
    }
  );
  const sheet2 = report2.data?.log_matumizi_kundi?.[0]?.zingumiaji?.id;
  check('a second open sheet was raised for the guard check', !!sheet2, `sheet=${sheet2}`);

  const stockBeforeGuard = await onHand(ing.id);
  const shortcut = await gql(
    `mutation ($id: ID!) { kamilisha_ombi(id: $id, jibu: "nimemaliza") { id hali } }`,
    recipientToken,
    { id: (await sql(`SELECT id FROM ombi WHERE zingumiaji_id = $1`, [sheet2]))[0]?.id }
  );
  check(
    'BR-13: a usage request cannot be closed with the generic mutation',
    codeOf(shortcut) === 'FORBIDDEN',
    `code=${codeOf(shortcut)} msg=${msgOf(shortcut)}`
  );
  const sheet2State = await sql('SELECT hali FROM zingumiaji_matumizi WHERE id = $1', [sheet2]);
  check(
    'the sheet is still unconfirmed after the shortcut attempt',
    sheet2State[0]?.hali === 'inakadiriwa',
    `hali=${sheet2State[0]?.hali}`
  );
  check(
    'and no stock moved',
    (await onHand(ing.id)) === stockBeforeGuard,
    `on_hand=${stockBeforeGuard} -> ${await onHand(ing.id)}`
  );

  // Clearing it the sanctioned way proves the sheet was still answerable, so
  // the guard above blocked the shortcut rather than having broken the flow.
  const viaConfirm = await gql(
    `mutation ($id: ID!) { thibitisha_matumizi_kundi(zingumiaji_id: $id) { id hali } }`,
    recipientToken,
    { id: sheet2 }
  );
  check(
    'the sheet can still be confirmed the proper way',
    viaConfirm.data?.thibitisha_matumizi_kundi?.hali === 'imethibitishwa',
    `hali=${viaConfirm.data?.thibitisha_matumizi_kundi?.hali}`
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

  console.log(`\n  BR-13 usage-request: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  failures:');
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

(async () => {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://localhost:5432/cakecity',
  });
  await run();
  await pool.end();
})();
