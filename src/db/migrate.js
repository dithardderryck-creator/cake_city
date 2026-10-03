// Migration runner — applies numbered SQL steps in migrations/ exactly once.
//
// The shop may already have a live database, so schema changes go here as new
// numbered steps rather than edits to schema.sql. schema.sql stays the
// "fresh install" definition; this brings existing installs forward.
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function runMigrations() {
  await ensureDatabaseTimezone();
  await ensureMigrationsTable();
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  const pending = listMigrationFiles().filter((f) => !applied.has(f));
  if (pending.length === 0) return [];

  const client = await pool.connect();
  const done = [];
  try {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        done.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        // A failing VALIDATE usually means legacy rows already break the new
        // rule. Say so plainly instead of leaving a cryptic constraint error.
        throw new Error(
          `Migration ${file} failed: ${err.message}\n` +
            'Kama makosa yako yako ya awali, tafuta rekodi zilizozikiwa CHECK constraint hii ' +
            '(mfano: SELECT * FROM mauzo_bidhaa WHERE kiasi <= 0) kisha endesha tena.'
        );
      }
    }
  } finally {
    client.release();
  }
  return done;
}

/**
 * Make the shop's timezone the database's own default.
 *
 * src/db/pool.js asks for Africa/Dar_es_Salaam through the connection startup
 * packet (`options=-c timezone=...`), which is session state supplied by the
 * client. That works on a laptop talking straight to Postgres, and it stops
 * being reliable the moment a connection pooler sits in between: Neon, PgBouncer
 * and most managed providers hand out whichever backend connection is free, so a
 * per-client startup parameter is not reliably honoured.
 *
 * It fails quietly, which is the unacceptable part. Nothing errors — the session
 * just runs in UTC, and CURRENT_DATE then resolves to the wrong business day. The
 * dashboard's "today", the seven-day sales axis and the ticket engine would all
 * quietly report yesterday's takings, and near midnight the shop would appear to
 * have sold nothing.
 *
 * So the default is also set on the database itself, where it applies to every
 * session no matter who connects or through what.
 *
 * This cannot live in a migration file: Postgres refuses ALTER DATABASE inside a
 * transaction block, and migrations run in one by design. So it is issued here in
 * autocommit, once, and is safe to run repeatedly.
 */
async function ensureDatabaseTimezone() {
  const tz = process.env.DB_TIMEZONE || 'Africa/Dar_es_Salaam';
  try {
    // Ask the server what it is called rather than parsing DATABASE_URL: the URL
    // may carry a different database, or be a pooler URL whose path is not the
    // database name at all.
    const {
      rows: [row],
    } = await pool.query('SELECT current_database() AS name');
    if (!row || !row.name) return null;
    await pool.query(
      `ALTER DATABASE ${quoteIdent(row.name)} SET timezone TO ${quoteLiteral(tz)}`
    );
    return tz;
  } catch (err) {
    // Not fatal. The startup-packet setting in pool.js still applies for direct
    // connections, so carry on but say so rather than failing the whole deploy.
    console.warn(
      `[db] Could not set the database timezone to "${tz}": ${err.message}\n` +
        '     Falling back to the per-connection setting. If "today" looks wrong on\n' +
        '     the dashboard, this is why.'
    );
    return null;
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

module.exports = { runMigrations, listMigrationFiles, ensureDatabaseTimezone };
