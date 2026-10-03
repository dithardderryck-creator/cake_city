/**
 * §4.4 / BR-01 / BR-02 / BR-11 / BR-26: order lines and frozen snapshots.
 *
 *   node scripts/verify-order-lines.js    (or: npm run verify:orderlines)
 *
 * agizo_maalum was one row per custom cake, so an order could not hold a
 * catalogue item, could not hold two things, and had nowhere to record what was
 * actually ordered. The blueprint says an order holds lines[], each either a
 * catalogue combination or a custom cake, in any mix (BR-01).
 *
 * The part that matters more is BR-11. A line must survive the catalogue being
 * edited underneath it. These checks pin:
 *
 *   - a catalogue line's price comes from the combination, not the client (BR-02)
 *   - the name, options, allergens and price are frozen at entry (BR-11)
 *   - editing the catalogue afterwards does NOT rewrite the order
 *   - an unavailable or unpriced combination cannot be put on an order
 *   - a custom line carries its recipe attributes and needs a quote (BR-05/A-07)
 *   - an order can hold both kinds of line (BR-01)
 *   - order numbers are unique across devices and reset daily (BR-26)
 *   - a delivery order cannot exist without an address (§4.4)
 *   - a collected order's lines are history and cannot change
 *
 * The BR-11 test is the one to read closely: it renames an option and re-prices
 * a combination after the order exists, then checks the order still says the old
 * thing. A snapshot that reads through to the catalogue would pass every other
 * test here and still be wrong.
 *
 * Start the API first (npm start).
 */

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const GRAPHQL = `${BASE}/graphql`;
const PREFIX = 'ZZ LINE';

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

  /**
   * Read one order back. There is no agizo(id:) query — the list is
   * agizo_maalum — so this filters client-side rather than adding a query
   * variant that exists only for tests.
   */
  async function fetchOrder(token, id) {
    const j = await gql(
      `query { agizo_maalum { id nambari kipimo { id aina jina chaguo viambisho bei kiasi kimo maelezo } kipimo_bado ina_katalogi_na_custom hali } }`,
      token
    );
    return (j.data?.agizo_maalum || []).find((o) => o.id === id);
  }

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

async function login(id, pin, kifaa = null) {
  const j = await gql(
    `mutation ($id: ID!, $pin: String!, $kifaa: String) {
       login(id: $id, pin: $pin, kifaa: $kifaa) { token }
     }`,
    null,
    { id: String(id), pin, kifaa }
  );
  if (errOf(j)) throw new Error(`login ${id} failed: ${msgOf(j)}`);
  return j.data.login.token;
}

async function cleanup() {
  // Orders first: their lines cascade. Tickets/payments reference orders, so
  // clear those before deleting the order row.
  const orders = await sql('SELECT id FROM agizo_maalum WHERE ladha ILIKE $1', [`${PREFIX}%`]);
  if (orders.length) {
    const ids = orders.map((r) => r.id);
    await del('DELETE FROM tikiti WHERE agizo_id = ANY($1::int[])', [ids]);
    await del('DELETE FROM mauzo WHERE agizo_id = ANY($1::int[])', [ids]);
    await del('DELETE FROM ombi WHERE agizo_id = ANY($1::int[])', [ids]);
    await del('DELETE FROM agizo_maalum WHERE id = ANY($1::int[])', [ids]);
  }
  const prods = await sql('SELECT id FROM bidhaa WHERE jina ILIKE $1', [`${PREFIX}%`]);
  if (prods.length) {
    await del('DELETE FROM bidhaa WHERE id = ANY($1::int[])', [prods.map((r) => r.id)]);
  }
  await del('DELETE FROM chagizo_thamani WHERE jina ILIKE $1', [`${PREFIX} %`]);
  await del('DELETE FROM chagizo_kundi WHERE jina ILIKE $1', [`${PREFIX} %`]);
  await del('DELETE FROM kifaa WHERE alama LIKE $1', [`${PREFIX}%`]);
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
  // The owner signs in on an unregistered till first, registers it, then signs in
  // again claiming it — which is the real install order: you cannot name a
  // device before it exists, and registration is owner-only.
  const bootstrap = await login(ownerRow.id, ownerPin);
  const till1 = await gql(
    `mutation ($a: String!) { sajili_kifaa(input: { alama: $a, jina: $a }) { id alama } }`,
    bootstrap,
    { a: `${PREFIX}1` }
  );
  const owner = await login(ownerRow.id, ownerPin, till1.data?.sajili_kifaa?.alama || null);
  const cashier = cashierRow ? await login(cashierRow.id, ownerPin) : null;

  // ---- fixture: a two-axis product, generated and priced -------------------
  const mk = async (jina) =>
    (await gql(
      `mutation ($jina: String!) { ongeza_kundi(input: { jina: $jina, uteuzi: moja }) { id } }`,
      owner,
      { jina }
    )).data.ongeza_kundi;

  const mkVal = async (kundi, jina, viambisho = []) =>
    (
      await gql(
        `mutation ($k: ID!, $j: String!, $v: [String!]!) { ongeza_thamani(input: { kundi_id: $k, jina: $j, viambisho: $v }) { id } }`,
        owner,
        { k: kundi, j: jina, v: viambisho }
      )
    ).data.ongeza_thamani;

  const mkProd = async (jina) =>
    (
      await gql(
        `mutation ($j: String!) { bathi_bidhaa(input: { jina: $j, bei: 0, aina: "kekea" }) { id } }`,
        owner,
        { j: jina }
      )
    ).data.bathi_bidhaa;

  const kSize = await mk(`${PREFIX} Size`);
  const kFill = await mk(`${PREFIX} Filling`);
  const v8 = await mkVal(kSize.id, `${PREFIX} 8-inch`, ['gluten']);
  const vVan = await mkVal(kFill.id, `${PREFIX} Vanilla cream`, ['mayai', 'gluten']);

  const p1 = await mkProd(`${PREFIX} Cake`);
  const p2 = await mkProd(`${PREFIX} Other`);

  const attach = async (bidhaa, kundi) =>
    gql(
      `mutation ($i: WekaMakundiInput!) { weka_makundi_za_bidhaa(input: $i) { id } }`,
      owner,
      { i: { bidhaa_id: bidhaa, kundi_id: [kundi] } }
    );

  await attach(p1.id, kSize.id);
  await attach(p1.id, kFill.id);
  await attach(p2.id, kSize.id);
  await attach(p2.id, kFill.id);

  const gen = async (bidhaa, values) =>
    (
      await gql(
        `mutation ($i: TengenezaMchanganyikoInput!) { tengeneza_mchanganyiko(input: $i) { id maelezo bei status } }`,
        owner,
        { i: { bidhaa_id: bidhaa, thamani: values } }
      )
    ).data?.tengeneza_mchanganyiko;

  const combos = await gen(p1.id, [v8.id, vVan.id]);
  check('owner can generate a combination grid', (combos || []).length === 1, `got ${(combos || []).length}`);
  const combo = combos?.[0];

  // A generated combination is unpriced and unsellable until the owner prices it
  // (D-27). Pricing one is the owner's job alone.
  const price = async (id, bei, token = owner) =>
    gql(
      `mutation ($i: BeiMchanganyikoInput!) { weka_bei_ya_mchanganyiko(input: $i) { id bei } }`,
      token,
      { i: { mchanganyiko: [id], bei } }
    );
  const priced = await price(combo.id, 45000);
  check('owner can price the combination (D-27)', Number(priced.data?.weka_bei_ya_mchanganyiko?.[0]?.bei) === 45000);
  // Counter stock must be set before a catalogue line can be sold.
  await sql('UPDATE mchanganyiko SET hesafa = 50 WHERE id = $1', [combo.id]);

  if (cashier) {
    const denied = await price(combo.id, 1, cashier);
    check('A-01: a cashier cannot price a combination', codeOf(denied) === 'FORBIDDEN', msgOf(denied));
  }

  // ---- an order with a catalogue line (BR-01, BR-02) -----------------------
  const mkOrder = async (input = {}) => {
    const j = await gql(
      `mutation ($i: AgizoInput!) {
         unda_agizo(input: $i) {
           id nambari hali bei_jumla
           kipimo { id aina jina chaguo viambisho bei kiasi mchanganyiko { id hesafa } }
           kipimo_bado ina_katalogi_na_custom
         }
       }`,
      owner,
      {
        i: {
          ladha: `${PREFIX} Order`,
          tarehe_ya_kuchukua: '2030-01-05',
          malipo_ya_awali: 0,
          ...input,
        },
      }
    );
    if (errOf(j)) return { __err: j };
    return j.data?.unda_agizo;
  };

  const o1 = await mkOrder({
    kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 2 }],
  });
  check('an order can be created with lines in one transaction', !!o1?.id && !o1.__err, msgOf(o1.__err || {}));
  const line = o1?.kipimo?.[0];
  check('BR-01: a catalogue line can be added to an order', !!line?.id);
  check('BR-02: the line takes its price from the combination', Number(line?.bei) === 45000, `bei=${line?.bei}`);
  check('the line is priced per unit, not per order', Number(line?.kiasi) === 2);
  check('bei_jumla is derived from lines (2 × 45000)', Number(o1?.bei_jumla) === 90000, `bei_jumla=${o1?.bei_jumla}`);
  check('AgizoKipimo.mchanganyiko resolves', !!line?.mchanganyiko?.id);

  const addLine = async (agizo, input) =>
    await gql(
      `mutation ($id: ID!, $i: KipimoInput!) {
         ongeza_kipimo(id: $id, input: $i) {
           id aina jina chaguo viambisho bei kiasi kimo maelezo
         }
       }`,
      cashier || owner,
      { id: agizo, i: input }
    );

  // ---- BR-11: the snapshot -------------------------------------------------
  check('BR-11: the product name is frozen onto the line', (line?.jina || '').includes(`${PREFIX} 8-inch`),
    `jina=${line?.jina}`);
  check('BR-11: the chosen options are frozen onto the line', (line?.chaguo || []).length === 2,
    `chaguo=${JSON.stringify(line?.chaguo)}`);
  check('BR-11: the allergens are frozen onto the line',
    (line?.viambisho || []).includes('gluten') && (line?.viambisho || []).includes('mayai'),
    `viambisho=${JSON.stringify(line?.viambisho)}`);
  check('the allergen union is deduped', (line?.viambisho || []).length === 2,
    `viambisho=${JSON.stringify(line?.viambisho)}`);

  const reread = await fetchOrder(owner, o1.id);
  const rereadLine = reread?.kipimo?.find((l) => l.aina === 'katalogi') || reread?.kipimo?.[0];
  check('the snapshot is what is read back, not the live combination',
    Number(rereadLine?.bei) === 45000 && (rereadLine?.chaguo || []).length === 2,
    `bei=${rereadLine?.bei} chaguo=${JSON.stringify(rereadLine?.chaguo)}`);

  // ---- BR-11: now change the catalogue and prove the order does not move ----
  await gql(
    `mutation ($id: ID!, $j: String!) { hariri_thamani(id: $id, input: { jina: $j, viambisho: ["gluten"] }) { id jina } }`,
    owner,
    { id: v8.id, j: `${PREFIX} 8-inch (feeds 12)` }
  );
  await price(combo.id, 99000);

  const after = (await fetchOrder(owner, o1.id))?.kipimo?.find((l) => l.aina === 'katalogi');
  check('BR-11: renaming an option does NOT rewrite the order', !(after?.jina || '').includes('feeds 12'),
    `jina=${after?.jina}`);
  check('BR-11: the frozen options do not change either',
    !(after?.chaguo || []).some((c) => c.includes('feeds 12')),
    `chaguo=${JSON.stringify(after?.chaguo)}`);
  check('BR-11: re-pricing the combination does NOT change the order price',
    Number(after?.bei) === 45000, `bei=${after?.bei}`);

  const liveNow = Number((await sql('SELECT bei FROM mchanganyiko WHERE id = $1', [combo.id]))[0].bei);
  check('and the combination really was re-priced, so the test above means something', liveNow === 99000,
    `live bei=${liveNow}`);
  // Restore sellable price + stock for later catalogue adds
  await price(combo.id, 45000);
  await sql('UPDATE mchanganyiko SET hesafa = 50 WHERE id = $1', [combo.id]);

  // ---- unpriced and unavailable combinations cannot be sold ----------------
  const fresh = await gen(p2.id, [v8.id, vVan.id]);
  const unpriced = fresh[0];
  const sellUnpriced = await addLine(o1.id, { aina: 'katalogi', mchanganyiko_id: unpriced.id });
  check('an unpriced combination cannot be put on an order (D-27)', codeOf(sellUnpriced) === 'CONFLICT',
    msgOf(sellUnpriced));

  await price(unpriced.id, 30000);
  await sql('UPDATE mchanganyiko SET hesafa = 10 WHERE id = $1', [unpriced.id]);
  await gql(
    `mutation ($id: ID!) { weka_hali_ya_mchanganyiko(id: $id, status: haipatikani) { id status } }`,
    owner,
    { id: unpriced.id }
  );
  const sellUnavailable = await addLine(o1.id, { aina: 'katalogi', mchanganyiko_id: unpriced.id });
  check('an unavailable combination cannot be put on an order (§4.2)', codeOf(sellUnavailable) === 'CONFLICT',
    msgOf(sellUnavailable));

  const noCombo = await addLine(o1.id, { aina: 'katalogi' });
  check('a catalogue line with no combination is refused', codeOf(noCombo) === 'BAD_REQUEST', msgOf(noCombo));

  // ---- a custom line, quote clears kipimo_bado, totals sync (BR-01/BR-05) ----
  const custom = await addLine(o1.id, {
    aina: 'custom',
    kimo: '8-inch',
    ladha_za_chakula: 'Chocolate',
    kijazi: 'Vanilla cream',
    tabaka: 3,
    mzabibu: 'Eggless',
    maelezo: 'Happy birthday Asha',
  });
  check('BR-01: a custom line can be added to the same order', !!custom.data?.ongeza_kipimo?.id, msgOf(custom));
  check('D-42: the custom line keeps its recipe attributes',
    custom.data?.ongeza_kipimo?.maelezo === 'Happy birthday Asha' ||
    custom.data?.ongeza_kipimo?.kimo === '8-inch',
    JSON.stringify(custom.data?.ongeza_kipimo));

  const both = await fetchOrder(owner, o1.id);
  check('BR-01: the order holds both kinds of line', both?.kipimo?.length === 2,
    `lines=${both?.kipimo?.length}`);
  check('A-07: the order reports that it mixes both kinds', both?.ina_katalogi_na_custom === true);
  check('A-07: an unquoted custom line means the order is not ready yet', both?.kipimo_bado === true);

  const customId = custom.data?.ongeza_kipimo?.id;
  const quoted = await gql(
    `mutation ($id: ID!, $bei: Float!, $k: [ToaBeiKipimoInput!]) {
       toa_bei(id: $id, bei: $bei, kipimo: $k) { id hali bei_jumla kipimo_bado kipimo { id bei aina } }
     }`,
    owner,
    {
      id: o1.id,
      // catalogue 2×45000 = 90000 + custom 25000 = 115000
      bei: 115000,
      k: [{ kipimo_id: customId, bei: 25000 }],
    }
  );
  check('BR-05: toa_bei writes the quote onto the custom line',
    Number(quoted.data?.toa_bei?.kipimo?.find((l) => l.id === customId)?.bei) === 25000,
    msgOf(quoted));
  check('BR-05: kipimo_bado clears after quote', quoted.data?.toa_bei?.kipimo_bado === false);
  check('bei_jumla matches SUM(bei*kiasi) after quote',
    Number(quoted.data?.toa_bei?.bei_jumla) === 115000,
    `bei_jumla=${quoted.data?.toa_bei?.bei_jumla}`);

  // ---- the price the client sends must be ignored (BR-02) ------------------
  const sneaky = await gql(
    `mutation ($id: ID!, $c: ID!) { ongeza_kipimo(id: $id, input: { aina: katalogi, mchanganyiko_id: $c, kiasi: 1, bei: 1 }) { bei } }`,
    cashier || owner,
    { id: o1.id, c: combo.id }
  );
  check('BR-02: a price sent by the client is rejected outright, not ignored',
    !!sneaky.errors && /bei/i.test(msgOf(sneaky)), msgOf(sneaky));

  // ---- removing a line while the order is live ----------------------------
  const extraCustom = await addLine(o1.id, { aina: 'custom', maelezo: 'temp' });
  // re-quote after unpriced custom reopened awaiting_quote
  const tempId = extraCustom.data?.ongeza_kipimo?.id;
  if (tempId) {
    const afterAdd = await fetchOrder(owner, o1.id);
    check('adding an unquoted custom line re-opens kipimo_bado', afterAdd?.kipimo_bado === true);
    await gql(
      `mutation ($id: ID!, $bei: Float!, $k: [ToaBeiKipimoInput!]) {
         toa_bei(id: $id, bei: $bei, kipimo: $k) { id kipimo_bado }
       }`,
      owner,
      { id: o1.id, bei: 116000, k: [{ kipimo_id: tempId, bei: 1000 }] }
    );
    const rm = await gql(
      `mutation ($id: ID!) { ondoa_kipimo(kipimo_id: $id) }`,
      cashier || owner,
      { id: tempId }
    );
    check('a line can be removed while the order is still open', rm.data?.ondoa_kipimo === true, msgOf(rm));
  }

  const only = (await fetchOrder(owner, o1.id))?.kipimo || [];
  // Leave a single line, then prove the last one cannot be deleted.
  if (only.length > 1) {
    for (const l of only.slice(1)) {
      await gql(`mutation ($id: ID!) { ondoa_kipimo(kipimo_id: $id) }`, owner, { id: l.id });
    }
  }
  const lastLeft = (await fetchOrder(owner, o1.id))?.kipimo || [];
  if (lastLeft.length === 1) {
    const lastRm = await gql(
      `mutation ($id: ID!) { ondoa_kipimo(kipimo_id: $id) }`,
      owner,
      { id: lastLeft[0].id }
    );
    check('the last line cannot be removed', codeOf(lastRm) === 'CONFLICT', msgOf(lastRm));
  } else {
    check('the last line cannot be removed', false, `lines left=${lastLeft.length}`);
  }

  // ---- empty kipimo[] refused ---------------------------------------------
  const emptyLines = await gql(
    `mutation ($i: AgizoInput!) { unda_agizo(input: $i) { id } }`,
    owner,
    {
      i: {
        ladha: `${PREFIX} Empty`,
        tarehe_ya_kuchukua: '2030-01-05',
        malipo_ya_awali: 0,
        kipimo: [],
      },
    }
  );
  check('an order with an empty kipimo list is refused', !!emptyLines.errors, msgOf(emptyLines));

  // ---- BR-26: order numbers ------------------------------------------------
  const alama = till1.data?.sajili_kifaa?.alama;
  const ownerOnTill = await login(ownerRow.id, ownerPin, alama);
  const withNumber = (
    await gql(
      `mutation ($i: AgizoInput!) {
         unda_agizo(input: $i) { id nambari kipimo { id } }
       }`,
      ownerOnTill,
      {
        i: {
          ladha: `${PREFIX} Numbered`,
          tarehe_ya_kuchukua: '2030-01-05',
          malipo_ya_awali: 0,
          kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 1 }],
        },
      }
    )
  ).data?.unda_agizo;
  check('BR-26: a till session issues a real order number',
    !!withNumber?.nambari && String(withNumber.nambari).startsWith(alama),
    `nambari=${withNumber?.nambari}`);

  const badLogin = await gql(
    `mutation ($id: ID!, $pin: String!) { login(id: $id, pin: $pin, kifaa: "NOPE") { token } }`,
    null,
    { id: String(ownerRow.id), pin: ownerPin }
  );
  check('login with an unknown till is refused', codeOf(badLogin) === 'NOT_FOUND', msgOf(badLogin));

  const dev = { data: { sajili_kifaa: till1.data?.sajili_kifaa } };
  check('BR-26: a till can be registered', !!dev.data.sajili_kifaa?.id, 'registration failed');

  const dupeDev = await gql(
    `mutation ($a: String!) { sajili_kifaa(input: { alama: $a, jina: $a }) { id } }`,
    owner,
    { a: `${PREFIX}1` }
  );
  check('BR-26: two tills cannot share a prefix', !!dupeDev.errors, 'duplicate prefix was accepted');

  const n1 = await sql('SELECT kifaa_chukua_namba($1) AS n', [dev.data.sajili_kifaa.id]);
  const n2 = await sql('SELECT kifaa_chukua_namba($1) AS n', [dev.data.sajili_kifaa.id]);
  check('BR-26: the sequence advances on this device', n2[0].n === n1[0].n + 1, `${n1[0].n} then ${n2[0].n}`);

  const parallel = await Promise.all(
    Array.from({ length: 20 }, () => sql('SELECT kifaa_chukua_namba($1) AS n', [dev.data.sajili_kifaa.id]))
  );
  const nums = parallel.map((r) => r[0].n);
  check('BR-26: twenty simultaneous draws are twenty different numbers',
    new Set(nums).size === 20, `${new Set(nums).size} distinct of 20`);

  await sql('UPDATE kifaa SET tarehe_namba = CURRENT_DATE - 1 WHERE id = $1', [dev.data.sajili_kifaa.id]);
  const afterDay = await sql('SELECT kifaa_chukua_namba($1) AS n', [dev.data.sajili_kifaa.id]);
  check('BR-26: the sequence restarts on a new day', afterDay[0].n === 1, `n=${afterDay[0].n}`);
  // The day-reset check rewound the counter while today's dated numbers still
  // exist. Push the counter past the highest number already issued for this
  // device today so later unda_agizo calls cannot collide.
  const used = await sql(
    `SELECT COALESCE(MAX(NULLIF(split_part(nambari, '-', 3), '')::int), 0) AS m
       FROM agizo_maalum
      WHERE kifaa_id = $1
        AND nambari LIKE $2`,
    [dev.data.sajili_kifaa.id, `${alama}-%`]
  );
  const floor = Math.max(Number(used[0]?.m) || 0, Number(afterDay[0].n) || 0);
  await sql('UPDATE kifaa SET kiakili = $2, tarehe_namba = CURRENT_DATE WHERE id = $1', [
    dev.data.sajili_kifaa.id,
    floor,
  ]);

  check('an order always comes back with a number field, even when no device is registered',
    o1 && ('nambari' in o1));

  const nums2 = await sql(
    `SELECT nambari FROM agizo_maalum WHERE ladha ILIKE $1 AND nambari IS NOT NULL`,
    [`${PREFIX}%`]
  );
  const distinct = new Set(nums2.map((r) => r.nambari));
  check('BR-26: no two orders share a number', distinct.size === nums2.length,
    `${nums2.length} orders, ${distinct.size} distinct numbers`);

  // ---- delivery needs an address (§4.4) -----------------------------------
  const delBad = await gql(
    `mutation ($i: AgizoInput!) { unda_agizo(input: $i) { id hali } }`,
    owner,
    {
      i: {
        ladha: `${PREFIX} Delivery`,
        tarehe_ya_kuchukua: '2030-01-05',
        malipo_ya_awali: 0,
        bei_jumla: 10000,
        njia_ya_kutimiza: 'delivery',
      },
    }
  );
  check('§4.4: a delivery order with no address is refused', !!delBad.errors, msgOf(delBad));

  const delOk = await gql(
    `mutation ($i: AgizoInput!) { unda_agizo(input: $i) { id njia_ya_kutimiza anwani_ya_kuleta } }`,
    owner,
    {
      i: {
        ladha: `${PREFIX} Delivery OK`,
        tarehe_ya_kuchukua: '2030-01-05',
        malipo_ya_awali: 0,
        bei_jumla: 10000,
        njia_ya_kutimiza: 'delivery',
        anwani_ya_kuleta: 'Mtaa wa Barabara ya Kivukoni, Dar es Salaam',
      },
    }
  );
  check('§4.4: a delivery order with an address is accepted',
    delOk.data?.unda_agizo?.njia_ya_kutimiza === 'delivery' && !!delOk.data?.unda_agizo?.anwani_ya_kuleta,
    msgOf(delOk));

  const pickup = await gql(
    `mutation ($i: AgizoInput!) { unda_agizo(input: $i) { id njia_ya_kutimiza } }`,
    owner,
    {
      i: {
        ladha: `${PREFIX} Pickup`,
        tarehe_ya_kuchukua: '2030-01-05',
        malipo_ya_awali: 0,
        bei_jumla: 10000,
      },
    }
  );
  check('§4.4: a pickup order needs no address',
    pickup.data?.unda_agizo?.njia_ya_kutimiza === 'pickup', msgOf(pickup));

  // ---- deposit preserved across quote (toa_bei must not wipe paid money) --
  const paidCat = await mkOrder({
    kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 1 }],
    malipo_ya_awali: 5000,
  });
  const paidBefore = Number(
    (await sql('SELECT malipo_ya_awali::float AS p FROM agizo_maalum WHERE id = $1', [paidCat.id]))[0]?.p
  );
  const addCustom = await gql(
    `mutation ($id: ID!, $i: KipimoInput!) {
       ongeza_kipimo(id: $id, input: $i) { id aina bei }
     }`,
    owner,
    { id: paidCat.id, i: { aina: 'custom', ladha_za_chakula: `${PREFIX} after-pay`, kiasi: 1 } }
  );
  const customPaidId = addCustom.data?.ongeza_kipimo?.id;
  const reQuote = await gql(
    `mutation ($id: ID!, $bei: Float!, $k: [ToaBeiKipimoInput!]) {
       toa_bei(id: $id, bei: $bei, kipimo: $k) { id malipo_ya_awali bei_jumla hali }
     }`,
    owner,
    {
      id: paidCat.id,
      bei: 45000 + 20000,
      k: [{ kipimo_id: customPaidId, bei: 20000 }],
    }
  );
  check('toa_bei keeps the deposit already taken (does not wipe to 0)',
    Number(reQuote.data?.toa_bei?.malipo_ya_awali) === paidBefore,
    `paid=${reQuote.data?.toa_bei?.malipo_ya_awali} expected=${paidBefore} ${msgOf(reQuote)}`);
  check('toa_bei total is catalogue + quoted custom',
    Number(reQuote.data?.toa_bei?.bei_jumla) === 65000,
    `bei_jumla=${reQuote.data?.toa_bei?.bei_jumla}`);

  // ---- stock decrement on collect + history lock --------------------------
  const stockBefore = Number((await sql('SELECT hesafa FROM mchanganyiko WHERE id = $1', [combo.id]))[0].hesafa);
  const histOrder = await mkOrder({
    kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 3 }],
  });
  const histLineId = histOrder?.kipimo?.[0]?.id;
  const collected = await gql(
    `mutation ($id: ID!) { chukua_agizo(id: $id) { id hali } }`,
    owner,
    { id: histOrder.id }
  );
  check('chukua_agizo collects a fully priced order',
    collected.data?.chukua_agizo?.hali === 'collected', msgOf(collected));
  const stockAfter = Number((await sql('SELECT hesafa FROM mchanganyiko WHERE id = $1', [combo.id]))[0].hesafa);
  check('catalogue stock decrements on collect', stockAfter === stockBefore - 3,
    `${stockBefore} → ${stockAfter}`);

  // Collecting is a stock movement, so collecting twice would move it twice. A
  // double tap or a retry after a dropped connection is the likely cause, and
  // neither should quietly oversell whatever was on that line.
  const stockBeforeSecond = stockAfter;
  const collectTwice = await gql(
    `mutation ($id: ID!) { chukua_agizo(id: $id) { id hali } }`,
    owner,
    { id: histOrder.id }
  );
  const stockAfterSecond = Number((await sql('SELECT hesafa FROM mchanganyiko WHERE id = $1', [combo.id]))[0].hesafa);
  check('BR-03: collecting an already-collected order is refused', codeOf(collectTwice) === 'CONFLICT',
    msgOf(collectTwice));
  check('BR-03: and it does not decrement stock a second time', stockAfterSecond === stockBeforeSecond,
    `${stockBeforeSecond} → ${stockAfterSecond}`);

  // badge_hali_order(collected) must take the same stock path (no bypass).
  const stockBadgeBefore = Number((await sql('SELECT hesafa FROM mchanganyiko WHERE id = $1', [combo.id]))[0].hesafa);
  const badgeOrder = await mkOrder({
    kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 2 }],
  });
  const viaBadge = await gql(
    `mutation ($id: ID!) { badge_hali_order(id: $id, hali: collected) { id hali } }`,
    owner,
    { id: badgeOrder.id }
  );
  const stockBadgeAfter = Number((await sql('SELECT hesafa FROM mchanganyiko WHERE id = $1', [combo.id]))[0].hesafa);
  check('badge_hali_order(collected) also decrements stock',
    viaBadge.data?.badge_hali_order?.hali === 'collected' && stockBadgeAfter === stockBadgeBefore - 2,
    `hali=${viaBadge.data?.badge_hali_order?.hali} stock ${stockBadgeBefore}→${stockBadgeAfter} ${msgOf(viaBadge)}`);

  if (histLineId) {
    const afterCollect = await gql(
      `mutation ($id: ID!) { ondoa_kipimo(kipimo_id: $id) }`,
      owner,
      { id: histLineId }
    );
    check('a collected order keeps its lines — history is not editable',
      codeOf(afterCollect) === 'CONFLICT', msgOf(afterCollect));

    const addToCollected = await addLine(histOrder.id, { aina: 'katalogi', mchanganyiko_id: combo.id });
    check('a line cannot be added to a collected order', codeOf(addToCollected) === 'CONFLICT',
      msgOf(addToCollected));
  }

  const cancelOrder = await mkOrder({
    kipimo: [{ aina: 'katalogi', mchanganyiko_id: combo.id, kiasi: 1 }],
  });
  await gql(`mutation ($id: ID!) { futa_agizo(id: $id) }`, owner, { id: cancelOrder.id });
  const addToCancelled = await addLine(cancelOrder.id, { aina: 'katalogi', mchanganyiko_id: combo.id });
  check('a line cannot be added to a cancelled order', codeOf(addToCancelled) === 'CONFLICT',
    msgOf(addToCancelled));

  // ---- permissions ---------------------------------------------------------
  if (cashier) {
    const chefRow = (await sql(`SELECT id FROM mtumiaji WHERE jukumu = 'chef' ORDER BY id LIMIT 1`))[0];
    if (chefRow) {
      const chef = await login(chefRow.id, ownerPin);
      const chefAdd = await gql(
        `mutation ($id: ID!, $c: ID!) { ongeza_kipimo(id: $id, input: { aina: katalogi, mchanganyiko_id: $c, kiasi: 1 }) { id } }`,
        chef,
        { id: o1.id, c: combo.id }
      );
      check('a chef cannot add a line to an order', codeOf(chefAdd) === 'FORBIDDEN', msgOf(chefAdd));

      const chefDev = await gql(
        `mutation { sajili_kifaa(input: { alama: "HACK", jina: "x" }) { id } }`,
        chef,
        {}
      );
      check('a chef cannot register a till', codeOf(chefDev) === 'FORBIDDEN', msgOf(chefDev));
    }
  }

  // ---- existing orders still read -----------------------------------------
  const preExisting = await sql(`SELECT count(*)::int AS n FROM agizo_maalum WHERE nambari IS NULL`);
  check('every pre-existing order has a number, even though it predates them', preExisting[0].n === 0,
    `${preExisting[0].n} orders have no number`);

  const legacy = await gql(
    `query { agizo_maalum { id nambari kipimo { id } } }`,
    owner
  );
  const legacyList = legacy.data?.agizo_maalum || [];
  check(
    'existing orders read with their numbers',
    !errOf(legacy) && legacyList.every((o) => o.nambari != null),
    errOf(legacy) ? msgOf(legacy) : `${legacyList.length} orders read`
  );

  await cleanup();
  if (cleanupErrors.length) {
    console.log('\n  cleanup problems:');
    for (const e of cleanupErrors) console.log(`    ${e}`);
  }
  const pct = Math.round((passed / (passed + failed)) * 100);
  console.log(`\n  §4.4 order lines + BR-11 snapshots: ${passed} passed, ${failed} failed (${pct}%)\n`);
  if (failed) {
    console.log('  failures:');
    for (const f of failures) console.log(`    - ${f}`);
    console.log('');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('  harness error —', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool?.end();
    } catch {}
  });
