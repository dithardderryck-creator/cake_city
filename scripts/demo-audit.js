#!/usr/bin/env node
/**
 * demo:audit — prove the demo day still matches its manifest, and that nothing
 * has been added behind its back.
 *
 * Why this exists: the test suites create real rows through the API on purpose,
 * then delete them. That worked until something in a suite changed shape and a
 * row survived. Because the seeder recorded only what it *created* and never the
 * rows that already existed, there was no way to tell "a demo row" from "a
 * leftover from a test run" — the extra rows simply looked like more demo data,
 * and the day's takings quietly stopped matching the manifest.
 *
 * The seeder now writes a `baseline`: the ids present in each table before the
 * day was seeded. That makes the expected live set baseline ∪ created, so any row
 * outside it is either a real leak or a genuine addition the shop made after
 * closing, and both are worth being told about. A timestamp cannot be used for
 * this: the seeder backdates created_at so the day looks like it happened during
 * shop hours, which places every demo row *before* the moment the script ran.
 *
 * Exits non-zero on drift, so it can sit in verify:all as a gate.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const MANIFEST = path.join(__dirname, '..', 'backups', 'demo-day-manifest.json');

// Tables the seeder is allowed to add rows to, with the manifest key holding
// their ids. Child tables without an id of their own in the manifest (recipe
// lines, sale lines, recipe usage) are checked through their parents instead.
const TABLES = [
  { table: 'kategoria', key: 'kategoria' },
  { table: 'bidhaa', key: 'bidhaa' },
  { table: 'malighafi', key: 'malighafi' },
  { table: 'mapishi', key: 'mapishi' },
  { table: 'mteja', key: 'mteja' },
  { table: 'agizo_maalum', key: 'agizo' },
  { table: 'mauzo', key: 'mauzo' },
  { table: 'ombi', key: 'ombi' },
];

// Tables the seeder fills indirectly, so they are reported but not held to a
// fixed count. `marekebisho_hisa` and `kumbukumbu_matumizi` are in this group:
// the seeder records that it made some, but the shop also writes to both on its
// own (recipe bill-of-materials, the two-phase stock confirmation, the low-stock
// reminders), so an extra row is a question, not automatically a fault. The key
// is the manifest's name for the table, which is not always the table name.
const DERIVED = [
  { table: 'marekebisho_hisa', key: 'marekebisho' },
  { table: 'kumbukumbu_matumizi', key: 'kumbukumbu' },
  { table: 'ukumbusho', key: 'ukumbusho' },
  { table: 'tikiti', key: 'tikiti' },
];

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';


function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

async function audit(pool, manifest) {
  const rows = [];
  let drift = 0;
  const baseline = manifest.baseline || {};

  for (const { table, key } of TABLES) {
    const createdIds = (manifest.created[key] || []).map(String);
    const baseIds = (baseline[key] || []).map(String);
    const expected = new Set([...baseIds, ...createdIds]);

    const { rows: found } = await pool.query(`SELECT id FROM ${table} ORDER BY id`);
    const live = found.map((r) => String(r.id));

    // A row the manifest promised but that is no longer there, and a row nobody
    // can account for. The second is the one that matters: it is either a test
    // that failed to clean up, or trading that happened after the day was seeded.
    const missing = [...expected].filter((id) => !live.includes(id));
    const extra = live.filter((id) => !expected.has(id));
    if (extra.length || missing.length) drift += extra.length + missing.length;

    rows.push({
      table,
      ok: !extra.length && !missing.length,
      baseline: baseIds.length,
      demo: createdIds.filter((id) => live.includes(id)).length,
      live: live.length,
      extra,
      missing,
    });
  }

  // Tables the seeder records ids for but that the system also writes to on its
  // own, so the live total is reported next to the recorded one rather than being
  // held to a fixed count.
  const derived = [];
  for (const { table, key } of DERIVED) {
    const known = (manifest.created[key] || []).length;
    const { rows: found } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    derived.push({ table, known, since: found[0].n });
  }

  return { drift, rows, derived };
}

/**
 * Remove rows the manifest does not account for.
 *
 * Deliberately conservative. A row is only a candidate if neither the baseline
 * nor the created list mentions it, so real shop data cannot be deleted by a
 * cleanup aimed at test residue. Child rows are never guessed at: they are
 * removed through the parent that is going away, because a child table such as
 * mauzo_bidhaa or tikiti holds rows for demo sales as well as for leftovers, and
 * only the parent says which is which. Every id deleted is printed.
 */
async function prune(pool, manifest, only) {
  const removed = [];
  const refused = [];
  const known = (key) =>
    new Set([
      ...((manifest.baseline || {})[key] || []).map(String),
      ...(manifest.created[key] || []).map(String),
    ]);

  const inList = only && only.length ? only : null;
  const wants = (t) => !inList || inList.includes(t);

  /** ids in `table` that neither the baseline nor the manifest accounts for */
  const unaccounted = async (table, key) => {
    const keep = known(key);
    const { rows } = await pool.query(`SELECT id FROM ${table} ORDER BY id`);
    return rows.filter((r) => !keep.has(String(r.id))).map((r) => r.id);
  };

  const drop = async (table, ids, label = 'id') => {
    for (const id of ids) {
      try {
        const res = await pool.query(`DELETE FROM ${table} WHERE ${label} = $1 RETURNING id`, [id]);
        // Zero rows is not a failure: the same parent can be reached by two paths
        // (a sale and the order that paid for it), and by the time the second path
        // runs the row is already gone.
        if (res.rowCount) removed.push(`${table}#${id}`);
      } catch (e) {
        refused.push(`${table}#${id} (${e.code || e.message})`);
      }
    }
  };

  // Parents first, collected but not deleted yet: the children have to be found
  // via these ids before the rows they point at disappear.
  const doomed = {
    agizo_maalum: wants('agizo_maalum') ? await unaccounted('agizo_maalum', 'agizo') : [],
    malighafi: wants('malighafi') ? await unaccounted('malighafi', 'malighafi') : [],
    mteja: wants('mteja') ? await unaccounted('mteja', 'mteja') : [],
    mapishi: wants('mapishi') ? await unaccounted('mapishi', 'mapishi') : [],
    bidhaa: wants('bidhaa') ? await unaccounted('bidhaa', 'bidhaa') : [],
    kategoria: wants('kategoria') ? await unaccounted('kategoria', 'kategoria') : [],
  };
  const doomedSales = wants('mauzo') ? await unaccounted('mauzo', 'mauzo') : [];
  const doomedStaff = wants('mtumiaji') ? await unaccounted('mtumiaji', 'mtumiaji') : [];
  const doomedOmbi = wants('ombi') ? await unaccounted('ombi', 'ombi') : [];

  // Children, reached through the parents that are going.
  if (wants('mauzo')) {
    for (const id of doomedSales) await drop('mauzo_bidhaa', [id], 'mauzo_id');
    // Tickets are only ever removed through a parent that is going. They are
    // deliberately not swept by id: the manifest records no ticket ids, so an
    // id-based pass would consider all twelve demo tickets to be residue.
    for (const id of doomedSales) await drop('tikiti', [id], 'mauzo_id');
  }
  if (wants('tikiti')) {
    // A ticket can also be the only thing still holding an order open. The
    // foreign key on tikiti.agizo_id has no cascade, so the order delete fails
    // until its tickets go, and mauzo.agizo_id does cascade, so a ticket whose
    // sale has already gone leaves the order as the last reference to it.
    for (const id of doomed.agizo_maalum) await drop('tikiti', [id], 'agizo_id');
  }
  if (wants('kumbukumbu_matumizi')) {
    for (const id of doomed.agizo_maalum) await drop('kumbukumbu_matumizi', [id], 'agizo_id');
    for (const id of doomed.malighafi) await drop('kumbukumbu_matumizi', [id], 'malighafi_id');
    // Usage rows raised by recipe bill-of-materials hang off an ingredient and a
    // recipe, not an order, so they survive the order delete above and then block
    // it on the foreign key. They are caught here by id instead: the manifest owns
    // the usage rows it recorded, and anything else is residue.
    const knownUsage = known('kumbukumbu');
    const { rows: strays } = await pool.query('SELECT id FROM kumbukumbu_matumizi ORDER BY id');
    for (const r of strays) {
      if (!knownUsage.has(String(r.id))) await drop('kumbukumbu_matumizi', [r.id]);
    }
  }
  if (wants('marekebisho_hisa')) {
    for (const id of doomed.malighafi) await drop('marekebisho_hisa', [id], 'malighafi_id');
  }
  if (wants('ukumbusho')) {
    for (const id of doomed.agizo_maalum) await drop('ukumbusho', [id], 'agizo_id');
    for (const id of doomed.malighafi) await drop('ukumbusho', [id], 'malighafi_id');
    // Deliberately no sweep by id. A low-stock reminder is the forecast engine's
    // own output: it re-raises them on a schedule and reaches a new conclusion
    // as the day is verified, so one appearing here means the engine ran, not that
    // something leaked. Pruning them would just have the engine put them back.
  }
  if (wants('mapishi_kipengele')) {
    for (const id of doomed.mapishi) await drop('mapishi_kipengele', [id], 'mapishi_id');
  }
  if (wants('mauzo')) {
    for (const id of doomedSales) await drop('mauzo', [id]);
  }
  if (wants('ombi')) {
    for (const id of doomedOmbi) await drop('ombi', [id]);
  }
  for (const id of doomed.agizo_maalum) await drop('agizo_maalum', [id]);
  for (const id of doomed.mapishi) await drop('mapishi', [id]);
  for (const id of doomed.mteja) await drop('mteja', [id]);
  for (const id of doomed.bidhaa) await drop('bidhaa', [id]);
  for (const id of doomed.malighafi) await drop('malighafi', [id]);
  for (const id of doomed.kategoria) await drop('kategoria', [id]);
  for (const id of doomedStaff) await drop('mtumiaji', [id]);

  return { removed, refused };
}

async function main() {
  const args = process.argv.slice(2);
  const pruneFlag = args.includes('--prune');
  const only = args.filter((a) => a.startsWith('--only=')).flatMap((a) => a.slice(7).split(','));

  const manifest = loadManifest();
  if (!manifest) {
    console.log(`\n  No demo manifest at ${MANIFEST}. Nothing seeded, nothing to audit.\n`);
    return 0;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (pruneFlag) {
      const { removed, refused } = await prune(pool, manifest, only.length ? only : null);
      if (removed.length) {
        console.log(`\n  ${YELLOW}Pruned ${removed.length} row(s) the manifest does not account for:${OFF}`);
        removed.forEach((r) => console.log(`    ${DIM}${r}${OFF}`));
      } else {
        console.log(`\n  ${GREEN}Nothing to prune.${OFF}`);
      }
      if (refused.length) {
        console.log(`  ${YELLOW}${refused.length} row(s) could not be deleted:${OFF}`);
        refused.forEach((r) => console.log(`    ${DIM}${r}${OFF}`));
      }
      console.log('');
    }

    const { drift, rows, derived } = await audit(pool, manifest);

    console.log(
      `  ${DIM}Demo day ${manifest.shopDate}, seeded ${manifest.seededAt}${OFF}\n`
    );
    console.log(
      `  ${'table'.padEnd(14)}${'baseline'.padEnd(11)}${'seeded'.padEnd(9)}${'live'.padEnd(7)}status`
    );
    console.log(`  ${'-'.repeat(62)}`);
    for (const r of rows) {
      const status = r.ok
        ? `${GREEN}ok${OFF}`
        : `${RED}${r.extra.length ? `${r.extra.length} unaccounted` : ''}${r.extra.length && r.missing.length ? ', ' : ''}${r.missing.length ? `${r.missing.length} missing` : ''}${OFF}`;
      console.log(
        `  ${r.table.padEnd(14)}${String(r.baseline).padEnd(11)}${String(r.demo).padEnd(9)}${String(r.live).padEnd(7)}${status}`
      );
      r.extra.forEach((id) =>
        console.log(`      ${RED}+ id ${id} exists but is in neither the baseline nor the manifest${OFF}`)
      );
      r.missing.forEach((id) =>
        console.log(`      ${RED}- id ${id} is recorded but is no longer in the database${OFF}`)
      );
    }

    console.log(
      `\n  ${DIM}the shop also writes these itself, so a live total above the recorded one is not drift:${OFF}`
    );
    for (const d of derived) {
      const note = d.since > d.known ? `  ${DIM}(+${d.since - d.known})${OFF}` : '';
      console.log(`    ${d.table.padEnd(22)}${d.known} recorded${note}`);
    }
    console.log('');

    if (drift) {
      console.log(`  ${RED}${drift} row(s) do not match the manifest.${OFF}`);
      console.log(
        `  ${DIM}Run "npm run demo:audit -- --prune" to drop rows neither the shop nor the seed accounts for.${OFF}\n`
      );
      return 1;
    }
    console.log(`  ${GREEN}The demo day matches its manifest.${OFF}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`\n  ${RED}demo:audit failed:${OFF} ${e.message}\n`);
    process.exit(1);
  });
