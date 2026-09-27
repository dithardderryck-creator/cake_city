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

  console.log('\n  Left in place: reorder levels the seed set on pre-existing ingredients,');
  console.log('  and the receipt number sequence, which has advanced for the day.');
  console.log('  Stock levels now reflect only the ledger history that remains.\n');

  clearManifest();
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  Clear failed: ${e.message}`);
    await pool.end();
    process.exit(1);
  });
