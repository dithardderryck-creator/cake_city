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

module.exports = { runMigrations, listMigrationFiles };
