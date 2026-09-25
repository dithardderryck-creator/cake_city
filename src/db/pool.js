const { Pool } = require('pg');

const url = process.env.DATABASE_URL;

const config = { connectionString: url };

// Managed Postgres providers (Neon, Vercel Postgres, Supabase, RDS, ...)
// require TLS. Local Postgres does not. Detect by host so one codebase
// works both on the dev laptop and in production.
if (url) {
  const host = new URL(url).hostname;
  const isLocal = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    config.ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool(config);

module.exports = pool;