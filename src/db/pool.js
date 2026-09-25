const { Pool } = require('pg');

const url = process.env.DATABASE_URL;

const config = { connectionString: url };

// Run every session in Tanzania time so CURRENT_DATE — used by the ticket
// engine, the dashboard's "today", and the 7-day sales axis — resolves to the
// shop's business day, not the host's. Overridable for testing.
const tz = process.env.DB_TIMEZONE || 'Africa/Dar_es_Salaam';
config.options = `-c timezone=${tz}`;

// Managed Postgres providers (Neon, Vercel Postgres, Supabase, RDS, ...)
// require TLS. Local Postgres does not. Detect by host so one codebase
// works both on the dev laptop and in production.
if (url) {
  const host = new URL(url).hostname;
  const isLocal = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    // Certificate verification is ON by default. Opting out requires an
    // explicit DB_INSECURE_TLS=true, never happens silently, and warns loudly.
    if (process.env.DB_INSECURE_TLS === 'true') {
      console.warn(
        '[db] WARNING: DB_INSECURE_TLS=true — TLS certificate verification is DISABLED. ' +
          'Traffic to this database can be intercepted. Use only for a provider ' +
          'whose CA certificate you cannot install.'
      );
      config.ssl = { rejectUnauthorized: false };
    } else {
      config.ssl = { rejectUnauthorized: true };
    }
  }
}

const pool = new Pool(config);

module.exports = pool;