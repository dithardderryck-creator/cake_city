/**
 * Populate the shop with one realistic trading day so the whole system can be
 * exercised end to end before it is trusted with real orders.
 *
 * Everything is written through the GraphQL API as the real staff, so stock
 * triggers, permission checks, the sales ledger, receipt numbering and the audit
 * log all run exactly as they would during a real day. The only direct SQL is
 * reading and restoring the staff PIN hashes (so the cashier, chef and inventory
 * clerk can each do their own part) and backdating timestamps so the day has a
 * realistic shape rather than everything landing at once.
 *
 * Run:  npm run demo:seed
 * Undo: npm run demo:clear
 */

const {
  pool, sql, gql, withStaffPins, assertPinsRestored, readManifest, writeManifest, shopToday,
} = require('./demo-day-lib');
const D = require('./demo-day-data');

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, '0')}. ${m}`);

const created = {
  kategoria: [], bidhaa: [], malighafi: [], mapishi: [], mteja: [],
  agizo: [], mauzo: [], ombi: [], marekebisho: [], kumbukumbu: [],
};

async function main() {
  const today = await shopToday();
  console.log(`\nSeeding a trading day for ${today.d} (shop time ${today.t}, Africa/Dar_es_Salaam)\n`);

  if (readManifest()) {
    console.error('  A demo-day manifest already exists, so this day has been seeded.');
    console.error('  Run `npm run demo:clear` first if you want to seed a fresh one.\n');
    process.exit(1);
  }

  // --- staff and their roles -------------------------------------------
  const staff = await sql('SELECT id, jina, jukumu, pin_hash FROM mtumiaji WHERE active ORDER BY id');
  const byRole = Object.fromEntries(staff.map((s) => [s.jukumu, s]));
  for (const role of ['owner', 'cashier', 'chef', 'inventory']) {
    if (!byRole[role]) {
      console.error(`  No active ${role} account found. Create one before seeding.\n`);
      process.exit(1);
    }
  }
  const staffIds = staff.map((s) => s.id);
  console.log(`  Staff on shift: ${staff.map((s) => `${s.jina} (${s.jukumu})`).join(', ')}\n`);

  // Customers can be created by the app rather than by this script — a walk-in
  // typed at the counter is inserted inside unda_agizo, and a repeat customer is
  // matched there too. Snapshotting the existing ids lets the manifest account
  // for every customer that appears during the run, so clearing the demo day
  // does not leave orphans behind.
  const preExistingMteja = new Set(
    (await sql('SELECT id FROM mteja')).map((r) => Number(r.id))
  );
  const preExistingMalighafi = new Set(
    (await sql('SELECT id FROM malighafi')).map((r) => Number(r.id))
  );
  const sweepAppCreated = async () => {
    const nowMteja = await sql('SELECT id FROM mteja ORDER BY id');
    for (const r of nowMteja) {
      if (!preExistingMteja.has(Number(r.id)) && !created.mteja.includes(r.id)) {
        created.mteja.push(r.id);
      }
    }
    const nowIng = await sql('SELECT id FROM malighafi ORDER BY id');
    for (const r of nowIng) {
      if (!preExistingMalighafi.has(Number(r.id)) && !created.malighafi.includes(r.id)) {
        created.malighafi.push(r.id);
      }
    }
  };

  const savedHashes = staff.map((s) => ({ id: s.id, pin_hash: s.pin_hash }));
  let outcome = 'complete';

  try {
    await withStaffPins(staffIds, async (who) => {
      const owner = byRole.owner.id;
      const ownerT = who[owner].token;
      const cashierT = who[byRole.cashier.id].token;
      const chefT = who[byRole.chef.id].token;
      const invT = who[byRole.inventory.id].token;

    // --- ingredients ------------------------------------------------------
    // Matched by name, because the shop already stocks its own sugar and flour.
    // Reusing those rows keeps the opening balance the owner set.
    log('ingredients');
    const ingId = {};
    for (const [jina, kiasi, chini, unit] of D.INGREDIENTS) {
      const found = await sql('SELECT id FROM malighafi WHERE jina = $1', [jina]);
      if (found[0]) {
        await gql(
          `mutation($id:ID!,$input:MalighafiInput!){hariri_malighafi(id:$id,input:$input){id}}`,
          ownerT,
          { id: found[0].id, input: { jina, kiasi_kilichopo: kiasi, kiwango_cha_chini: chini, unit } }
        );
        ingId[jina] = found[0].id;
      } else {
        const d = await gql(
          `mutation($input:MalighafiInput!){ongeza_malighafi(input:$input){id}}`,
          ownerT,
          { input: { jina, kiasi_kilichopo: kiasi, kiwango_cha_chini: chini, unit } }
        );
        ingId[jina] = d.ongeza_malighafi.id;
        created.malighafi.push(d.ongeza_malighafi.id);
      }
    }
    console.log(`     ${Object.keys(ingId).length} ingredients in stock`);

    // --- categories and retail products -----------------------------------
    log('categories and counter products');
    const katId = {};
    for (const jina of D.CATEGORIES) {
      const d = await gql(`mutation($j:String!){unda_kategoria(jina:$j){id}}`, ownerT, { j: jina });
      katId[jina] = d.unda_kategoria.id;
      created.kategoria.push(d.unda_kategoria.id);
    }
    const bidhaaId = {};
    for (const [jina, bei, familia, ukubwa, kat] of D.PRODUCTS) {
      const d = await gql(
        `mutation($input:BidhaaInput!){bathi_bidhaa(input:$input){id}}`,
        ownerT,
        { input: { jina, bei, familia, ukubwa, kategoria_id: katId[kat] } }
      );
      bidhaaId[jina] = d.bathi_bidhaa.id;
      created.bidhaa.push(d.bathi_bidhaa.id);
    }
    console.log(`     ${D.CATEGORIES.length} categories, ${D.PRODUCTS.length} products`);

    // --- recipe book -------------------------------------------------------
    log('recipe book, including sliced variants');
    const mapishiId = {};
    for (const r of D.RECIPES) {
      const d = await gql(
        `mutation($input:MapishiInput!){unda_mapishi(input:$input){id}}`,
        ownerT,
        {
          input: {
            ladha: r.ladha, ukubwa: r.ukubwa, dakika_kadirio: r.dakika,
            mapamba_variant: 'own_recipe',
            viambato: r.ing.map(([jina, lo, hi, sehemu]) => ({
              malighafi_id: ingId[jina], kiasi_cha_chini: lo, kiasi_cha_juu: hi, sehemu: sehemu || null,
            })),
          },
        }
      );
      mapishiId[`${r.ladha}|${r.ukubwa}`] = d.unda_mapishi.id;
      created.mapishi.push(d.unda_mapishi.id);
    }
    for (const s of D.SLICES) {
      const parentId = mapishiId[s.parent];
      if (!parentId) throw new Error(`Slice parent missing: ${s.parent}`);
      const d = await gql(
        `mutation($input:MapishiInput!){unda_mapishi(input:$input){id}}`,
        ownerT,
        {
          input: {
            ladha: s.ladha, ukubwa: s.ukubwa, dakika_kadirio: s.dakika,
            mapamba_variant: 'fraction_of', mapishi_ibaba: parentId, sehemu_ya_uzito: s.ratio,
            viambato: [],
          },
        }
      );
      mapishiId[`${s.ladha}|${s.ukubwa}`] = d.unda_mapishi.id;
      created.mapishi.push(d.unda_mapishi.id);
    }
    console.log(`     ${D.RECIPES.length} recipes + ${D.SLICES.length} slices`);

    // --- customers --------------------------------------------------------
    log('customers');
    const mtejaId = {};
    for (const c of D.CUSTOMERS) {
      const d = await gql(
        `mutation($input:MtejaInput!){ongeza_mteja(input:$input){id jina simu mzio}}`,
        cashierT,
        { input: { jina: c.jina, simu: c.simu, mzio: c.mzio || undefined } }
      );
      mtejaId[c.jina] = d.ongeza_mteja.id;
      created.mteja.push(d.ongeza_mteja.id);
    }
    console.log(`     ${D.CUSTOMERS.length} customers, one repeat pair included`);

    // --- the day's orders, taken at the counter ---------------------------
    log('order book');
    const orderIds = [];
    for (const o of D.ORDERS) {
      const isTomorrow = Boolean(o.tomorrow);
      const takeDate = isTomorrow
        ? await sql(`SELECT (CURRENT_DATE + 1)::text AS d`)
        : [{ d: today.d }];
      const mpya = o.who
        ? { jina: o.who, simu: D.CUSTOMERS.find((c) => c.jina === o.who)?.simu, mzio: D.CUSTOMERS.find((c) => c.jina === o.who)?.mzio || undefined }
        : { jina: o.mgeni };
      const d = await gql(
        `mutation($input:AgizoInput!){unda_agizo(input:$input){id}}`,
        cashierT,
        {
          input: {
            mteja_mpya: mpya,
            ladha: o.recipe.split('|')[0],
            ukubwa: o.recipe.split('|')[1],
            mapishi_id: mapishiId[o.recipe] || null,
            umbo: o.umbo || undefined,
            maelekezo_maalum: o.maelezo || undefined,
            tarehe_ya_kuchukua: takeDate[0].d,
            bei_jumla: o.bei,
            malipo_ya_awali: o.deposit,
            njia_ya_malipo: o.pay,
          },
        }
      );
      orderIds.push({ id: d.unda_agizo.id, spec: o });
      created.agizo.push(d.unda_agizo.id);
    }
    console.log(`     ${orderIds.length} orders taken`);

    // --- the kitchen works through them -----------------------------------
    log('kitchen: baking, then collection');
    // The app deliberately splits this: the chef may start and finish a cake,
    // but only the counter can mark it collected. The seed follows the same
    // rule, so a permission error here means the seed is wrong, not the app.
    const actorFor = {
      ordered: cashierT,
      in_progress: chefT,
      ready: chefT,
      collected: cashierT,
      cancelled: ownerT,
    };
    for (const { id, spec } of orderIds) {
      for (const hali of spec.flow) {
        await gql(`mutation($id:ID!,$h:HaliOrder!){badge_hali_order(id:$id,hali:$h){id}}`, actorFor[hali], { id, h: hali });
      }
      if (spec.balance) {
        await gql(`mutation($id:ID!,$k:Float!,$n:NjiaMalipo!){lipa_salio(id:$id,kiasi:$k,njia_ya_malipo:$n){malipo{jumla njia_ya_malipo}}}`, cashierT, {
          id, k: spec.balance, n: spec.pay,
        });
      }
    }
    const collected = orderIds.filter((o) => o.spec.flow.includes('collected')).length;
    console.log(`     ${collected} collected, ${orderIds.filter((o) => o.spec.flow.length === 0).length} still queued`);

    // --- usage estimates, then inventory confirmation ---------------------
    log('usage estimates from the chef');
    const pending = [];
    for (const { id, spec } of orderIds) {
      if (!spec.usage?.used) continue;
      // The chef logs against the recipe's own lines, which is what the tap
      // sheet prefills from. A slice has no lines of its own, so the amounts
      // logged are the parent's scaled by sehemu_ya_uzito — the same numbers
      // the kitchen sheet shows.
      const [rec] = await sql('SELECT * FROM mapishi WHERE id = $1', [mapishiId[spec.recipe]]);
      const isSlice = rec.mapamba_variant === 'fraction_of';
      const ratio = isSlice ? Number(rec.sehemu_ya_uzito) : 1;
      const base = isSlice
        ? await sql('SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1', [rec.mapishi_ibaba])
        : await sql('SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1', [rec.id]);

      const vitu = base
        .map((l) => ({ malighafi_id: l.malighafi_id, kiasi: Number(l.kiasi_cha_chini) * ratio }))
        .map((l) => ({ ...l, kiasi: Number(l.kiasi.toFixed(3)) }))
        .filter((l) => Number.isFinite(l.kiasi) && l.kiasi > 0);

      // Fail here rather than letting a NaN reach GraphQL, where it silently
      // serialises to null and the error names a field instead of the cause.
      if (!vitu.length) {
        throw new Error(`Recipe "${spec.recipe}" produced no usable usage lines`);
      }
      const bad = vitu.filter((l) => !Number.isFinite(l.kiasi));
      if (bad.length) throw new Error(`Non-numeric usage amount for ${spec.recipe}`);

      const d = await gql(
        `mutation($input:MatumiziKundiInput!){log_matumizi_kundi(input:$input){id kiasi hali}}`,
        chefT,
        { input: { agizo_id: id, kumbukumbu: `${spec.recipe.split('|')[0]}`, vitu } }
      );
      created.kumbukumbu.push(...d.log_matumizi_kundi.map((l) => l.id));
      if (!spec.usage.verified) pending.push(d.log_matumizi_kundi);
    }
    console.log(`     ${created.kumbukumbu.length} estimate lines logged`);

    log('inventory confirming real amounts (this is what moves stock)');
    let verified = 0;
    for (const { id, spec } of orderIds) {
      if (!spec.usage?.used || !spec.usage.verified) continue;
      const logs = await sql('SELECT * FROM kumbukumbu_matumizi WHERE agizo_id = $1 ORDER BY id', [id]);
      for (const l of logs) {
        // Real usage drifts from the estimate — that is the whole reason the
        // estimate/confirm split exists.
        const halisi = Number((Number(l.kiasi) * 1.04).toFixed(3));
        await gql(`mutation($id:ID!,$k:Float!){thibitisha_matumizi(id:$id,kiasi_halisi:$k){id}}`, invT, { id: l.id, k: halisi });
        verified += 1;
      }
    }
    console.log(`     ${verified} lines confirmed, ${pending.reduce((n, p) => n + p.length, 0)} left awaiting confirmation`);

    // --- stock movements --------------------------------------------------
    log('restocks and waste');
    for (const a of D.ADJUSTMENTS) {
      const d = await gql(
        `mutation($input:MarekebishoInput!){marekebisho_hisa(input:$input){id}}`,
        invT,
        { input: { malighafi_id: ingId[a.ing], aina: a.aina, kiasi: a.kiasi, sababu: a.sababu } }
      );
      created.marekebisho.push(d.marekebisho_hisa.id);
    }
    console.log(`     ${D.ADJUSTMENTS.length} adjustments`);

    // --- counter sales ----------------------------------------------------
    log('counter sales');
    for (const s of D.COUNTER_SALES) {
      const d = await gql(
        `mutation($b:[MauzoBidhaaInput!]!,$n:NjiaMalipo!){unda_mauzo(bidhaa:$b,njia_ya_malipo:$n){id}}`,
        cashierT,
        { b: s.items.map(([jina, kiasi]) => ({ bidhaa_id: bidhaaId[jina], kiasi })), n: s.pay }
      );
      created.mauzo.push(d.unda_mauzo.id);
    }
    console.log(`     ${D.COUNTER_SALES.length} counter sales`);

    // --- staff requests ---------------------------------------------------
    log('requests between staff');
    for (const r of D.REQUESTS) {
      const d = await gql(
        `mutation($to:ID!,$u:String!){tumia_ombi(kwenda_kwa:$to,ujumbe:$u){id}}`,
        who[byRole[r.from].id].token,
        { to: byRole[r.to].id, u: r.ujumbe }
      );
      created.ombi.push(d.tumia_ombi.id);
      if (r.closed) {
        await gql(
          `mutation($id:ID!,$j:String){fungua_ombi(id:$id,jibu:$j){id}}`,
          who[byRole[r.to].id].token,
          { id: d.tumia_ombi.id, j: r.jibu }
        );
      }
    }
    console.log(`     ${D.REQUESTS.length} requests (${D.REQUESTS.filter((r) => r.closed).length} cleared)`);

    // --- reminders for what's due ----------------------------------------
    log('reminders');
    const g = await gql('mutation{tengeneza_ukumbusho}', ownerT);
    console.log(`     ${g.tengeneza_ukumbusho === true ? 'reminders generated' : 'reminder generation reported false'}`);
    });
  } catch (e) {
    outcome = 'failed';
    throw e;
  } finally {
    // Pick up anything the app created on our behalf (walk-in customers being
    // the obvious case) so the manifest is a complete list of what to remove.
    try {
      await sweepAppCreated();
    } catch (e) {
      console.log(`  Warning: could not sweep app-created rows: ${e.message}`);
    }
    // The manifest is written whether or not the seed finished. A half-seeded
    // day with no manifest is the one outcome that cannot be undone safely, so
    // it is the one case the finally block exists to prevent.
    //
    // Ids are normalised to unique numbers first. GraphQL returns ID as a
    // string while SQL returns an integer, so the same row can otherwise be
    // recorded twice under two different types, and the "already recorded"
    // checks above silently stop matching.
    for (const key of Object.keys(created)) {
      created[key] = [...new Set(created[key].map((v) => Number(v)))].sort((a, b) => a - b);
    }
    writeManifest({
      seededAt: new Date().toISOString(),
      shopDate: today.d,
      outcome,
      created,
    });
    if (outcome !== 'complete') {
      console.log('\n  Seed did not finish, but a manifest was still written.');
      console.log('  Run `npm run demo:clear` to remove the partial day.\n');
    }
  }

  // The staff PINs were restored inside withStaffPins' own finally; prove it.
  await assertPinsRestored(staffIds, savedHashes);
  console.log('  Staff PINs verified unchanged.');

  // --- backdate, so the day has a believable shape -----------------------
  log('backdating the day so reports and receipts read like a real trading day');
  await backdate(created, today.d);

  console.log('\n  Day seeded. Manifest: backups/demo-day-manifest.json');
  console.log('  Undo everything with: npm run demo:clear\n');
}

async function backdate(created, shopDate) {
  // Spread the day from 07:00 to the current time. Receipt numbers stay in
  // order; only the clock moves, so a day's takings do not all read as one
  // giant single transaction at the moment the seed ran.
  const n = created.agizo.length;
  for (let i = 0; i < n; i += 1) {
    const id = created.agizo[i];
    const minute = Math.round(7 * 60 + (i * (11 * 60)) / Math.max(1, n));
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    await sql(`UPDATE agizo_maalum SET created_at = ($2::date + $3::time) WHERE id = $1`, [
      id, shopDate, `${hh}:${mm}:00`,
    ]);
    await sql(
      `UPDATE mauzo SET created_at = ($2::date + $3::time), tarehe = $2 WHERE agizo_id = $1`,
      [id, shopDate, `${hh}:${mm}:00`]
    );
  }

  for (let i = 0; i < created.mauzo.length; i += 1) {
    const minute = Math.round(7 * 60 + 30 + (i * (10 * 60)) / Math.max(1, created.mauzo.length));
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    await sql(`UPDATE mauzo SET created_at = ($2::date + $3::time), tarehe = $2 WHERE id = $1`, [
      created.mauzo[i], shopDate, `${hh}:${mm}:00`,
    ]);
  }

  await sql(`UPDATE marekebisho_hisa SET tarehe = ($1::date + interval '7 hours 30 minutes') WHERE id = ANY($2::int[])`, [
    shopDate, created.marekebisho,
  ]);
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  Seed failed: ${e.message}`);
    if (e.raw) console.error(JSON.stringify(e.raw, null, 2).slice(0, 1200));
    await pool.end();
    process.exit(1);
  });
