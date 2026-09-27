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
    check('fixtures: chef and cashier accounts created', Boolean(chef.token && cashier.token));

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
        `mutation{tumia_ombi(kwenda_kwa:${target.id},ujumbe:"${PREFIX} tafadhali ${label}"){id kwenda_kwa{id} hali}}`,
        ownerToken
      );
      const ombiId = sent?.data?.tumia_ombi?.id;
      created.ombi.push(ombiId);
      check(`§3.3 ${label} can be sent a request`, Boolean(ombiId), msgOf(sent));

      // The wrong person must still be refused — this is the control that
      // makes the widened permission in §3.3 safe. Only meaningful when the
      // chef is NOT the recipient; running it otherwise would have the chef
      // close their own request and make the real check below fail.
      if (String(target.id) !== String(chef.id)) {
        const wrong = await gql(`mutation{fungua_ombi(id:${ombiId},jibu:"not mine"){id}}`, chef.token);
        check(`§3.3 ${label}'s request cannot be closed by the chef`, codeOf(wrong) === 'FORBIDDEN', `${codeOf(wrong)} ${msgOf(wrong)}`);
      }

      const closed = await gql(`mutation{fungua_ombi(id:${ombiId},jibu:"imefanyika"){id hali jibu}}`, target.token);
      check(
        `§3.3 ${label} can close a request addressed to them`,
        closed?.data?.fungua_ombi?.hali === 'imefanyika',
        `${codeOf(closed)} ${msgOf(closed)}`
      );

      const again = await gql(`mutation{fungua_ombi(id:${ombiId},jibu:"tena"){id}}`, target.token);
      check(`§3.3 ${label} cannot double-close`, codeOf(again) === 'ALREADY_CLOSED', `${codeOf(again)} ${msgOf(again)}`);
    }

    // The owner can still close anything.
    const toChef = await gql(`mutation{tumia_ombi(kwenda_kwa:${chef.id},ujumbe:"${PREFIX} owner close"){id}}`, ownerToken);
    created.ombi.push(toChef?.data?.tumia_ombi?.id);
    const ownerClose = await gql(`mutation{fungua_ombi(id:${toChef?.data?.tumia_ombi?.id},jibu:"na owner"){hali}}`, ownerToken);
    check('§3.3 owner can still close any request', ownerClose?.data?.fungua_ombi?.hali === 'imefanyika', msgOf(ownerClose));

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
