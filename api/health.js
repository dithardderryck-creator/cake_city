/**
 * Health check as its own serverless function.
 *
 * Separate from the GraphQL function on purpose: a platform health probe should
 * not wake the whole schema, resolvers and connection pool just to find out
 * whether Postgres is answering. This one opens a single connection, checks it,
 * and reports.
 *
 * It checks the database rather than returning a flat "ok", because a server
 * with no reachable database is not healthy and a load balancer that thinks it
 * is will keep sending real shop traffic into queries that all fail.
 */

const pool = require('../src/db/pool');

module.exports = async function handler(req, res) {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'ok', ms: Date.now() - started });
  } catch (err) {
    console.error('[health] database unreachable:', err.message);
    res.status(503).json({
      status: 'degraded',
      database: 'unreachable',
      detail: err.message,
    });
  }
};
