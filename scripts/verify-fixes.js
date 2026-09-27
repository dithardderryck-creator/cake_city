/**
 * End-to-end verification of the backend fix list.
 *
 *   node scripts/verify-fixes.js
 *
 * Drives the running API over HTTP (start it with `npm start` first) and
 * asserts each fixed broken path. Every check is written so it FAILS on the
 * old behaviour, so this doubles as a regression test: revert a fix and the
 * corresponding check goes red.
 *
 * Test data is created and removed around each case. Nothing is left behind.
 */

   const { readFileSync } = require('fs');
   const { join } = require('path');
   const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;

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

   async function gql(query, token, variables) {
     const res = await fetch(GRAPHQL, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         ...(token ? { Authorization: `Bearer ${token}` } : {}),
       },
       body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
     });
     return res.json();
   }

const errOf = (json) => json?.errors?.[0];
const codeOf = (json) => errOf(json)?.extensions?.code;
const msgOf = (json) => errOf(json)?.message || '';

/** Direct DB access, for arranging and asserting state the API won't expose. */
let pool;
async function sql(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  require('dotenv').config({ quiet: true });
  pool = require('../src/db/pool');

  // The owner PIN is read from .env, never hardcoded. An earlier version of this
  // file had the real PIN inlined, which put a live credential into git history
  // and onto the remote.
  const ownerPin = process.env.CAKE_OWNER_PIN;
  if (!ownerPin) {
    console.error('\nCAKE_OWNER_PIN is not set. Add it to .env before running this suite.\n');
    process.exit(1);
  }
  // A throwaway PIN for the staff accounts this suite creates, so it never
  // depends on -- or collides with -- anyone's real password.
  const FIXTURE_PIN = 'vf7391';
  // Shared by every throwaway product this suite creates. Cleanup finds the
  // sales it made through this family rather than through receipt numbers.
  const FIXTURE_FAMILY = 'ZZVerify';

  console.log(`\nVerifying fixes against ${BASE}\n`);

  // Reachability gate.
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`\nCannot reach ${BASE}/health. Start the server first: npm start\n`);
    process.exit(1);
  }

  // ---- J2: health actually checks the database -------------------------
  const healthBody = await health.json();
  check('J2 /health reports database status', healthBody.database === 'ok', JSON.stringify(healthBody));

  // Log in FIRST, before any deliberate lockout test. The lockout is
  // per-account AND per-IP, so a failed-login test would otherwise lock this
  // very process out of every later check.
  const good = await gql(`mutation{login(id:1,pin:"${ownerPin}"){token}}`);
  const ownerToken = good?.data?.login?.token;
  check('owner can log in', !!ownerToken, msgOf(good));

  if (!ownerToken) {
    if (codeOf(good) === 'TOO_MANY_ATTEMPTS') {
      console.error(
        '\n  This IP is already locked out from a previous verification run.\n' +
          '  The lockout is held in server memory for 15 minutes — restart the\n' +
          '  API (npm start) and run this again.\n'
      );
      await pool.end();
      process.exit(1);
    }
    await pool.end();
    process.exit(1);
  }

  // ---- Arrange: a custom order with a ticket ---------------------------
  const order = await gql(
    `mutation{unda_agizo(input:{ladha:"ZZTest",ukubwa:"ZZTest",tarehe_ya_kuchukua:"2030-01-01",bei_jumla:1000,malipo_ya_awali:0}){id hali salio tikiti{id namba}}}`,
    ownerToken
  );
  const orderId = order?.data?.unda_agizo?.id;
  const ticketId = order?.data?.unda_agizo?.tikiti?.id;
  check('fixture: custom order created with a ticket', !!orderId && !!ticketId, JSON.stringify(order).slice(0, 200));

  // ---- B1: a cancelled order cannot be collected back to life ----------
  await gql(`mutation{futa_agizo(id:${orderId})}`, ownerToken);
  const revive = await gql(`mutation{chukua_agizo(id:${orderId}){id hali}}`, ownerToken);
  check('B1 chukua_agizo refuses a cancelled order', codeOf(revive) === 'BAD_REQUEST', `${codeOf(revive)} ${msgOf(revive)}`);
  const stillCancelled = await sql('SELECT hali FROM agizo_maalum WHERE id=$1', [orderId]);
  check('B1 cancelled order stayed cancelled', stillCancelled[0]?.hali === 'cancelled', stillCancelled[0]?.hali);

  // ---- B2: cancelling a ticket cancels its order ------------------------
  const order2 = await gql(
    `mutation{unda_agizo(input:{ladha:"ZZTest",ukubwa:"ZZTest",tarehe_ya_kuchukua:"2030-01-01",bei_jumla:500,malipo_ya_awali:0}){id tikiti{id}}}`,
    ownerToken
  );
  const order2Id = order2?.data?.unda_agizo?.id;
  const ticket2Id = order2?.data?.unda_agizo?.tikiti?.id;
  await gql(`mutation{futa_tikiti(id:${ticket2Id})}`, ownerToken);
  const linked = await sql('SELECT hali FROM agizo_maalum WHERE id=$1', [order2Id]);
  check('B2 futa_tikiti cascade-cancels the linked order', linked[0]?.hali === 'cancelled', linked[0]?.hali);
  const kitchen = await gql('{order_kwajikoni{id}}', ownerToken);
  check('B2 cancelled order leaves the kitchen queue', !(kitchen?.data?.order_kwajikoni || []).some((o) => o.id === order2Id));

  // ---- D1: cancelled orders excluded from money owed -------------------
  const dash = await gql('{riport_dashboard{salio_jumla_ajira maagizo_ambayo_hajakusanywa{id hali}}}', ownerToken);
  const listed = dash?.data?.riport_dashboard?.maagizo_ambayo_hajakusanywa || [];
  check('D1 dashboard balance list excludes cancelled', !listed.some((o) => o.hali === 'cancelled'), JSON.stringify(listed.map((o) => o.hali)));
  const directSum = await sql(
    "SELECT COALESCE(SUM(salio),0)::float AS s FROM agizo_maalum WHERE hali NOT IN ('collected','cancelled')"
  );
  const apiSum = dash?.data?.riport_dashboard?.salio_jumla_ajira;
  check('D1 money-owed total matches the filter', Math.abs(Number(apiSum) - Number(directSum[0].s)) < 0.01, `api=${apiSum} sql=${directSum[0].s}`);

  // ---- C1/C2: validation rejects nonsense before the DB ----------------
  // A throwaway product, so these checks do not depend on any particular
  // product id existing. They used to hardcode bidhaa_id:1, which made the
  // suite fail outright on a fresh install instead of testing the validation.
  const mkProduct = await gql(
    `mutation{bathi_bidhaa(input:{jina:"ZZ Verify Product C1",bei:1000,familia:"${FIXTURE_FAMILY}",ukubwa:"pcs"}){id}}`,
    ownerToken
  );
  const c1ProductId = mkProduct?.data?.bathi_bidhaa?.id;
  check('C1 fixture: throwaway product created', Boolean(c1ProductId), msgOf(mkProduct));

  // NjiaMalipo is a GraphQL enum, so its values are unquoted literals.
  const negQty = await gql(
    `mutation{unda_mauzo(bidhaa:[{bidhaa_id:${c1ProductId},kiasi:-2}],njia_ya_malipo:cash){id}}`,
    ownerToken
  );
  check('C1 negative line-item quantity rejected', codeOf(negQty) === 'BAD_REQUEST', `${codeOf(negQty)} ${msgOf(negQty)}`);

  const negDiscount = await gql(
    `mutation{unda_mauzo(bidhaa:[{bidhaa_id:${c1ProductId},kiasi:1}],njia_ya_malipo:cash,punguzo:-500){id}}`,
    ownerToken
  );
  check('C1 negative discount rejected', codeOf(negDiscount) === 'BAD_REQUEST', `${codeOf(negDiscount)} ${msgOf(negDiscount)}`);

  // Hard delete, not futa_bidhaa: that is a soft delete, so the row survives
  // and the next run of this suite collides with the UNIQUE(familia, ukubwa)
  // index and fails on its own leftovers. A throwaway fixture should leave
  // nothing behind.
  await sql('DELETE FROM bidhaa WHERE id = $1', [c1ProductId]);

  const depositTooBig = await gql(
    `mutation{unda_agizo(input:{ladha:"ZZTest",ukubwa:"ZZTest",tarehe_ya_kuchukua:"2030-01-01",bei_jumla:1000,malipo_ya_awali:5000}){id}}`,
    ownerToken
  );
  check('C2 deposit above total rejected', codeOf(depositTooBig) === 'BAD_REQUEST', `${codeOf(depositTooBig)} ${msgOf(depositTooBig)}`);

  // ---- C1: DB-level CHECK is a real backstop ---------------------------
  // malighafi is deliberately NOT in this list and has no CHECK on stock.
  // Stock may legitimately go negative: the chef's log is an estimate, and
  // verification records the real number even when it exceeds what we had.
  // The negative balance is the signal that we were under-stocked.
  const constraints = await sql(
    `SELECT conname FROM pg_constraint WHERE contype='c'
      AND conrelid::regclass::text IN ('mauzo_bidhaa','kumbukumbu_matumizi','marekebisho_hisa','agizo_maalum')`
  );
  const names = constraints.map((c) => c.conname);
  check('C1 CHECK constraints installed', names.length >= 4, names.join(', '));
  const stockChecks = await sql(
    `SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid='malighafi'::regclass`
  );
  check('C1 stock has no floor CHECK (negative is a valid signal)', stockChecks.length === 0, stockChecks.map((c) => c.conname).join(', '));

  // ---- C3: a chef's log is an estimate and must not move stock ---------
  // This replaced an older rule that refused usage beyond available stock.
  // The chef logs what they think they used, from the bench, mid-batch.
  // Refusing there just taught people to under-report. Stock moves only when
  // inventory verifies, and then it records the real number even if that
  // drives the balance negative.
  const ing = await sql(
    `INSERT INTO malighafi (jina,kiasi_kilichopo,kiwango_cha_chini,unit) VALUES ('ZZ-VERIFY',5,10,'kg') RETURNING id`
  );
  const ingId = ing[0].id;
  // Both fixture orders above were cancelled on purpose, so make a fresh live
  // order to hang the usage log off.
  const liveOrderRes = await gql(
    `mutation{unda_agizo(input:{ladha:"ZZTest",ukubwa:"ZZTest",tarehe_ya_kuchukua:"2030-01-01",bei_jumla:300,malipo_ya_awali:0}){id}}`,
    ownerToken
  );
  const usageOrderId = liveOrderRes?.data?.unda_agizo?.id;
  check('fixture: live order for usage logging', !!usageOrderId, msgOf(liveOrderRes));
  const over = await gql(
    `mutation{log_matumizi(input:{agizo_id:${usageOrderId},malighafi_id:${ingId},kiasi:999}){id}}`,
    ownerToken
  );
  check('C3 logging beyond stock is allowed (it is only an estimate)', !over.errors, msgOf(over));
  const negUsage = await gql(
    `mutation{log_matumizi(input:{agizo_id:${usageOrderId},malighafi_id:${ingId},kiasi:-1}){id}}`,
    ownerToken
  );
  check('C1 negative usage quantity rejected', codeOf(negUsage) === 'BAD_REQUEST', `${codeOf(negUsage)} ${msgOf(negUsage)}`);
  const after = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id=$1', [ingId]);
  check('C3 logging did not move stock', Number(after[0].kiasi_kilichopo) === 5, after[0].kiasi_kilichopo);

  // ---- C3b: verification is what moves stock, and may go negative ------
  const loggedId = over?.data?.log_matumizi?.id;
  if (loggedId) {
    const verified = await gql(
      `mutation{thibitisha_matumizi(id:${loggedId},kiasi_halisi:8){id hali kiasi_halisi}}`,
      ownerToken
    );
    check('C3b verification accepted and marks the row verified',
      verified?.data?.thibitisha_matumizi?.hali === 'imethibitishwa', msgOf(verified));
    const afterVerify = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id=$1', [ingId]);
    check('C3b verification moved stock by the real amount (5 - 8 = -3)',
      Number(afterVerify[0].kiasi_kilichopo) === -3, afterVerify[0].kiasi_kilichopo);
    const twice = await gql(
      `mutation{thibitisha_matumizi(id:${loggedId},kiasi_halisi:8){id}}`,
      ownerToken
    );
    check('C3b verifying twice is refused (no double decrement)', !!twice.errors, msgOf(twice));
    const afterTwice = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id=$1', [ingId]);
    check('C3b stock unchanged by the refused second verification',
      Number(afterTwice[0].kiasi_kilichopo) === -3, afterTwice[0].kiasi_kilichopo);
  }

  const negWaste = await gql(
    `mutation{marekebisho_hisa(input:{malighafi_id:${ingId},aina:waste,kiasi:-3,sababu:"v"}){id}}`,
    ownerToken
  );
  check('C1 negative waste rejected', codeOf(negWaste) === 'BAD_REQUEST', `${codeOf(negWaste)} ${msgOf(negWaste)}`);

  // ---- B3: the last owner cannot be demoted ----------------------------
  const demote = await gql(`mutation{hariri_mfanyakazi(id:1,input:{jukumu:cashier}){id jukumu}}`, ownerToken);
  check('B3 last owner cannot be demoted', codeOf(demote) === 'BAD_REQUEST', `${codeOf(demote)} ${msgOf(demote)}`);
  const stillOwner = await sql('SELECT jukumu FROM mtumiaji WHERE id=1');
  check('B3 owner kept their role', stillOwner[0]?.jukumu === 'owner', stillOwner[0]?.jukumu);

  // ---- B4: a deactivated account loses access immediately ---------------
  // Jukumu is a GraphQL enum, so its value is an unquoted literal.
  const chef = await gql(`mutation{ongeza_mfanyakazi(jina:"ZZ Verify Chef",jukumu:chef,pin:"${FIXTURE_PIN}"){id}}`, ownerToken);
  const chefId = chef?.data?.ongeza_mfanyakazi?.id;
  check('fixture: new staff account created', !!chefId, msgOf(chef));
  const chefLogin = chefId ? await gql(`mutation{login(id:${chefId},pin:"${FIXTURE_PIN}"){token}}`) : {};
  const chefToken = chefLogin?.data?.login?.token;
  check('fixture: new staff can log in', !!chefToken, msgOf(chefLogin));
  const before = chefToken ? await gql('{hisa{items{id}}}', chefToken) : {};
  check('B4 new staff can use the API', !!before?.data, msgOf(before));

  await gql(`mutation{futa_mfanyakazi(id:${chefId})}`, ownerToken);
  const afterDeactivate = await gql('{hisa{items{id}}}', chefToken);
  check('B4 deactivated token rejected immediately', codeOf(afterDeactivate) === 'UNAUTHENTICATED', `${codeOf(afterDeactivate)} ${msgOf(afterDeactivate)}`);

  // ---- G1: permission checks actually gate -----------------------------
  // This suite creates its own cashier. It used to look for any cashier already
  // in the database, which meant the whole check was silently skipped on a
  // fresh install — the one case where a broken permission check is most likely
  // to go unnoticed.
  const fixtureName = 'ZZ Verify Cashier G1';
  await sql(`DELETE FROM mtumiaji WHERE jina = $1`, [fixtureName]);
  const mkCashier = await gql(
    `mutation{ongeza_mfanyakazi(jina:"${fixtureName}",jukumu:cashier,pin:"${FIXTURE_PIN}"){id}}`,
    ownerToken
  );
  const cashierId = mkCashier?.data?.ongeza_mfanyakazi?.id;
  check('G1 fixture: cashier created', Boolean(cashierId), msgOf(mkCashier));
  if (cashierId) {
    const cLogin = await gql(`mutation{login(id:${cashierId},pin:"${FIXTURE_PIN}"){token}}`);
    const cToken = cLogin?.data?.login?.token;
    check('G1 fixture: cashier can log in', Boolean(cToken), msgOf(cLogin));
    if (cToken) {
      const forbidden = await gql('{marekebisho_hisa{id}}', cToken);
      check('G1 staff without permission get FORBIDDEN (not a dead-code fallthrough)', codeOf(forbidden) === 'FORBIDDEN', `${codeOf(forbidden)} ${msgOf(forbidden)}`);
    }
    await sql(`DELETE FROM mtumiaji WHERE jina = $1`, [fixtureName]);
  }
  const unauth = await gql('{marekebisho_hisa{id}}');
  check('G1 anonymous caller gets UNAUTHENTICATED', codeOf(unauth) === 'UNAUTHENTICATED', codeOf(unauth));

  // ---- J5: no stack traces leak to the client --------------------------
  const leak = await gql('mutation{hariri_mfanyakazi(id:1,input:{jukumu:cashier}){id}}', ownerToken);
  check('J5 no stacktrace in client error payload', !errOf(leak)?.extensions?.stacktrace, 'stacktrace present');

  // ---- E2: "today" follows Tanzania, not the host clock ---------------
  const tz = await sql('SHOW timezone');
  check('E2 Postgres session runs in Africa/Dar_es_Salaam', tz[0]?.TimeZone === 'Africa/Dar_es_Salaam', tz[0]?.TimeZone);
  const week = await gql('{riport_dashboard{mauzo_7_siku{tarehe}}}', ownerToken);
  const days = week?.data?.riport_dashboard?.mauzo_7_siku || [];
  check('E2 7-day axis always returns 7 days', days.length === 7, `got ${days.length}`);
  const todayRow = await sql("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d");
  const lastKey = String(days[days.length - 1]?.tarehe || '').slice(0, 10);
  check('E2 last day of the axis is Postgres CURRENT_DATE', lastKey === todayRow[0].d, `${lastKey} vs ${todayRow[0].d}`);

  // ---- H1: sale timestamp is actually selectable -----------------------
  const withTs = await gql('{mauzo_ya_leo{id created_at}}', ownerToken);
  check('H1 mauzo_ya_leo exposes created_at', withTs?.errors === undefined, msgOf(withTs));

  // ---- Ingredient history must be derived, not invented -----------------
  // The stock screen used to draw a 14-day "actual" line by walking backwards
  // from the current quantity at the current usage rate, which fabricated a
  // fortnight of trading from whatever data happened to exist. These checks pin
  // the replacement: the series is anchored to the stored quantity, carries one
  // point per day that actually moved, and agrees with the ledger to the cent.
  const detail = await gql(
    `query{maelezo_malighafi(id:${ingId}){malighafi{kiasi_kilichopo}
       vipengele{aina kiasi mabadiliko}
       mapishi{ladha}
       mwenendo{tarehe mabadiliko kiasi}}}`,
    ownerToken
  );
  const md = detail?.data?.maelezo_malighafi;
  check('S1 maelezo_malighafi returns the ingredient', Boolean(md), msgOf(detail));

  const moves = md?.vipengele || [];
  const usageMoves = moves.filter((v) => v.aina === 'matumizi');
  // The fixture verified 8 against a starting balance of 5, so stock is left
  // negative on purpose. Negative stock is a real signal, not an error, and the
  // ledger has to carry it faithfully rather than clamping it away.
  check(
    'S1 confirmed usage appears in the ledger at the verified amount',
    usageMoves.some((v) => Math.abs(v.kiasi - 8) < 1e-9),
    JSON.stringify(moves.map((v) => `${v.aina}:${v.kiasi}`))
  );
  check(
    'S1 usage reduces stock in the ledger',
    usageMoves.every((v) => v.mabadiliko < 0),
    JSON.stringify(usageMoves.map((v) => v.mabadiliko))
  );
  check(
    'S1 the ledger can carry stock below zero without being clamped',
    Math.abs((md?.malighafi?.kiasi_kilichopo ?? 0) - -3) < 1e-9,
    `stored ${md?.malighafi?.kiasi_kilichopo}, expected -3`
  );
  check(
    'S1 a restock would increase stock in the ledger',
    moves.filter((v) => v.aina !== 'matumizi').every((v) => v.mabadiliko > 0),
    JSON.stringify(moves.map((v) => `${v.aina}:${v.mabadiliko}`))
  );

  // Every ledger line must be present in the daily series, and the series must
  // sum to the same net movement. A dropped line here is what makes a chart lie.
  const dayNet = (md?.mwenendo || []).reduce((a, d) => a + d.mabadiliko, 0);
  const ledgerNet = moves.reduce((a, v) => a + v.mabadiliko, 0);
  check(
    'S1 daily series accounts for every ledger movement',
    Math.abs(dayNet - ledgerNet) < 1e-6,
    `series ${dayNet} vs ledger ${ledgerNet}`
  );

  const lastDay = (md?.mwenendo || []).at(-1);
  check(
    'S1 last plotted balance equals the stored quantity',
    lastDay && Math.abs(lastDay.kiasi - md.malighafi.kiasi_kilichopo) < 1e-9,
    lastDay ? `${lastDay.kiasi} vs ${md.malighafi.kiasi_kilichopo}` : 'no points'
  );
  check(
    'S1 no duplicate day points (one bucket per calendar day)',
    new Set((md?.mwenendo || []).map((d) => d.tarehe)).size === (md?.mwenendo || []).length,
    JSON.stringify((md?.mwenendo || []).map((d) => d.tarehe))
  );
  check(
    'S1 mwenendo is oldest first',
    (md?.mwenendo || []).every((d, i, a) => i === 0 || a[i - 1].tarehe <= d.tarehe),
    JSON.stringify((md?.mwenendo || []).map((d) => d.tarehe))
  );

  // An ingredient nobody has touched yet must still anchor on today rather
  // than returning an empty series the chart cannot draw.
  const untouched = await sql(
    `INSERT INTO malighafi (jina,kiasi_kilichopo,kiwango_cha_chini,unit) VALUES ('ZZ-UNTOUCHED',7,2,'kg') RETURNING id`
  );
  const untouchedId = untouched[0].id;
  const uDetail = await gql(
    `query{maelezo_malighafi(id:${untouchedId}){vipengele{id} mwenendo{tarehe mabadiliko kiasi}}}`,
    ownerToken
  );
  const ud = uDetail?.data?.maelezo_malighafi;
  check('S1 an untouched ingredient has an empty ledger', (ud?.vipengele || []).length === 0, msgOf(uDetail));
  check(
    'S1 an untouched ingredient still anchors on today',
    (ud?.mwenendo || []).length === 1 && (ud?.mwenendo || [])[0].kiasi === 7,
    JSON.stringify(ud?.mwenendo)
  );
    const missing = await gql(`query{maelezo_malighafi(id:99999999){malighafi{id}}}`, ownerToken);
    check('S1 unknown ingredient is NOT_FOUND', codeOf(missing) === 'NOT_FOUND', codeOf(missing));
    await sql('DELETE FROM malighafi WHERE id=$1', [untouchedId]);

    // ---- The drawer must match the field set the screen actually asks for ---
    // The ingredient drawer selects a specific set of fields, and three of them
    // were once returned in a shape the screen could not render: the ledger id
    // came back as a bare number, `mwingilieji` came back as a string where the
    // screen expects an object, and `mapishi_id` was missing outright. GraphQL
    // does not error on any of that, because the schema was satisfied — the
    // breakage only showed up as blank cells in the table.
    //
    // Restating those fields here would just be a fourth copy to forget to
    // update, so this runs the operation straight out of the frontend file. If
    // the screen asks for a new field, the next run of this suite checks it too.
    const queriesSrc = readFileSync(join(__dirname, '..', 'web', 'src', 'graphql', 'queries.js'), 'utf8');
    const op = queriesSrc.match(/export const MALEZO_MALIGHAFI = gql`([\s\S]*?)`/);
    check('S1 the frontend MALEZO_MALIGHAFI operation can be located', Boolean(op), 'not found in queries.js');

    if (op) {
      const live = await gql(op[1], ownerToken, { id: ingId });
      const err = msgOf(live);
      check('S1 the frontend operation runs without a GraphQL error', !live?.errors, err);
      const fd = live?.data?.maelezo_malighafi;
      check('S1 the frontend operation returns the ingredient', Boolean(fd), err);
      check(
        'S1 the frontend reads the ingredient id, name and unit',
        // `id` is an ID, and GraphQL always serialises ID as a string. The drawer
        // keys off it and compares it against the same field from HISA, so the
        // only thing that matters is that both sides agree on the type and that
        // it is the ingredient asked for.
        fd?.malighafi?.id === String(ingId) &&
          Boolean(fd?.malighafi?.jina) &&
          Boolean(fd?.malighafi?.unit),
        JSON.stringify(fd?.malighafi)
      );
      // Every ledger line is rendered as a row, so each of these has to be the
      // type the table expects. `id` in particular is used as a React key and to
      // tell two lines apart: namespaced ids, not a per-table row number that
      // restarts at 1 for each of the two ledgers the drawer merges together.
      const rows = fd?.vipengele || [];
      check(
        'S1 every ledger line has a usable id',
        rows.length > 0 && rows.every((r) => typeof r.id === 'string' && /^(matumizi|restock)-/.test(r.id)),
        JSON.stringify(rows.map((r) => r.id))
      );
      check(
        'S1 ids are unique across the two ledgers',
        new Set(rows.map((r) => r.id)).size === rows.length,
        JSON.stringify(rows.map((r) => r.id))
      );
      check(
        'S1 the person behind a movement is an object, not a bare name',
        rows.length > 0 && rows.every((r) => r.mwingilieji === null || typeof r.mwingilieji === 'object'),
        JSON.stringify(rows.map((r) => r.mwingilieji))
      );
      check(
        'S1 a movement carries the date and reason the row displays',
        rows.every((r) => Boolean(r.tarehe) && typeof r.sababu === 'string'),
        JSON.stringify(rows.map((r) => [r.tarehe, r.sababu]))
      );
      check(
        'S1 the recipe usage is keyed by id so the drawer can link it',
        (fd?.mapishi || []).every((m) => typeof m.mapishi_id === 'number' && Boolean(m.ladha)),
        JSON.stringify(fd?.mapishi)
      );
      check(
        'S1 the daily series is shaped for the chart',
        (fd?.mwenendo || []).every((d) => Boolean(d.tarehe) && typeof d.mabadiliko === 'number'),
        JSON.stringify(fd?.mwenendo)
      );
    }


  // ---- Date filters must narrow both ledgers ---------------------------
  const narrow = await gql(
    `{marekebisho_hisa(tarehe_kutoka:"1990-01-01",tarehe_kutia:"1990-01-02"){id}
      kumbukumbu_matumizi(tarehe_kutoka:"1990-01-01",tarehe_kutia:"1990-01-02"){id}}`,
    ownerToken
  );
  check(
    'S1 an empty date window returns nothing',
    narrow?.errors === undefined &&
      (narrow?.data?.marekebisho_hisa || []).length === 0 &&
      (narrow?.data?.kumbukumbu_matumizi || []).length === 0,
    msgOf(narrow)
  );
  // Omitting the dates has to keep returning everything, or the existing
  // Chef/Owner screens that call these queries with no arguments would silently
  // start showing a truncated ledger.
  const unfiltered = await gql('{marekebisho_hisa{id} kumbukumbu_matumizi{id}}', ownerToken);
  const truth = await sql(
    `SELECT (SELECT count(*) FROM marekebisho_hisa)::int AS m, (SELECT count(*) FROM kumbukumbu_matumizi)::int AS k`
  );
  check(
    'S1 omitting the dates still returns the full ledger (back-compatible)',
    (unfiltered?.data?.marekebisho_hisa || []).length === truth[0].m &&
      (unfiltered?.data?.kumbukumbu_matumizi || []).length === truth[0].k,
    `api ${(unfiltered?.data?.marekebisho_hisa || []).length}/${(unfiltered?.data?.kumbukumbu_matumizi || []).length} vs sql ${truth[0].m}/${truth[0].k}`
  );

  // ---- Cleanup ---------------------------------------------------------
  await sql('DELETE FROM marekebisho_hisa WHERE malighafi_id=$1', [ingId]);
  await sql('DELETE FROM kumbukumbu_matumizi WHERE malighafi_id=$1', [ingId]);
  await sql('DELETE FROM malighafi WHERE id=$1', [ingId]);
  // Reminders are matched by what they point at, never table-wide. A bare
  // DELETE FROM ukumbusho here would quietly discard the shop's real
  // order reminders every time the suite was run.
  await sql(
    `DELETE FROM ukumbusho
     WHERE agizo_id IN (SELECT id FROM agizo_maalum WHERE ladha = $1)
        OR malighafi_id = $2`,
    ['ZZTest', ingId]
  );
  // Remove every fixture row by marker, children first, so the run is
  // repeatable regardless of how many fixtures a check needed.
  await sql(
    `DELETE FROM tikiti WHERE agizo_id IN (SELECT id FROM agizo_maalum WHERE ladha = $1)
      OR mauzo_id IN (SELECT mb.mauzo_id FROM mauzo_bidhaa mb
                      JOIN bidhaa b ON b.id = mb.bidhaa_id WHERE b.familia = $2)`,
    ['ZZTest', FIXTURE_FAMILY]
  );
  // Sales are matched through their own line items, never by receipt-number
  // prefix. Retail receipts are generated as RS-<timestamp>-<rand>, so a
  // LIKE 'RS-%' match is indistinguishable from real trading and would
  // delete the shop's entire retail history on every test run.
  await sql(
    `DELETE FROM mauzo WHERE id IN (SELECT mb.mauzo_id FROM mauzo_bidhaa mb
       JOIN bidhaa b ON b.id = mb.bidhaa_id WHERE b.familia = $1)`,
    [FIXTURE_FAMILY]
  );
  await sql('DELETE FROM agizo_maalum WHERE ladha=$1', ['ZZTest']);
  await sql("DELETE FROM mtumiaji WHERE jina='ZZ Verify Chef'");

  // ---- A1/K1: brute-force lockout. Runs LAST on purpose — it locks this
  // IP out by design, so no later check could authenticate.
  //
  // It locks a throwaway account rather than the real owner (id 1). Locking
  // the owner would leave the running shop unable to log in after a test run,
  // and would stop any other suite from authenticating until the server was
  // restarted. The lockout is per-account AND per-IP, so a dedicated fixture
  // still exercises the real per-IP throttle.
  console.log('\n  (lockout test runs last: it deliberately locks this IP out)');
  const lockoutUser = await gql(
    `mutation{ongeza_mfanyakazi(jina:"ZZ Verify Lockout",jukumu:cashier,pin:"${FIXTURE_PIN}"){id}}`,
    ownerToken
  );
  const lockoutId = lockoutUser?.data?.ongeza_mfanyakazi?.id;
  check('fixture: throwaway account for the lockout test', !!lockoutId, msgOf(lockoutUser));

  let lastFail = null;
  for (let i = 0; i < 4; i += 1) lastFail = await gql(`mutation{login(id:${lockoutId},pin:"0000"){token}}`);
  check('A1 wrong PIN uses UNAUTHENTICATED, not UNAUTHORIZED', codeOf(lastFail) === 'UNAUTHENTICATED', codeOf(lastFail));
  check('A1 wrong PIN message is Kiswahili', /PIN/i.test(msgOf(lastFail)), msgOf(lastFail));
  check('A1 reports remaining attempts', /Majaribio 1/.test(msgOf(lastFail)), msgOf(lastFail));

  const lockMsg = await gql(`mutation{login(id:${lockoutId},pin:"0000"){token}}`);
  check('A1 5th failure locks the account out', /umefungiwa/i.test(msgOf(lockMsg)), msgOf(lockMsg));

  const correctButLocked = await gql(`mutation{login(id:${lockoutId},pin:"${FIXTURE_PIN}"){token}}`);
  check('A1 correct PIN refused while locked out', codeOf(correctButLocked) === 'TOO_MANY_ATTEMPTS', `${codeOf(correctButLocked)} ${msgOf(correctButLocked)}`);

  // The lockout is per-account AND per-IP, and the per-IP counter is what a
  // real deployment relies on to stop one machine grinding many accounts. It
  // therefore also blocks every other login from this address for the window,
  // which no test can avoid. So the owner login is expected to fail here.
  // What matters is that the throwaway account is what got locked, not the
  // real owner, and that the state is in-memory and clears on restart.
  const ownerDuring = await gql(`mutation{login(id:1,pin:"${ownerPin}"){token}}`);
  check(
    'A1 this IP is throttled by design after the lockout test',
    codeOf(ownerDuring) === 'TOO_MANY_ATTEMPTS',
    `${codeOf(ownerDuring)} ${msgOf(ownerDuring)}`
  );
  const ownerAccountIntact = await sql('SELECT active FROM mtumiaji WHERE id = 1');
  check('A1 the real owner account itself is not locked', ownerAccountIntact[0]?.active === true);

  await sql("DELETE FROM mtumiaji WHERE jina IN ('ZZ Verify Chef','ZZ Verify Lockout')");
  console.log('  (lockout state is in-memory: restart the API before the next suite)');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log('');
  }
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nVerification crashed:', err);
  if (pool) await pool.end().catch(() => {});
  process.exit(1);
});
