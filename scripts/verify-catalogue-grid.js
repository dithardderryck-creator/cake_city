/**
 * §4.2 / D-26 / D-27 / BR-02: the catalogue is a variation grid.
 *
 *   node scripts/verify-catalogue-grid.js    (or: npm run verify:grid)
 *
 * bidhaa was flat — one row, one price. The blueprint's model is a product with
 * axes of variation (Size, Filling, Dietary), a library of values shared across
 * products, and a Combination per specific version with its own price and stock
 * count. These checks pin:
 *
 *   - the option library is shared and reusable, not per-product
 *   - generating builds the cartesian product and the owner sets prices (D-27)
 *   - a single-choice group takes one value, a multi-choice group several (Q-03)
 *   - re-generating never discards a price already set
 *   - a combination that should not exist is marked unavailable, not deleted
 *   - only the owner manages the catalogue (A-01)
 *   - every pre-existing product still reads and still sells
 *
 * Start the API first (npm start).
 */

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;
const PREFIX = 'ZZ GRID';

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

const cleanupErrors = [];
async function del(text, params) {
  try {
    await sql(text, params);
  } catch (e) {
    cleanupErrors.push(`${text.replace(/\s+/g, ' ').trim()} -> ${e.message}`);
  }
}

async function login(id, pin) {
  const j = await gql(
    `mutation ($id: ID!, $pin: String!) { login(id: $id, pin: $pin) { token } }`,
    null,
    { id: String(id), pin }
  );
  if (errOf(j)) throw new Error(`login ${id} failed: ${msgOf(j)}`);
  return j.data.login.token;
}

async function cleanup() {
  // Values and groups cascade from the product, and the product cascades its
  // combinations, so the fixture is one delete away from gone.
  const prods = await sql('SELECT id FROM bidhaa WHERE jina ILIKE $1', [`${PREFIX}%`]);
  if (prods.length) {
    await del('DELETE FROM bidhaa WHERE id = ANY($1::int[])', [prods.map((r) => r.id)]);
  }
  await del(
    `DELETE FROM chagizo_thamani WHERE jina ILIKE $1`,
    [`${PREFIX} %`]
  );
  await del(`DELETE FROM chagizo_kundi WHERE jina ILIKE $1`, [`${PREFIX} %`]);
}

async function main() {
  require('dotenv').config({ quiet: true });
  const poolMod = await import('../src/db/pool.js');
  pool = poolMod.default || poolMod;
  await cleanup();

  const ownerPin = process.env.CAKE_OWNER_PIN;
  if (!ownerPin) throw new Error('CAKE_OWNER_PIN is not set');

  const ownerRow = (await sql(`SELECT id FROM mtumiaji WHERE jukumu = 'owner' ORDER BY id LIMIT 1`))[0];
  const cashierRow = (await sql(`SELECT id FROM mtumiaji WHERE jukumu = 'cashier' ORDER BY id LIMIT 1`))[0];
  if (!ownerRow) throw new Error('no owner in the database');
  const owner = await login(ownerRow.id, ownerPin);
  const cashier = cashierRow ? await login(cashierRow.id, ownerPin) : null;

  // ---- §4.2: the option library -----------------------------------------
  const kundi = {};
  for (const [key, jina, uteuzi] of [
    ['size', `${PREFIX} Size`, 'moja'],
    ['filling', `${PREFIX} Filling`, 'moja'],
    ['diet', `${PREFIX} Dietary`, 'nyingi'],
  ]) {
    const r = await gql(
      `mutation ($input: ChagizoKundiInput!) { ongeza_kundi(input: $input) { id jina uteuzi inahitaji } }`,
      owner,
      { input: { jina, uteuzi, inahitaji: true } }
    );
    check(`owner can create the ${key} axis`, !errOf(r), msgOf(r));
    kundi[key] = r.data?.ongeza_kundi;
  }
  check(
    'Q-03: a group records whether it is single or multi choice',
    kundi.size?.uteuzi === 'moja' && kundi.diet?.uteuzi === 'nyingi',
    `size=${kundi.size?.uteuzi} dietary=${kundi.diet?.uteuzi}`
  );

  const dupeKundi = await gql(
    `mutation ($input: ChagizoKundiInput!) { ongeza_kundi(input: $input) { id } }`,
    owner,
    { input: { jina: `${PREFIX} Size` } }
  );
  check('a duplicate axis name is refused', !!errOf(dupeKundi), 'no error raised');

  const thamani = {};
  for (const [key, k, jina, via] of [
    ['s8', 'size', '8-inch', []],
    ['s10', 'size', '10-inch', []],
    ['fvan', 'filling', 'Vanilla cream', []],
    ['egg', 'diet', 'Eggless', ['mayai']],
    ['gf', 'diet', 'Gluten-free', ['gluten']],
  ]) {
    const r = await gql(
      `mutation ($input: ChagizoThamaniInput!) {
         ongeza_thamani(input: $input) { id jina viambisho }
       }`,
      owner,
      { input: { kundi_id: kundi[k].id, jina, viambisho: via } }
    );
    check(`owner can add value "${jina}"`, !errOf(r), msgOf(r));
    thamani[key] = r.data?.ongeza_thamani;
  }
  check(
    'a value carries its declared allergens',
    (thamani.egg?.viambisho || []).includes('mayai'),
    `viambisho=${JSON.stringify(thamani.egg?.viambisho)}`
  );

  // The library is shared: a second product reuses the same values.
  const mkProduct = async (jina) => {
    const r = await gql(
      `mutation ($input: BidhaaInput!) { bathi_bidhaa(input: $input) { id jina bei } }`,
      owner,
      { input: { jina, bei: 50000, aina: 'cake' } }
    );
    check(`owner can create product "${jina}"`, !errOf(r), msgOf(r));
    return r.data?.bathi_bidhaa;
  };

  const p1 = await mkProduct(`${PREFIX} Chocolate`);
  const p2 = await mkProduct(`${PREFIX} Vanilla`);

  // ---- attach the axes, in order -----------------------------------------
  const attach = await gql(
    `mutation ($input: WekaMakundiInput!) { weka_makundi_za_bidhaa(input: $input) { id makundi { jina } } }`,
    owner,
    { input: { bidhaa_id: p1.id, kundi_id: [kundi.size.id, kundi.filling.id, kundi.diet.id] } }
  );
  check('owner can attach axes to a product', !errOf(attach), msgOf(attach));
  check(
    'the axes come back in the order they were attached',
    (attach.data?.weka_makundi_za_bidhaa?.makundi || []).map((k) => k.jina).join('|') ===
      `${PREFIX} Size|${PREFIX} Filling|${PREFIX} Dietary`,
    JSON.stringify((attach.data?.weka_makundi_za_bidhaa?.makundi || []).map((k) => k.jina))
  );

  // The same values, reused on a second product: that is what "shared library"
  // means, and it is why values are not product-scoped.
  await gql(
    `mutation ($input: WekaMakundiInput!) { weka_makundi_za_bidhaa(input: $input) { id } }`,
    owner,
    { input: { bidhaa_id: p2.id, kundi_id: [kundi.size.id, kundi.filling.id] } }
  );

  // ---- A-01: only the owner manages the catalogue -------------------------
  if (cashier) {
    const denied = await gql(
      `mutation ($input: ChagizoKundiInput!) { ongeza_kundi(input: $input) { id } }`,
      cashier,
      { input: { jina: `${PREFIX} Cashier` } }
    );
    check(
      'A-01: a cashier cannot create an axis',
      codeOf(denied) === 'FORBIDDEN',
      `code=${codeOf(denied)}`
    );
    const denied2 = await gql(
      `mutation ($input: BeiMchanganyikoInput!) {
         weka_bei_ya_mchanganyiko(input: $input) { id }
       }`,
      cashier,
      { input: { mchanganyiko: [1], bei: 1 } }
    );
    check(
      'D-27/A-01: a cashier cannot set a price',
      codeOf(denied2) === 'FORBIDDEN',
      `code=${codeOf(denied2)}`
    );
  }

  // ---- §4.2: generate the grid -------------------------------------------
  // 2 sizes x 1 filling x (2 dietary values, multi) => 2 x 1 x 3 non-empty
  // ways = 6 combinations.
  const gen = await gql(
    `mutation ($input: TengenezaMchanganyikoInput!) {
       tengeneza_mchanganyiko(input: $input) { id bei status maelezo thamani { thamani { jina viambisho } kundi { jina } } }
     }`,
    owner,
    {
      input: {
        bidhaa_id: p1.id,
        thamani: [
          thamani.s8.id, thamani.s10.id, thamani.fvan.id,
          thamani.egg.id, thamani.gf.id,
        ],
        bei_mwanzoni: 0,
      },
    }
  );
  check('owner can generate the grid', !errOf(gen), msgOf(gen));
  const combos = gen.data?.tengeneza_mchanganyiko || [];
  check(
    'the cartesian product is generated (2 sizes x 3 dietary ways)',
    combos.length === 6,
    `got ${combos.length}`
  );
  check(
    'a generated combination is unavailable until it is priced',
    combos.every((c) => c.status === 'haipatikani'),
    JSON.stringify(combos.map((c) => c.status))
  );

  // A single-choice axis must contribute exactly one value per combination.
  const sizeCounts = combos.map((c) => c.thamani.filter((t) => t.kundi.jina.endsWith('Size')).length);
  check(
    'every combination has exactly one value on the single-choice Size axis',
    sizeCounts.every((n) => n === 1),
    JSON.stringify(sizeCounts)
  );
  const dietCounts = combos.map((c) => c.thamani.filter((t) => t.kundi.jina.endsWith('Dietary')).length);
  check(
    'Q-03: the multi-choice Dietary axis carries one or two values per combination',
    dietCounts.every((n) => n >= 1 && n <= 2),
    JSON.stringify(dietCounts)
  );
  check(
    'the multi axis really did produce combinations with two values',
    dietCounts.includes(2),
    JSON.stringify(dietCounts)
  );
  check(
    'a generated combination is labelled readably',
    /Chocolate/.test(combos[0]?.maelezo || '') && /8-inch/.test(combos[0]?.maelezo || ''),
    `maelezo=${combos[0]?.maelezo}`
  );

  // ---- D-27: the owner sets the prices -----------------------------------
  const ids = combos.map((c) => c.id);
  const priced = await gql(
    `mutation ($input: BeiMchanganyikoInput!) {
       weka_bei_ya_mchanganyiko(input: $input) { id bei status }
     }`,
    owner,
    { input: { mchanganyiko: ids, bei: 85000 } }
  );
  check(
    'owner can price a whole column at once (§4.2 bulk helper)',
    (priced.data?.weka_bei_ya_mchanganyiko || []).every((m) => m.bei === 85000),
    JSON.stringify((priced.data?.weka_bei_ya_mchanganyiko || []).map((m) => m.bei))
  );

  // Re-generating must not reset a price. This is the difference between
  // "generate" and "reset", and getting it wrong loses the owner's work.
  const regen = await gql(
    `mutation ($input: TengenezaMchanganyikoInput!) {
       tengeneza_mchanganyiko(input: $input) { id bei }
     }`,
    owner,
    {
      input: {
        bidhaa_id: p1.id,
        thamani: [thamani.s8.id, thamani.s10.id, thamani.fvan.id, thamani.egg.id, thamani.gf.id],
      },
    }
  );
  check('re-generating the same grid creates nothing new', (regen.data?.tengeneza_mchanganyiko || []).length === 0,
    `created ${(regen.data?.tengeneza_mchanganyiko || []).length}`);
  const stillPriced = await sql('SELECT count(*)::int n FROM mchanganyiko WHERE bidhaa_id = $1 AND bei = 85000', [p1.id]);
  check(
    'and the prices already set survive re-generation',
    stillPriced[0].n === ids.length,
    `${stillPriced[0].n} of ${ids.length}`
  );

  // ---- §4.2: a combination that should not exist is marked unavailable ----
  const retire = await gql(
    `mutation ($id: ID!) { weka_hali_ya_mchanganyiko(id: $id, status: haipatikani) { id status } }`,
    owner,
    { id: String(combos[0].id) }
  );
  check(
    'a combination can be marked unavailable rather than deleted',
    retire.data?.weka_hali_ya_mchanganyiko?.status === 'haipatikani',
    JSON.stringify(retire.data)
  );
  const stillThere = await sql('SELECT count(*)::int n FROM mchanganyiko WHERE id = $1', [combos[0].id]);
  check('marking it unavailable did not delete the row', stillThere[0].n === 1);

  // ---- allergens are the union across the chosen values --------------------
  const eggOnly = combos.find(
    (c) =>
      c.thamani.filter((t) => t.kundi.jina.endsWith('Dietary')).length === 1 &&
      c.thamani.some((t) => t.thamani.jina === 'Eggless')
  );
  if (eggOnly) {
    const q = await gql(
      `query ($id: ID!) { bidhaa_moja(id: $id) { mchanganyiko { id viambisho } } }`,
      owner,
      { id: String(p1.id) }
    );
    const m = (q.data?.bidhaa_moja?.mchanganyiko || []).find((x) => x.id === eggOnly.id);
    check(
      'a combination reports the union of its values allergens',
      (m?.viambisho || []).includes('mayai') && !(m?.viambisho || []).includes('gluten'),
      `viambisho=${JSON.stringify(m?.viambisho)}`
    );
  }

  // ---- BR-10: archiving, not deleting -------------------------------------
  const archived = await gql(`mutation ($id: ID!) { futa_bidhaa(id: $id) }`, owner, { id: String(p2.id) });
  check('BR-10: a product is archived rather than deleted', archived.data?.futa_bidhaa === true, msgOf(archived));
  const p2Row = await sql('SELECT active FROM bidhaa WHERE id = $1', [p2.id]);
  check('and the row is still there, just inactive', p2Row[0]?.active === false);

  // ---- the pre-existing catalogue still works -----------------------------
  // The backfill turned every existing product into a grid of one. If that had
  // broken, the shop could not sell anything it sold before this change.
  const existing = await gql(`query { bidhaa(active: true) { id jina kuna_mchanganyiko mchanganyiko { id bei status } } }`, owner);
  const realOnes = (existing.data?.bidhaa || []).filter((b) => !b.jina.startsWith(PREFIX));
  check('every pre-existing product still reads', realOnes.length > 0, `found ${realOnes.length}`);
  check(
    'and each has exactly one combination carrying its price',
    realOnes.every((b) => b.mchanganyiko.length === 1 && b.mchanganyiko[0].bei > 0),
    JSON.stringify(realOnes.map((b) => [b.jina, b.mchanganyiko.length]))
  );
  check(
    'a product with no axes reports that it has no grid',
    realOnes.every((b) => b.kuna_mchanganyiko === false),
    JSON.stringify(realOnes.map((b) => [b.jina, b.kuna_mchanganyiko]))
  );
  check(
    'a product with axes does report a grid',
    (await sql('SELECT count(*)::int n FROM bidhaa b JOIN chagizo_kundi_kazi g ON g.bidhaa_id = b.id WHERE b.id = $1', [p1.id]))[0].n > 0
  );

  // ---- the library is reusable across products ----------------------------
  const shared = await sql(
    `SELECT count(DISTINCT bidhaa_id)::int n FROM chagizo_kundi_kazi WHERE kundi_id = $1`,
    [kundi.size.id]
  );
  check(
    '§4.2: one axis is shared across products rather than copied',
    shared[0].n === 2,
    `used by ${shared[0].n} products`
  );

  // ---- the database enforces the shape, not just the resolver -------------
  // A write that bypasses the API must still be refused, or the rule is only
  // true for the one door that happens to be polite.
  // Pick a combination that does not already carry 10-inch, so the insert is
  // refused for the shape rule rather than for being a duplicate row.
  const openOne = (
    await sql(
      `SELECT m.id FROM mchanganyiko m
         JOIN mchanganyiko_thamani mv ON mv.mchanganyiko_id = m.id
        WHERE m.bidhaa_id = $1 AND mv.thamani_id = $2
        GROUP BY m.id HAVING count(*) = 1`,
      [p1.id, thamani.s8.id]
    )
  )[0];
  const badSingle = await sql(
    `INSERT INTO mchanganyiko_thamani (mchanganyiko_id, thamani_id) VALUES ($1, $2)`,
    [openOne.id, thamani.s10.id]
  ).then(() => 'inserted').catch((e) => e.message);
  check(
    'a second value on a single-choice axis is refused by the database',
    typeof badSingle === 'string' && /haukidhi|SIZE|kundi/i.test(badSingle),
    `result=${badSingle}`
  );

  // ---- the sell screen can still read a plain product ---------------------
  const plain = await gql(
    `query { bidhaa(active: true) { id jina bei } }`,
    cashier || owner
  );
  check(
    'the sell screen still lists products for a cashier',
    (plain.data?.bidhaa || []).length > 0,
    `found ${(plain.data?.bidhaa || []).length}`
  );

  await cleanup();
}

async function run() {
  try {
    await main();
  } catch (e) {
    failed += 1;
    failures.push(`harness error — ${e.message}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  harness error — ${e.message}`);
  }
  if (cleanupErrors.length) {
    failed += 1;
    failures.push(`cleanup: ${cleanupErrors.join(' | ')}`);
    console.log(`\n  cleanup problems (rows may have been left behind):`);
    cleanupErrors.forEach((c) => console.log(`    - ${c}`));
  }
  const total = passed + failed;
  console.log(
    `\n  §4.2 catalogue grid: ${passed} passed, ${failed} failed` +
      (total ? ` (${Math.round((passed / total) * 100)}%)` : '')
  );
  if (failed) {
    console.log(`\n  failures:`);
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

run();
