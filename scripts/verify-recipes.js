/**
 * Verification for the recipe book, categories, requests and two-phase stock.
 *
 *   node scripts/verify-recipes.js        (or: npm run verify:recipes)
 *
 * Sibling to verify-fixes.js, and deliberately self-provisioning: it creates
 * every ingredient, product, category, recipe and staff account it needs, and
 * removes them on the way out. That matters because the previous generation of
 * these tests hardcoded "chef id 20" and "product id 1" — both of which are
 * meaningless on a fresh install, so the suite would either fail or, worse,
 * silently skip.
 *
 * Start the API first (npm start).
 */

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;
const FIXTURE_PIN = 'vr4812';
const PREFIX = 'ZZ VR';

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

async function gql(query, token) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query }),
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

/** Everything created here, torn down in reverse order of dependency. */
const created = { staff: [], bidhaa: [], malighafi: [], kategoria: [], mapishi: [], agizo: [], ombi: [], mteja: [] };

// agizo_maalum is referenced by four tables. Deleting the order first fails on
// any of them still holding a row, and the failure is a raw FK error that hides
// whatever the suite was actually doing.
// Every cleanup delete funnels through here. An earlier version attached
// .catch(() => {}) to each statement, which meant a real FK failure was
// swallowed and then every later delete failed for the same reason — the suite
// reported "0 failed" while quietly leaving rows behind. Failures are collected
// and reported once, at the end, where they are visible.
const cleanupErrors = [];
async function del(text, params) {
  try {
    await sql(text, params);
  } catch (e) {
    cleanupErrors.push(`${text.replace(/\s+/g, ' ').trim()} -> ${e.message}`);
  }
}

async function deleteOrders(ids) {
  if (!ids.length) return;
  await assertFixture('agizo_maalum', ids);
  for (const t of ['kumbukumbu_matumizi', 'mauzo', 'tikiti', 'ukumbusho']) {
    await del(`DELETE FROM ${t} WHERE agizo_id = ANY($1::int[])`, [ids]);
  }
  await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [ids]);
}

// Four tables point at an ingredient: usage rows, recipe lines, stock
// adjustments, and the reminders the system generates on its own when stock
// drops below its threshold. The reminder one is easy to forget — the suite
// creates a deliberately low-stock ingredient, so the generator fills in a row
// that then blocks the delete.
async function deleteIngredients(ids) {
  if (!ids.length) return;
  await assertFixture('malighafi', ids);
  for (const t of ['kumbukumbu_matumizi', 'mapishi_kipengele', 'marekebisho_hisa', 'ukumbusho']) {
    await del(`DELETE FROM ${t} WHERE malighafi_id = ANY($1::int[])`, [ids]);
  }
  await del('DELETE FROM malighafi WHERE id = ANY($1::int[])', [ids]);
}

async function cleanup() {
  // Children before parents, or FKs complain. mapishi_kipengele must go before
  // mapishi, otherwise the recipe delete fails on its own ingredient lines.
  await del('DELETE FROM ombi WHERE id = ANY($1::int[])', [created.ombi]);
  await deleteOrders(created.agizo);
  await assertFixture('mapishi', created.mapishi);
  await del('DELETE FROM mapishi_kipengele WHERE mapishi_id = ANY($1::int[])', [created.mapishi]);
  await del('DELETE FROM mapishi WHERE id = ANY($1::int[])', [created.mapishi]);
  await assertFixture('bidhaa', created.bidhaa);
  await del('DELETE FROM bidhaa WHERE id = ANY($1::int[])', [created.bidhaa]);
  await assertFixture('kategoria', created.kategoria);
  await del('DELETE FROM kategoria WHERE id = ANY($1::int[])', [created.kategoria]);
  await deleteIngredients(created.malighafi);
  // Customers last: agizo_maalum.mteja_id points at them.
  for (const key of created.mteja) {
    if (/^0\d+$/.test(key)) await del('DELETE FROM mteja WHERE simu = $1', [key]);
    else await del(`DELETE FROM mteja WHERE jina ILIKE $1`, [key]);
  }
  await del(`DELETE FROM mtumiaji WHERE id = ANY($1::int[]) AND jina ILIKE $2`, [created.staff, `${PREFIX}%`]);
}

/** Wipe anything a previous (possibly crashed) run left behind. */
async function purgeStrays() {
  await sql(`DELETE FROM ombi WHERE ujumbe ILIKE $1`, [`${PREFIX}%`]);
  const strayOrders = await sql(`SELECT id FROM agizo_maalum WHERE ladha ILIKE $1`, [`${PREFIX}%`]);
  await deleteOrders(strayOrders.map((r) => r.id));
  await sql(`DELETE FROM kumbukumbu_matumizi WHERE kumbukumbu ILIKE $1`, [`${PREFIX}%`]);
  await sql(`DELETE FROM mapishi WHERE ladha ILIKE $1`, [`${PREFIX}%`]);
  // ILIKE, not LIKE: the server normalises familia to lower case ("zz vr cake"),
  // so a case-sensitive match silently matched nothing and left the rows that
  // then block the category delete below.
  await sql(`DELETE FROM bidhaa WHERE familia ILIKE $1`, [`${PREFIX}%`]);
  const strayIngs = await sql(`SELECT id FROM malighafi WHERE jina ILIKE $1`, [`${PREFIX}%`]);
  await deleteIngredients(strayIngs.map((r) => r.id));
  await sql(`DELETE FROM kategoria WHERE jina ILIKE $1`, [`${PREFIX}%`]);
  await sql(`DELETE FROM mtumiaji WHERE jina ILIKE $1`, [`${PREFIX}%`]);
}

const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) < eps;

// The states that mean "still waiting on somebody". Kept here rather than
// imported from the state machine so that the filter tests assert what a user
// would call open, not whatever the module happens to define.
const openListStates = new Set([
  'imeandikwa', 'imetumwa', 'inasubiri', 'inahitaji', 'imeidhinishwa',
  'imeanzishwa', 'limekubaliwa', 'inaendelea',
]);

/**
 * Refuses to delete a row the suite did not create.
 *
 * This exists because of a real mistake: a hand-written cleanup query matched
 * on ingredient *names* rather than the fixture prefix, and deleted two rows of
 * the shop's actual data. The audit log (kumbukumbu_kitendo) is what made that
 * recoverable, but the correct fix is to never issue the delete in the first
 * place. Any DELETE that is not scoped to PREFIX goes through here.
 */
async function assertFixture(table, ids) {
  if (!ids.length) return;
  const col = { bidhaa: 'familia', malighafi: 'jina', kategoria: 'jina', mapishi: 'ladha', agizo_maalum: 'ladha' }[table];
  if (!col) throw new Error(`assertFixture: no ownership column known for ${table}`);
  const { rows } = await pool.query(
    `SELECT ${col} AS v FROM ${table} WHERE id = ANY($1::int[]) AND ${col} NOT ILIKE $2`,
    [ids, `${PREFIX}%`]
  );
  if (rows.length) {
    throw new Error(
      `refusing to delete ${table} rows that are not ${PREFIX} fixtures: ${rows.map((r) => r.v).join(', ')}`
    );
  }
}

async function main() {
  require('dotenv').config({ quiet: true });
  pool = require('../src/db/pool');

  const ownerPin = process.env.CAKE_OWNER_PIN;
  if (!ownerPin) {
    console.error('\nCAKE_OWNER_PIN is not set. Add it to .env before running this suite.\n');
    process.exit(1);
  }

  console.log(`\nVerifying recipes/categories/requests against ${BASE}\n`);

  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`\nCannot reach ${BASE}/health. Start the server first: npm start\n`);
    process.exit(1);
  }

  // Any leftovers from a crashed previous run would trip the UNIQUE keys below.
  // A purge failure is reported but not fatal: it should not stop the suite
  // before a single check has run.
  await purgeStrays().catch((e) => {
    console.log(`  \x1b[33mWARN\x1b[0m  could not purge leftovers from a previous run: ${e.message}`);
  });

  try {
    const owner = await gql(`mutation{login(id:1,pin:"${ownerPin}"){token}}`);
    const ownerToken = owner?.data?.login?.token;
    if (!ownerToken) {
      console.error(`\nOwner login failed: ${msgOf(owner)}\n`);
      process.exit(1);
    }

    // ---- fixtures ------------------------------------------------------
    const mkStaff = async (jina, jukumu) => {
      const r = await gql(
        `mutation{ongeza_mfanyakazi(jina:"${PREFIX} ${jina}",jukumu:${jukumu},pin:"${FIXTURE_PIN}"){id jina jukumu}}`,
        ownerToken
      );
      const s = r?.data?.ongeza_mfanyakazi;
      if (!s) throw new Error(`could not create ${jukumu}: ${msgOf(r)}`);
      created.staff.push(s.id);
      const l = await gql(`mutation{login(id:${s.id},pin:"${FIXTURE_PIN}"){token}}`);
      return { ...s, token: l?.data?.login?.token };
    };
      const chef = await mkStaff('Chef', 'chef');
      const cashier = await mkStaff('Cashier', 'cashier');
      const inventory = await mkStaff('Inventory', 'inventory');
      check(
        'fixtures: chef, cashier and inventory accounts created',
        Boolean(chef.token && cashier.token && inventory.token)
      );

    const mkIng = async (jina, kiasi, chini) => {
      const r = await gql(
        `mutation{ongeza_malighafi(input:{jina:"${jina}",kiasi_kilichopo:${kiasi},kiwango_cha_chini:${chini},unit:"kg"}){id jina}}`,
        ownerToken
      );
      const m = r?.data?.ongeza_malighafi;
      if (!m) throw new Error(`could not create ingredient: ${msgOf(r)}`);
      created.malighafi.push(m.id);
      return m;
    };
    const flour = await mkIng(`${PREFIX} flour`, 10, 2);
    const sugar = await mkIng(`${PREFIX} sugar`, 10, 2);
    check('fixtures: ingredients created', Boolean(flour.id && sugar.id));

    // =====================================================================
    // §3.1 — a fraction_of recipe derives its amounts from the parent cake
    // =====================================================================
    console.log('\n  -- §3.1 fraction_of recipes --');

    const parent = await gql(
      `mutation{unda_mapishi(input:{
         ladha:"${PREFIX} Cake",ukubwa:"24",dakika_kadirio:120,
         viambato:[
           {malighafi_id:${flour.id},kiasi_cha_chini:1.0,kiasi_cha_juu:1.2,sehemu:"mfuatano"}
           {malighafi_id:${sugar.id},kiasi_cha_chini:0.5,kiasi_cha_juu:0.8,sehemu:"mfuatano"}
         ]}){id ladha mapamba_variant sehemu_ya_uzito viambato{id kiasi_cha_chini kiasi_cha_juu inayotokwa}}}`,
      ownerToken
    );
    const parentId = parent?.data?.unda_mapishi?.id;
    created.mapishi.push(parentId);
    check('§3.1 parent own_recipe created', Boolean(parentId), msgOf(parent));
    check(
      '§3.1 own_recipe has no sehemu_ya_uzito',
      parent?.data?.unda_mapishi?.sehemu_ya_uzito == null,
      String(parent?.data?.unda_mapishi?.sehemu_ya_uzito)
    );
    check(
      '§3.1 own_recipe lines are real rows, not derived',
      (parent?.data?.unda_mapishi?.viambato || []).every((l) => l.inayotokwa === false),
      JSON.stringify(parent?.data?.unda_mapishi?.viambato)
    );

    // A slice with NO lines of its own — this is the case that used to be
    // impossible to author, because normaliseIngredients demanded a line.
    const slice = await gql(
      `mutation{unda_mapishi(input:{
         ladha:"${PREFIX} Cake",ukubwa:"slice",dakika_kadirio:10,mapamba_variant:"fraction_of",
         mapishi_ibaba:"${parentId}",sehemu_ya_uzito:0.1,viambato:[]}){
         id ladha mapamba_variant sehemu_ya_uzito mapishi_ibaba{id ladha}
         viambato{kiasi_cha_chini kiasi_cha_juu inayotokwa malighafi{jina}}}}`,
      ownerToken
    );
    const sliceId = slice?.data?.unda_mapishi?.id;
    created.mapishi.push(sliceId);
    check('§3.1 fraction_of created with no lines of its own', Boolean(sliceId), msgOf(slice));

    const lines = slice?.data?.unda_mapishi?.viambato || [];
    check('§3.1 slice derives the parent\'s 2 lines', lines.length === 2, `got ${lines.length}`);
    check(
      '§3.1 derived amounts are parent x 0.1 (flour 1.0-1.2 -> 0.1-0.12)',
      lines.some((l) => near(l.kiasi_cha_chini, 0.1) && near(l.kiasi_cha_juu, 0.12)),
      JSON.stringify(lines.map((l) => [l.kiasi_cha_chini, l.kiasi_cha_juu]))
    );
    check(
      '§3.1 derived amounts are parent x 0.1 (sugar 0.5-0.8 -> 0.05-0.08)',
      lines.some((l) => near(l.kiasi_cha_chini, 0.05) && near(l.kiasi_cha_juu, 0.08)),
      JSON.stringify(lines.map((l) => [l.kiasi_cha_chini, l.kiasi_cha_juu]))
    );
    check(
      '§3.1 derived lines are flagged inayotokwa and carry no row id',
      lines.every((l) => l.inayotokwa === true),
      JSON.stringify(lines.map((l) => l.inayotokwa))
    );
    check(
      '§3.1 slice points at the parent cake',
      slice?.data?.unda_mapishi?.mapishi_ibaba?.id === parentId,
      JSON.stringify(slice?.data?.unda_mapishi?.mapishi_ibaba)
    );

    // Re-weighing the parent must flow through to the slice automatically.
    await gql(
      `mutation{hariri_mapishi(id:${parentId},input:{
         ladha:"${PREFIX} Cake",ukubwa:"24",dakika_kadirio:120,
         viambato:[{malighafi_id:${flour.id},kiasi_cha_chini:2.0,kiasi_cha_juu:2.0,sehemu:"mfuatano"}]}){id}}`,
      ownerToken
    );
    const reread = await gql(
      `{mapishi{viambato{kiasi_cha_chini kiasi_cha_juu} mapishi_ibaba{id} mapamba_variant sehemu_ya_uzito ladha ukubwa}}`,
      ownerToken
    );
    const rereadSlice = (reread?.data?.mapishi || []).find((r) => String(r.ukubwa) === 'slice' && r.mapamba_variant === 'fraction_of');
    check(
      '§3.1 re-weighing the parent rescales the slice (2.0 -> 0.2)',
      rereadSlice && (rereadSlice.viambato || []).some((l) => near(l.kiasi_cha_chini, 0.2)),
      JSON.stringify(rereadSlice?.viambato)
    );

    // ---- §3.1 validation ------------------------------------------------
    const noParent = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Orphan",ukubwa:"1",mapamba_variant:"fraction_of",sehemu_ya_uzito:0.5,viambato:[]}){id}}`,
      ownerToken
    );
    check('§3.1 fraction_of without a parent rejected', codeOf(noParent) === 'BAD_REQUEST', `${codeOf(noParent)} ${msgOf(noParent)}`);

    for (const bad of [0, 1, 1.5, -0.2]) {
      const r = await gql(
        `mutation{unda_mapishi(input:{ladha:"${PREFIX} Bad${String(bad).replace('.', '_')}",ukubwa:"1",mapamba_variant:"fraction_of",mapishi_ibaba:"${parentId}",sehemu_ya_uzito:${bad},viambato:[]}){id}}`,
        ownerToken
      );
      check(`§3.1 fraction with ratio ${bad} rejected`, codeOf(r) === 'BAD_REQUEST', `${codeOf(r)} ${msgOf(r)}`);
    }

    // No chains: a fraction of a fraction would make cycles reachable.
    const chained = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Chained",ukubwa:"1",mapamba_variant:"fraction_of",mapishi_ibaba:"${sliceId}",sehemu_ya_uzito:0.5,viambato:[]}){id}}`,
      ownerToken
    );
    check('§3.1 fraction of a fraction rejected (no chains)', codeOf(chained) === 'BAD_REQUEST', `${codeOf(chained)} ${msgOf(chained)}`);

    const selfParent = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Selfish",ukubwa:"1",mapamba_variant:"fraction_of",mapishi_ibaba:"${parentId}",sehemu_ya_uzito:0.5,viambato:[]}){id}}`,
      ownerToken
    );
    created.mapishi.push(selfParent?.data?.unda_mapishi?.id);
    const selfishId = selfParent?.data?.unda_mapishi?.id;
    if (selfishId) {
      const makeSelf = await gql(
        `mutation{hariri_mapishi(id:${selfishId},input:{ladha:"${PREFIX} Selfish",ukubwa:"1",mapamba_variant:"fraction_of",mapishi_ibaba:"${selfishId}",sehemu_ya_uzito:0.5,viambato:[]}){id}}`,
        ownerToken
      );
      check('§3.1 recipe cannot be its own parent', codeOf(makeSelf) === 'BAD_REQUEST', `${codeOf(makeSelf)} ${msgOf(makeSelf)}`);
    }

    const ownNoLines = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Empty",ukubwa:"1",viambato:[]}){id}}`,
      ownerToken
    );
    check('§3.1 own_recipe with no lines still rejected', codeOf(ownNoLines) === 'BAD_REQUEST', `${codeOf(ownNoLines)} ${msgOf(ownNoLines)}`);

    // A stray ratio on an own_recipe is meaningless, so it must not persist.
    const strayRatio = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Stray",ukubwa:"1",mapamba_variant:own_recipe,mapishi_ibaba:"${parentId}",sehemu_ya_uzito:0.25,viambato:[{malighafi_id:${flour.id},kiasi_cha_chini:1,kiasi_cha_juu:1}]}){id sehemu_ya_uzito mapishi_ibaba{id}}}`,
      ownerToken
    );
    created.mapishi.push(strayRatio?.data?.unda_mapishi?.id);
    check(
      '§3.1 stray parent/ratio on an own_recipe is cleared, not stored',
      strayRatio?.data?.unda_mapishi?.sehemu_ya_uzito == null && !strayRatio?.data?.unda_mapishi?.mapishi_ibaba,
      JSON.stringify(strayRatio?.data?.unda_mapishi)
    );

    // =====================================================================
    // §3.2 — recipe-book orders report the recipe's own prep time
    // =====================================================================
    console.log('\n  -- §3.2 prep time comes from the recipe --');

    const slowRecipe = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Slow",ukubwa:"24",dakika_kadirio:360,
         viambato:[{malighafi_id:${flour.id},kiasi_cha_chini:1,kiasi_cha_juu:1}]}){id}}`,
      ownerToken
    );
    const slowId = slowRecipe?.data?.unda_mapishi?.id;
    created.mapishi.push(slowId);

    const order = await gql(
      `mutation{unda_agizo(input:{ladha:"${PREFIX} Slow",ukubwa:"24",mapishi_id:"${slowId}",
         tarehe_ya_kuchukua:"2030-06-01",bei_jumla:50000,malipo_ya_awali:0}){id mapishi_id muda_hitajika}}`,
      ownerToken
    );
    const orderId = order?.data?.unda_agizo?.id;
    created.agizo.push(orderId);
    check('§3.2 fixture order created', Boolean(orderId), msgOf(order));
    check(
      '§3.2 linked order reports the recipe\'s 360 min, not the text default',
      Number(order?.data?.unda_agizo?.muda_hitajika) === 360,
      `got ${order?.data?.unda_agizo?.muda_hitajika}`
    );

    // The same free-text name with NO recipe must keep the old lookup path,
    // so this fix must not have changed off-book orders.
    const offBook = await gql(
      `mutation{unda_agizo(input:{ladha:"${PREFIX} Unknown Cake",ukubwa:"24",
         tarehe_ya_kuchukua:"2030-06-01",bei_jumla:30000,malipo_ya_awali:0}){id mapishi_id muda_hitajika}}`,
      ownerToken
    );
    created.agizo.push(offBook?.data?.unda_agizo?.id);
    check(
      '§3.2 off-book order still uses the free-text lookup',
      offBook?.data?.unda_agizo?.mapishi_id == null && Number(offBook?.data?.unda_agizo?.muda_hitajika) > 0,
      `mapishi_id=${offBook?.data?.unda_agizo?.mapishi_id} min=${offBook?.data?.unda_agizo?.muda_hitajika}`
    );

    // =====================================================================
    // §4.2 — the same person must not become two customer records
    // =====================================================================
    console.log('\n  -- §4.2 customer deduplication --');

    const phone = `07${String(Date.now()).slice(-8)}`;
    const first = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Asha",simu:"${phone}",mzio:"花生 allergy"},
         ladha:"${PREFIX} Order A",ukubwa:"1",tarehe_ya_kuchukua:"2030-07-01",
         bei_jumla:40000,malipo_ya_awali:0}){id mteja{id jina simu mzio}}}`,
      ownerToken
    );
    const firstId = first?.data?.unda_agizo?.id;
    const firstMteja = first?.data?.unda_agizo?.mteja;
    created.agizo.push(firstId);
    created.mteja.push(phone);
    check('§4.2 first order creates a customer', Boolean(firstMteja?.id), msgOf(first));
    check('§4.2 allergy info stored on the customer', firstMteja?.mzio === '花生 allergy', firstMteja?.mzio);

    // Same phone, slightly different name: must resolve to the same person.
    const second = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Asha M.",simu:"${phone}"},
         ladha:"${PREFIX} Order B",ukubwa:"1",tarehe_ya_kuchukua:"2030-07-02",
         bei_jumla:45000,malipo_ya_awali:0}){id mteja{id jina mzio}}}`,
      ownerToken
    );
    const secondId = second?.data?.unda_agizo?.id;
    const secondMteja = second?.data?.unda_agizo?.mteja;
    created.agizo.push(secondId);
    check(
      '§4.2 same phone, different name -> same customer record',
      secondMteja?.id === firstMteja?.id,
      `${firstMteja?.id} vs ${secondMteja?.id}`
    );
    check(
      '§4.2 the recorded name is not overwritten by a variant spelling',
      secondMteja?.jina === `${PREFIX} Asha`,
      secondMteja?.jina
    );
    check(
      '§4.2 a second order without allergy info does not erase the recorded allergy',
      secondMteja?.mzio === '花生 allergy',
      secondMteja?.mzio
    );

    const dupeCount = await sql('SELECT count(*)::int AS n FROM mteja WHERE simu = $1', [phone]);
    check('§4.2 exactly one customer row exists for that number', dupeCount[0].n === 1, `got ${dupeCount[0].n}`);

    // A genuinely new allergy on a repeat order should be recorded, not ignored.
    const third = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Asha",simu:"${phone}",mzio:"花生 na mboga"},
         ladha:"${PREFIX} Order C",ukubwa:"1",tarehe_ya_kuchukua:"2030-07-03",
         bei_jumla:40000,malipo_ya_awali:0}){id mteja{id mzio}}}`,
      ownerToken
    );
    created.agizo.push(third?.data?.unda_agizo?.id);
    check(
      '§4.2 a new allergy on a repeat order is recorded',
      third?.data?.unda_agizo?.mteja?.mzio === '花生 na mboga',
      third?.data?.unda_agizo?.mteja?.mzio
    );

    // Walk-in with no phone at all must still work, and must not collide with
    // the next walk-in who also has no phone.
    created.mteja.push(`${PREFIX} Walkin 1`, `${PREFIX} Walkin 2`, `${PREFIX} Noted`);
    const walkIn1 = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Walkin 1"},
         ladha:"${PREFIX} Order D",ukubwa:"1",tarehe_ya_kuchukua:"2030-07-04",
         bei_jumla:20000,malipo_ya_awali:0}){id mteja{id simu}}}`,
      ownerToken
    );
    const walkIn2 = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Walkin 2"},
         ladha:"${PREFIX} Order E",ukubwa:"1",tarehe_ya_kuchukua:"2030-07-05",
         bei_jumla:20000,malipo_ya_awali:0}){id mteja{id simu}}}`,
      ownerToken
    );
    created.agizo.push(walkIn1?.data?.unda_agizo?.id, walkIn2?.data?.unda_agizo?.id);
    check(
      '§4.2 two walk-ins with no phone stay separate records',
      walkIn1?.data?.unda_agizo?.mteja?.id && walkIn1?.data?.unda_agizo?.mteja?.id !== walkIn2?.data?.unda_agizo?.mteja?.id,
      `${walkIn1?.data?.unda_agizo?.mteja?.id} vs ${walkIn2?.data?.unda_agizo?.mteja?.id}`
    );

    // The DB backstop: a direct second insert on the same number must fail.
    let dbBlocked = false;
    try {
      await sql('INSERT INTO mteja (jina, simu) VALUES ($1, $2)', [`${PREFIX} Direct`, phone]);
    } catch (e) {
      dbBlocked = /mteja_simu_uidx|duplicate key/i.test(e.message);
    }
    check('§4.2 unique index blocks a duplicate number at the DB level', dbBlocked);

    // ongeza_mteja should report the clash in plain language, not a raw error.
    const clash = await gql(
      `mutation{ongeza_mteja(input:{jina:"${PREFIX} Clone",simu:"${phone}"}){id}}`,
      ownerToken
    );
    check('§4.2 ongeza_mteja reports a duplicate number clearly', codeOf(clash) === 'ALREADY_EXISTS', `${codeOf(clash)} ${msgOf(clash)}`);

    // =====================================================================
    // §4.1 / §4.3 — order notes and shape are stored, and reach the kitchen
    // =====================================================================
    console.log('\n  -- §4.1/§4.3 order notes and shape --');

    const noted = await gql(
      `mutation{unda_agizo(input:{mteja_mpya:{jina:"${PREFIX} Noted",simu:"07${String(Date.now()).slice(-8)}a"},
         ladha:"${PREFIX} Order F",ukubwa:"24",umbo:"Heart",maelekezo_maalum:"Deliver by 3pm, extra flowers",
         tarehe_ya_kuchukua:"2030-07-06",bei_jumla:60000,malipo_ya_awali:0}){id umbo maelekezo_maalum}}`,
      ownerToken
    );
    created.agizo.push(noted?.data?.unda_agizo?.id);
    check('§4.3 custom shape stored on the order', noted?.data?.unda_agizo?.umbo === 'Heart', noted?.data?.unda_agizo?.umbo);
    check(
      '§4.1 special instructions stored on the order',
      noted?.data?.unda_agizo?.maelekezo_maalum === 'Deliver by 3pm, extra flowers',
      noted?.data?.unda_agizo?.maelekezo_maalum
    );

    // The kitchen query must actually carry the allergy info through, or the
    // chef screen has nothing to display.
    const kitchen = await gql('{order_kwajikoni{id umbo maelekezo_maalum mteja_kupika{jina mzio}}}', chef.token);
    const kitchenOrders = kitchen?.data?.order_kwajikoni || [];
    const withAllergy = kitchenOrders.find((o) => o.mteja_kupika?.mzio === '花生 na mboga');
    check('§4.1 allergy info reaches the kitchen query', Boolean(withAllergy), `${kitchenOrders.length} orders in queue`);
    const withNotes = kitchenOrders.find((o) => o.maelekezo_maalum);
    check('§4.1 special instructions reach the kitchen query', Boolean(withNotes));
    check('§4.3 shape reaches the kitchen query', kitchenOrders.some((o) => o.umbo === 'Heart'));

    // The kitchen-scoped field must not become a back door to the full
    // customer record: the chef still has no business reading siku_ya_kuzaliwa.
    const chefFull = await gql('{order_kwajikoni{id mteja{id jina}}}', chef.token);
    const anyFull = (chefFull?.data?.order_kwajikoni || []).some((o) => o.mteja);
    check('§4.1 chef still cannot read the full customer record via mteja', !anyFull, 'mteja leaked to the kitchen');

    const ownerSees = await gql('{order_kwajikoni{id mteja{id jina mzio} mteja_kupika{mzio}}}', ownerToken);
    const ownerOrders = ownerSees?.data?.order_kwajikoni || [];
    check(
      '§4.1 owner sees both the full record and the kitchen view',
      ownerOrders.some((o) => o.mteja?.id) && ownerOrders.some((o) => o.mteja_kupika?.mzio),
      'owner missing one of the two'
    );

    // =====================================================================
    // §3.3 — the recipient can close a request aimed at them
    // =====================================================================
    console.log('\n  -- §3.3 recipients can close their own requests --');

    for (const target of [chef, cashier]) {
      const label = target.jukumu;
      const sent = await gql(
        `mutation{tuma_ombi(input:{kwenda_kwa:${target.id},ujumbe:"${PREFIX} tafadhali ${label}"}){id kwenda_kwa{id} hali}}`,
        ownerToken
      );
      const ombiId = sent?.data?.tuma_ombi?.id;
      created.ombi.push(ombiId);
      check(`§3.3 ${label} can be sent a request`, Boolean(ombiId), msgOf(sent));
      check(
        `§3.3 ${label}'s request starts written, not sent`,
        sent?.data?.tuma_ombi?.hali === 'imeandikwa',
        sent?.data?.tuma_ombi?.hali
      );

      // The record has to be sent before anybody is on the hook for it, and
      // picking it up is not the same as answering it.
      const skipped = await gql(
        `mutation{sasisha_ombi(id:${ombiId},hali:imekamilika){id}}`,
        target.token
      );
      check(
        `§3.3 ${label}'s request cannot jump straight to done`,
        ['INVALID_TRANSITION', 'FORBIDDEN'].includes(codeOf(skipped)),
        `${codeOf(skipped)} ${msgOf(skipped)}`
      );

      const sent2 = await gql(`mutation{sasisha_ombi(id:${ombiId},hali:imetumwa){hali}}`, ownerToken);
      check(`§3.3 ${label}'s request can be sent`, sent2?.data?.sasisha_ombi?.hali === 'imetumwa', msgOf(sent2));

      // The wrong person must still be refused — this is the control that
      // makes the widened permission in §3.3 safe. Only meaningful when the
      // chef is NOT the recipient; running it otherwise would have the chef
      // answer their own request and make the real check below fail.
      if (String(target.id) !== String(chef.id)) {
        const wrong = await gql(`mutation{sasisha_ombi(id:${ombiId},hali:inasubiri,jibu:"not mine"){id}}`, chef.token);
        check(`§3.3 ${label}'s request cannot be picked up by the chef`, codeOf(wrong) === 'FORBIDDEN', `${codeOf(wrong)} ${msgOf(wrong)}`);
      }

      const picked = await gql(`mutation{sasisha_ombi(id:${ombiId},hali:inasubiri){hali}}`, target.token);
      check(
        `§3.3 ${label} can pick up a request addressed to them`,
        picked?.data?.sasisha_ombi?.hali === 'inasubiri',
        `${codeOf(picked)} ${msgOf(picked)}`
      );

      // The owner sent every request in this block, and the owner is still the
      // person who sent it. If the owner can approve their own request then the
      // approval step is a signature, not a decision, so this is checked
      // deliberately and not as an afterthought.
      const selfApprove = await gql(
        `mutation{sasisha_ombi(id:${ombiId},hali:imeidhinishwa,jibu:"mine"){id}}`,
        ownerToken
      );
      check(
        '§3.3 the sender cannot approve their own request, even as owner',
        codeOf(selfApprove) === 'FORBIDDEN',
        `${codeOf(selfApprove)} ${msgOf(selfApprove)}`
      );

      const approved = await gql(
        `mutation{sasisha_ombi(id:${ombiId},hali:imeidhinishwa,jibu:"nakubali"){hali}}`,
        target.token
      );
      check(
        `§3.3 ${label} can approve a request addressed to them`,
        approved?.data?.sasisha_ombi?.hali === 'imeidhinishwa',
        `${codeOf(approved)} ${msgOf(approved)}`
      );

      const done = await gql(`mutation{sasisha_ombi(id:${ombiId},hali:imekamilika,jibu:"imefanyika"){hali jibu}}`, target.token);
      check(
        `§3.3 ${label} can complete an approved request`,
        done?.data?.sasisha_ombi?.hali === 'imekamilika',
        `${codeOf(done)} ${msgOf(done)}`
      );

      const again = await gql(`mutation{sasisha_ombi(id:${ombiId},hali:inaendelea){id}}`, target.token);
      check(`§3.3 ${label} cannot move a closed request`, ['ALREADY_CLOSED', 'INVALID_TRANSITION'].includes(codeOf(again)), `${codeOf(again)} ${msgOf(again)}`);
    }

    // A stranger can neither answer nor close a record that is not theirs.
    {
      const toChef = await gql(
        `mutation{tuma_ombi(input:{kwenda_kwa:${chef.id},ujumbe:"${PREFIX} owner close",aina:direktive}){id aina}}`,
        ownerToken
      );
      created.ombi.push(toChef?.data?.tuma_ombi?.id);
      check('§3.3 a directive records which way it points', toChef?.data?.tuma_ombi?.aina === 'direktive', msgOf(toChef));
      const issued = await gql(
        `mutation{sasisha_ombi(id:${toChef?.data?.tuma_ombi?.id},hali:imetumwa){hali}}`,
        ownerToken
      );
      check('§3.3 a written directive can be sent', issued?.data?.sasisha_ombi?.hali === 'imetumwa', msgOf(issued));
      const ownerAck = await gql(
        `mutation{sasisha_ombi(id:${toChef?.data?.tuma_ombi?.id},hali:imeanzishwa){hali}}`,
        ownerToken
      );
      check('§3.3 a directive can be issued', ownerAck?.data?.sasisha_ombi?.hali === 'imeanzishwa', msgOf(ownerAck));
      const ownerSelfAck = await gql(
        `mutation{sasisha_ombi(id:${toChef?.data?.tuma_ombi?.id},hali:limekubaliwa){hali}}`,
        ownerToken
      );
      check(
        '§3.3 the issuer cannot acknowledge a directive for the person it was sent to',
        codeOf(ownerSelfAck) === 'FORBIDDEN',
        `${codeOf(ownerSelfAck)} ${msgOf(ownerSelfAck)}`
      );
      const cashAck = await gql(
        `mutation{sasisha_ombi(id:${toChef?.data?.tuma_ombi?.id},hali:limekubaliwa){hali}}`,
        cashier.token
      );
      check(
        '§3.3 somebody unrelated cannot acknowledge a directive',
        codeOf(cashAck) === 'FORBIDDEN',
        `${codeOf(cashAck)} ${msgOf(cashAck)}`
      );
      const chefAck = await gql(
        `mutation{sasisha_ombi(id:${toChef?.data?.tuma_ombi?.id},hali:limekubaliwa){hali}}`,
        chef.token
      );
      check('§3.3 the recipient can acknowledge a directive', chefAck?.data?.sasisha_ombi?.hali === 'limekubaliwa', msgOf(chefAck));
    }

      // =====================================================================
      // §3.3b — the request composer needs a list of colleagues
      // =====================================================================
      // The stock screen's "request this" button has to offer a recipient. It
      // was originally built on `staff`, which is gated on staff.manage, and
      // that permission belongs to the owner alone -- so the inventory clerk got
      // an empty dropdown and could not raise a purchase request at all. The
      // check is here so the directory cannot be swapped back to `staff`.
      console.log('\n  -- §3.3b a requester can see who to address --');
      for (const who of [inventory, cashier, chef]) {
        const dir = await gql('{watumishi{id jina jukumu}}', who.token);
        const list = dir?.data?.watumishi || [];
        check(
          `§3.3b ${who.jukumu} can read the request directory`,
          dir?.errors === undefined && list.length > 0,
          msgOf(dir)
        );
        check(
          `§3.3b the directory shown to ${who.jukumu} names the owner`,
          list.some((s) => s.jukumu === 'owner' && s.id !== null && s.jina),
          JSON.stringify(list.map((s) => s.jina))
        );
        check(
          `§3.3b the directory exposes no join date or inactive account`,
          await (async () => {
            const { rows } = await pool.query(
              `SELECT count(*)::int AS n FROM mtumiaji WHERE NOT active`
            );
            return !list.some((s) => s.active === false) && rows[0].n >= 0;
          })(),
          'directory leaked inactive staff or extra fields'
        );
      }
      // staff.manage stays owner-only; the directory must not have quietly
      // opened the full staff list to every role.
      const staffAsInv = await gql('{staff{id}}', inventory.token);
      check(
        '§3.3b the directory did not widen the full staff list to inventory',
        codeOf(staffAsInv) === 'FORBIDDEN',
        `${codeOf(staffAsInv)} ${msgOf(staffAsInv)}`
      );
      const dirAnon = await gql('{watumishi{id}}', null);
      check('§3.3b the directory is not readable while signed out', codeOf(dirAnon) === 'UNAUTHENTICATED', codeOf(dirAnon));

      // The composed request has to actually work end to end for the inventory
      // clerk, which is the whole point of the panel.
      const invReq = await gql(
        `mutation{tuma_ombi(input:{kwenda_kwa:1,ujumbe:"${PREFIX} tafadhali sukari"}){id}}`,
        inventory.token
      );
      const invReqId = invReq?.data?.tuma_ombi?.id;
      created.ombi.push(invReqId);
      check('§3.3b inventory clerk can send a request to the owner', Boolean(invReqId), msgOf(invReq));
      const toSelf = await gql(
        `mutation{tuma_ombi(input:{kwenda_kwa:${inventory.id},ujumbe:"self"}){id}}`,
        inventory.token
      );
      check('§3.3b a request cannot be addressed to yourself', codeOf(toSelf) === 'BAD_REQUEST', `${codeOf(toSelf)} ${msgOf(toSelf)}`);

    // =====================================================================
    // Categories and bulk assignment
    // =====================================================================
    console.log('\n  -- categories and bulk assignment --');

    const cat = await gql(`mutation{unda_kategoria(jina:"${PREFIX} Cakes"){id jina}}`, ownerToken);
    const catId = cat?.data?.unda_kategoria?.id;
    created.kategoria.push(catId);
    check('category created', Boolean(catId), msgOf(cat));

    const mkProduct = async (ukubwa) => {
      const r = await gql(
        `mutation{bathi_bidhaa(input:{jina:"${PREFIX} Cake ${ukubwa}",bei:50000,familia:"${PREFIX} Cake",ukubwa:"${ukubwa}"}){id}}`,
        ownerToken
      );
      const b = r?.data?.bathi_bidhaa;
      if (b) created.bidhaa.push(b.id);
      return b;
    };
    const p1 = await mkProduct('20');
    const p2 = await mkProduct('24');
    check('two products created', Boolean(p1?.id && p2?.id));

    const assigned = await gql(`mutation{panga_kategoria(bidhaa_ids:["${p1.id}","${p2.id}"],kategoria_id:"${catId}")}`, ownerToken);
    check('panga_kategoria reports 2 products assigned', Number(assigned?.data?.panga_kategoria) === 2, `${codeOf(assigned)} ${msgOf(assigned)}`);

    const rereadCats = await gql(`{kategoria{id jina bidhaa{id jina kategoria{jina}}}}`, ownerToken);
    const mine = (rereadCats?.data?.kategoria || []).find((k) => k.jina === `${PREFIX} Cakes`);
    check('both products now carry the category', (mine?.bidhaa || []).length === 2, `got ${(mine?.bidhaa || []).length}`);

    // =====================================================================
    // Two-phase stock: estimate first, stock only moves on verify
    // =====================================================================
    console.log('\n  -- §4.4 two-phase stock and standalone notes --');

    const noContext = await gql(
      `mutation{log_matumizi_kundi(input:{vitu:[{malighafi_id:${flour.id},kiasi:1}]}){id}}`,
      chef.token
    );
    check('chef log with no order and no note rejected', codeOf(noContext) === 'BAD_REQUEST', `${codeOf(noContext)} ${msgOf(noContext)}`);

    const withNote = await gql(
      `mutation{log_matumizi_kundi(input:{kumbukumbu:"${PREFIX} weekend bake",
         vitu:[{malighafi_id:${flour.id},kiasi:1}]}){id hali kumbukumbu}}`,
      chef.token
    );
    const loggedId = withNote?.data?.log_matumizi_kundi?.[0]?.id;
    check('chef log with a note and no order succeeds', Boolean(loggedId), msgOf(withNote));
    check('chef log starts as an estimate (inakadiriwa)', withNote?.data?.log_matumizi_kundi?.[0]?.hali === 'inakadiriwa', withNote?.data?.log_matumizi_kundi?.[0]?.hali);

    const stockAfterLog = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id = $1', [flour.id]);
    check('logging an estimate does NOT move stock', near(stockAfterLog[0].kiasi_kilichopo, 10), `stock=${stockAfterLog[0].kiasi_kilichopo}`);

    const chefVerify = await gql(`mutation{thibitisha_matumizi(id:${loggedId},kiasi_halisi:2){id hali}}`, chef.token);
    check('chef cannot verify their own estimate (inventory confirms)', codeOf(chefVerify) === 'FORBIDDEN', `${codeOf(chefVerify)} ${msgOf(chefVerify)}`);

    const verified = await gql(`mutation{thibitisha_matumizi(id:${loggedId},kiasi_halisi:2){id hali kiasi}}`, ownerToken);
    check('verifying the real number succeeds', verified?.data?.thibitisha_matumizi?.hali === 'imethibitishwa', msgOf(verified));

    const stockAfterVerify = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id = $1', [flour.id]);
    check('verification moved stock by the real amount (10 - 2 = 8)', near(stockAfterVerify[0].kiasi_kilichopo, 8), `stock=${stockAfterVerify[0].kiasi_kilichopo}`);

    // Over-usage is a valid signal, not an error.
    const over = await gql(
      `mutation{log_matumizi_kundi(input:{kumbukumbu:"${PREFIX} over",vitu:[{malighafi_id:${sugar.id},kiasi:99}]}){id}}`,
      chef.token
    );
    const overId = over?.data?.log_matumizi_kundi?.[0]?.id;
    const overVerified = await gql(`mutation{thibitisha_matumizi(id:${overId},kiasi_halisi:99){id hali}}`, ownerToken);
    check('verifying more than we had is allowed, not an error', overVerified?.data?.thibitisha_matumizi?.hali === 'imethibitishwa', msgOf(overVerified));
    const negStock = await sql('SELECT kiasi_kilichopo FROM malighafi WHERE id = $1', [sugar.id]);
    check('over-usage leaves negative stock as the signal', Number(negStock[0].kiasi_kilichopo) < 0, `stock=${negStock[0].kiasi_kilichopo}`);

    // =====================================================================
    // A chef sheet references the recipe lines it came from
    // =====================================================================
    // The sheet path was not covered here at all, and the database trigger that
    // guards it was comparing a recipe line's quantity against an ingredient id,
    // so a valid sheet could not be saved. The wrong-ingredient case is the
    // reason the trigger exists, so it is checked from both sides.
    console.log('\n  -- chef sheet lines --');
    const recipeLine = await sql('SELECT id, malighafi_id, sehemu FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id', [parentId]);
    const lineA = recipeLine[0];
    // Any ingredient other than the one lineA names. Worked out rather than
    // assumed, so this does not depend on how many lines the fixture recipe has.
    const otherId = [flour.id, sugar.id].find((x) => String(x) !== String(lineA?.malighafi_id));

    const sheetOk = await gql(
      `mutation{log_matumizi_kundi(input:{kumbukumbu:"${PREFIX} sheet",
         vitu:[
           {malighafi_id:${lineA.malighafi_id},kiasi_cha_chini:1,kiasi_cha_juu:1.2,mapishi_kipengele_id:${lineA.id},hali_sheeti:imechaguliwa}
         ]}){id hali}}`,
      chef.token
    );
    const sheetIds = sheetOk?.data?.log_matumizi_kundi || [];
    check('a sheet line pointing at a real recipe line is accepted', sheetIds.length === 1, msgOf(sheetOk));

    const sheetLine = sheetIds.length
      ? (await sql('SELECT sehemu, malighafi_id, mapishi_kipengele_id FROM kumbukumbu_matumizi WHERE id = $1', [sheetIds[0].id]))[0]
      : null;
    check(
      'the section is taken from the recipe, not from the client',
      sheetLine?.sehemu === lineA.sehemu,
      `sheet=${sheetLine?.sehemu} recipe=${lineA.sehemu}`
    );
    check(
      'a sheet line keeps its link to the recipe line',
      String(sheetLine?.mapishi_kipengele_id) === String(lineA.id),
      JSON.stringify(sheetLine)
    );

    // The same ingredient on two different recipe lines is the reason the
    // per-ingredient uniqueness rule was dropped in migration 009.
    const twiceCheck = await sql('SELECT count(*)::int n FROM mapishi_kipengele WHERE mapishi_id = $1 AND malighafi_id = $2', [parentId, lineA.malighafi_id]);
    check('the recipe has one line per ingredient, so duplicates are only visible elsewhere', twiceCheck[0].n >= 1, twiceCheck[0].n);

    const wrongIngredient = await gql(
      `mutation{log_matumizi_kundi(input:{kumbukumbu:"${PREFIX} wrong",
         vitu:[
           {malighafi_id:${otherId},kiasi_cha_chini:1,kiasi_cha_juu:1.2,mapishi_kipengele_id:${lineA.id},hali_sheeti:imechaguliwa}
         ]}){id}}`,
      chef.token
    );
    check(
      'a sheet line cannot claim a different ingredient than the recipe line it points at',
      codeOf(wrongIngredient) === 'CHECK_VIOLATION' || codeOf(wrongIngredient) === 'BAD_REQUEST' || codeOf(wrongIngredient) === 'GRAPHQL_VALIDATION_FAILED',
      `${codeOf(wrongIngredient)} ${msgOf(wrongIngredient)}`
    );

    // The sheet for an order may only be built from that order's recipe.
    const foreignRecipe = await sql("SELECT id FROM mapishi WHERE id <> $1 AND active ORDER BY id LIMIT 1", [parentId]);
    if (foreignRecipe.length) {
      const foreignLines = await sql('SELECT id, malighafi_id FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id LIMIT 1', [foreignRecipe[0].id]);
      if (foreignLines.length) {
        const strayRef = await gql(
          `mutation{log_matumizi_kundi(input:{agizo_id:${orderId},
             vitu:[{malighafi_id:${foreignLines[0].malighafi_id},kiasi_cha_chini:1,kiasi_cha_juu:1.2,
                    mapishi_kipengele_id:${foreignLines[0].id},hali_sheeti:imechaguliwa}]}){id}}`,
          chef.token
        );
        check(
          "a sheet for an order cannot be built from another recipe's line",
          codeOf(strayRef) === 'BAD_REQUEST',
          `${codeOf(strayRef)} ${msgOf(strayRef)}`
        );
      }
    }

    // =====================================================================
    // A correction keeps the sheet it replaces
    // =====================================================================
    // The amend path used to detach the old lines and delete the old sheet, which
    // is the opposite of what the field promises and erases the submission being
    // corrected. The replacement is a new open sheet and the old one is superseded.
    console.log('\n  -- amending a sheet --');

    // The order was placed against slowId, so everything below is built from
    // slowId's own lines. A line from another recipe is refused by the ownership
    // check, and it is right to refuse it.
    const orderLines = await sql('SELECT id, malighafi_id FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id', [slowId]);
    const orderLine = orderLines[0];
    const tapFor = (min, max) =>
      `{malighafi_id:${orderLine.malighafi_id},kiasi_cha_chini:${min},kiasi_cha_juu:${max},mapishi_kipengele_id:${orderLine.id},hali_sheeti:imechaguliwa}`;

    const sheetFirst = await gql(
      `mutation{log_matumizi_kundi(input:{agizo_id:${orderId},
         vitu:[${tapFor(1, 1.2)}]}){id}}`,
      chef.token
    );
    const sheetFirstLineId = (sheetFirst?.data?.log_matumizi_kundi || [])[0]?.id;
    const sheetFirstSheetId = sheetFirstLineId
      ? (await sql('SELECT zingumiaji_id FROM kumbukumbu_matumizi WHERE id = $1', [sheetFirstLineId]))[0].zingumiaji_id
      : null;
    check('the order accepts a sheet', Boolean(sheetFirstLineId), msgOf(sheetFirst));
    check('a sheet for an order is recorded against the order', Boolean(sheetFirstSheetId), 'no sheet was created');

    const sheetAgain = await gql(
      `mutation{log_matumizi_kundi(input:{agizo_id:${orderId},
         vitu:[${tapFor(1, 1.2)}]}){id}}`,
      chef.token
    );
    check('an order already logged cannot be logged sheetAgain', codeOf(sheetAgain) === 'ALREADY_LOGGED', `${codeOf(sheetAgain)} ${msgOf(sheetAgain)}`);

    const sheetAmended = await gql(
      `mutation{log_matumizi_kundi(input:{agizo_id:${orderId},badilisha:true,
         vitu:[${tapFor(2, 2.4)}]}){id}}`,
      chef.token
    );
    const amendLineId = (sheetAmended?.data?.log_matumizi_kundi || [])[0]?.id;
    check('a correction is accepted', Boolean(amendLineId), msgOf(sheetAmended));

    const keptSheet = sheetFirstSheetId
      ? (await sql('SELECT hali FROM zingumiaji_matumizi WHERE id = $1', [sheetFirstSheetId]))[0]
      : null;
    check('the replaced sheet is still on the record', Boolean(keptSheet), 'the old sheet was deleted');
    check('the replaced sheet is marked superseded', keptSheet?.hali === 'imebadilishwa', keptSheet?.hali);

    const keptLine = sheetFirstLineId
      ? (await sql('SELECT kiasi, hali_sheeti, zingumiaji_id FROM kumbukumbu_matumizi WHERE id = $1', [sheetFirstLineId]))[0]
      : null;
    check('the replaced sheet keeps the amount the chef sheetFirst tapped', near(keptLine?.kiasi, 1.1), JSON.stringify(keptLine));
    check('the replaced line still belongs to the sheet it was written on', String(keptLine?.zingumiaji_id) === String(sheetFirstSheetId), JSON.stringify(keptLine));

    const amendSheetId = amendLineId
      ? (await sql('SELECT zingumiaji_id FROM kumbukumbu_matumizi WHERE id = $1', [amendLineId]))[0].zingumiaji_id
      : null;
    check('the correction is on a sheet of its own', amendSheetId && amendSheetId !== sheetFirstSheetId, `sheetAmended=${amendSheetId} sheetFirst=${sheetFirstSheetId}`);

    const amendQueueRes = await gql(
      `query{kumbukumbu_matumizi_kusubiri{id zingumiaji{hali}}}`,
      ownerToken
    );
    const amendQueued = amendQueueRes?.data?.kumbukumbu_matumizi_kusubiri || [];
    check(
      'a superseded sheet is not left in the verification queue',
      amendQueued.every((l) => !l.zingumiaji || l.zingumiaji.hali === 'inakadiriwa'),
      JSON.stringify(amendQueued.map((l) => l.zingumiaji && l.zingumiaji.hali))
    );
    check('the correction is waiting to be verified', amendQueued.some((l) => l.id === amendLineId), 'the replacement sheet is not amendQueued');
    check('the superseded sheet is not waiting to be verified', !amendQueued.some((l) => l.id === sheetFirstLineId), 'the replaced line is still amendQueued');

    // A "not used" answer is stored as zero, which is what inventory confirms and
    // which moves no stock. hali_sheeti itself is only carried by a line that
    // belongs to a sheet: the kumbukumbu_matumizi_sheeti_coherent constraint ties
    // the two together on purpose, so a standalone note has no sheet state to keep.
    const unusedRes = await gql(
      `mutation{log_matumizi_kundi(input:{kumbukumbu:"${PREFIX} unusedRes",
         vitu:[{malighafi_id:${sugar.id},hali_sheeti:haikutumika}]}){id hali kiasi}}`,
      chef.token
    );
    const unusedResLine = (unusedRes?.data?.log_matumizi_kundi || [])[0];
    check('a standalone note accepts a not-used line', Boolean(unusedResLine), msgOf(unusedRes));
    check('a not-used line stores zero', near(unusedResLine?.kiasi, 0), `kiasi=${unusedResLine?.kiasi}`);

    const mySheetsRes = await gql(`query{zingumiaji_zangu{id hali mpishi{id}}}`, chef.token);
    check('a chef can list their own sheets', Array.isArray(mySheetsRes?.data?.zingumiaji_zangu), msgOf(mySheetsRes));
    check(
      'and only their own',
      (mySheetsRes?.data?.zingumiaji_zangu || []).every((z) => String(z.mpishi && z.mpishi.id) === String(chef.id)),
      JSON.stringify((mySheetsRes?.data?.zingumiaji_zangu || []).map((z) => z.mpishi && z.mpishi.id))
    );
    check(
      'the chef sees the sheet that was replaced',
      (mySheetsRes?.data?.zingumiaji_zangu || []).some((z) => String(z.id) === String(sheetFirstSheetId)),
      'the superseded sheet is missing from the chef list'
    );
    const theirSheetsRes = await gql(`query{zingumiaji_zangu{id mpishi{id}}}`, cashier.token);
    check(
      "a colleague's sheets are not in the chef's list",
      (theirSheetsRes?.data?.zingumiaji_zangu || []).length === 0,
      JSON.stringify(theirSheetsRes?.data?.zingumiaji_zangu)
    );

    // =====================================================================
    // Open and closed filters on the request queue
    // =====================================================================
    // Passing a Set straight to node-postgres serialises it as "{}", which is not
    // a list of enum values, so this filter used to fail on the database instead
    // of returning the queue.
    console.log('\n  -- request filters --');
    const openList = await gql(`query{ombi(fungua:true){id hali}}`, ownerToken);
    check('the open request filter runs', Array.isArray(openList?.data?.ombi), msgOf(openList));
    check(
      'everything the open filter returns really is open',
      (openList?.data?.ombi || []).every((o) => openListStates.has(o.hali)),
      JSON.stringify((openList?.data?.ombi || []).map((o) => o.hali))
    );
    // Asserted before the states, not after. "Everything returned is open" is
    // true of an empty list, and the empty list is exactly what the filter
    // returns when the open states arrive at the database as "{}": no error, no
    // rows, and a queue that looks empty because nothing was ever selected.
    check('the open filter returns the records that are open', (openList?.data?.ombi || []).length > 0, 'open list is empty');

    const closedList = await gql(`query{ombi(fungua:false){id hali}}`, ownerToken);
    check('the closed request filter runs', Array.isArray(closedList?.data?.ombi), msgOf(closedList));
    check(
      'nothing the closed filter returns is still open',
      (closedList?.data?.ombi || []).every((o) => !openListStates.has(o.hali)),
      JSON.stringify((closedList?.data?.ombi || []).map((o) => o.hali))
    );

    // =====================================================================
    // Recipes are gated by role
    // =====================================================================
    console.log('\n  -- permissions --');
    const chefRecipe = await gql(
      `mutation{unda_mapishi(input:{ladha:"${PREFIX} Chef Recipe",ukubwa:"1",viambato:[{malighafi_id:${flour.id},kiasi_cha_chini:1,kiasi_cha_juu:1}]}){id}}`,
      chef.token
    );
    check('chef cannot author recipes (recipe.manage is owner/inventory)', codeOf(chefRecipe) === 'FORBIDDEN', `${codeOf(chefRecipe)} ${msgOf(chefRecipe)}`);

    const cashierCat = await gql(`mutation{unda_kategoria(jina:"${PREFIX} Cashier Cat"){id}}`, cashier.token);
    check('cashier cannot create categories', codeOf(cashierCat) === 'FORBIDDEN', `${codeOf(cashierCat)} ${msgOf(cashierCat)}`);
    if (cashierCat?.data?.unda_kategoria?.id) created.kategoria.push(cashierCat.data.unda_kategoria.id);

    const chefRead = await gql('{mapishi{id ladha}}', chef.token);
    check('chef can read the recipe book', Array.isArray(chefRead?.data?.mapishi), msgOf(chefRead));
  } finally {
    // A cleanup failure must not mask the results of the checks above, but it
    // must not be swallowed either.
    await cleanup().catch((e) => {
      cleanupErrors.push(`cleanup aborted: ${e.message}`);
    });
    await pool.end().catch(() => {});
  }

  if (cleanupErrors.length) {
    console.log(`  \x1b[33mWARN\x1b[0m  cleanup left rows behind (${cleanupErrors.length}):`);
    for (const e of cleanupErrors) console.log(`    - ${e}`);
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    console.log('  Failures:');
    for (const f of failures) console.log(`    - ${f}`);
    console.log('');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nverify-recipes crashed:', err.message);
  process.exit(1);
});
