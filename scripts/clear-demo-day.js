/**
 * Undo scripts/seed-demo-day.js.
 *
 * Deletes only the rows the seed recorded in its manifest, walking the foreign
 * keys in the right order. Anything the shop had before the seed ran is left
 * alone, which is the entire reason the seed keeps a manifest instead of
 * deleting "today's" rows by date.
 *
 * Run: npm run demo:clear
 */

const { pool, sql, readManifest, clearManifest } = require('./demo-day-lib');

/** Delete by id list and report how many went. */
async function drop(table, ids, label) {
  if (!ids || !ids.length) {
    console.log(`  0 ${label}`);
    return 0;
  }
  const [row] = await sql(
    `WITH d AS (DELETE FROM ${table} WHERE id = ANY($1::int[]) RETURNING 1)
     SELECT count(*)::int AS n FROM d`,
    [ids]
  );
  console.log(`  ${row.n} ${label}`);
  return row.n;
}

async function main() {
  const manifest = readManifest();
  if (!manifest) {
    console.error('\n  No demo-day manifest, so there is nothing from the seed to undo.\n');
    process.exit(1);
  }

  console.log(`\nRemoving the demo day seeded at ${manifest.seededAt}\n`);
  const c = manifest.created;
  const agizo = c.agizo || [];

  // --- children of orders -------------------------------------------------
  // Receipts and reminders point at orders with no cascade, so they go first.
  if (agizo.length) {
    const [t] = await sql(
      'WITH d AS (DELETE FROM tikiti WHERE agizo_id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
      [agizo]
    );
    console.log(`  ${t.n} receipts`);
    const [r] = await sql(
      'WITH d AS (DELETE FROM ukumbusho WHERE agizo_id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
      [agizo]
    );
    console.log(`  ${r.n} reminders`);
  }

    await drop('kumbukumbu_matumizi', c.kumbukumbu, 'usage logs');
    await drop('marekebisho_hisa', c.marekebisho, 'stock adjustments');

    // Low-stock reminders point at an ingredient rather than at an order, so the
    // order sweep above cannot see them, and ukumbusho.malighafi_id has no
    // cascade. Left in place they make the ingredient delete below fail on a
    // foreign key, which is how this script used to stop half-finished with the
    // day already torn apart. They are the forecast engine's output, not the
    // seed's, so the manifest never lists them and they have to be swept by
    // ingredient instead.
    if ((c.malighafi || []).length) {
      const [r] = await sql(
        'WITH d AS (DELETE FROM ukumbusho WHERE malighafi_id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
        [c.malighafi]
      );
      if (r.n) console.log(`  ${r.n} stock reminders`);
    }

  // --- counter sales and their lines -------------------------------------
  // mauzo_bidhaa cascades from mauzo, so deleting the sales is enough.
  const salesIds = c.mauzo || [];
  if (salesIds.length) {
    const [n] = await sql(
      'WITH d AS (DELETE FROM mauzo WHERE id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
      [salesIds]
    );
    console.log(`  ${n.n} counter sales`);
  }

  // --- orders and the payments against them -------------------------------
  // mauzo.agizo_id is ON DELETE SET NULL, so without this the order payments
  // would survive as orphans pointing at nothing.
  if (agizo.length) {
    const [n] = await sql(
      'WITH d AS (DELETE FROM mauzo WHERE agizo_id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
      [agizo]
    );
    console.log(`  ${n.n} order payments`);
  }
  await drop('agizo_maalum', agizo, 'orders');

  // --- the rest -----------------------------------------------------------
  await drop('ombi', c.ombi, 'requests');
  // Recipe lines cascade from mapishi; this deletes them explicitly so the
  // count is reported even if the cascade is ever dropped.
  if ((c.mapishi || []).length) {
    const [n] = await sql(
      'WITH d AS (DELETE FROM mapishi_kipengele WHERE mapishi_id = ANY($1::int[]) RETURNING 1) SELECT count(*)::int AS n FROM d',
      [c.mapishi]
    );
    console.log(`  ${n.n} recipe lines`);
  }
  await drop('mapishi', c.mapishi, 'recipes');
  await drop('bidhaa', c.bidhaa, 'products');
  await drop('kategoria', c.kategoria, 'categories');
  await drop('mteja', c.mteja, 'customers');
    // Only ingredients the seed actually created. Sukari and Unga predate it.
    await drop('malighafi', c.malighafi, 'ingredients');

    // Put the pre-existing ingredients back to the levels they held before the
    // seed opened a delivery against them. Ids in the manifest are not enough for
    // this: the day's usage and restock rows are gone by now, so a balance that
    // included both would settle higher than it started, and the next seed would
    // inherit the drift.
    const levels = (manifest.baselineLevels || {}).malighafi || [];
    if (levels.length) {
      const restored = await sql(
        `UPDATE malighafi AS m
            SET kiasi_kilichopo = b.kiasi_kilichopo::numeric,
                kiwango_cha_chini = b.kiwango_cha_chini::numeric
           FROM (SELECT * FROM jsonb_to_recordset($1::jsonb)
                  AS (id int, kiasi_kilichopo text, kiwango_cha_chini text)) AS b
          WHERE m.id = b.id
          RETURNING m.id`,
        [JSON.stringify(levels)]
      );
      console.log(`  ${restored.length} ingredient levels restored to their pre-seed values`);
    }

    console.log('\n  Left in place: the receipt number sequence, which has advanced for the day,');
    console.log('  and any stock the shop has moved since the seed ran.');
    console.log('  Pre-existing ingredient levels are put back as they were.\n');

  clearManifest();
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  Clear failed: ${e.message}`);
    await pool.end();
    process.exit(1);
  });
