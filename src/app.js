require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { GraphQLError } = require('graphql');
const { verifyToken } = require('./auth/jwt');
const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');
const pool = require('./db/pool');
const { generateUkumbusho } = require('./reminders/engine');

/**
 * The Cake City API as a plain Express app, with nothing listening.
 *
 * The same app is used two ways, which is the whole reason it lives here rather
 * than inside server.js:
 *
 *   - src/server.js calls listen() on it, for a machine that stays on (a shop
 *     PC, a VPS, a container). This is the "always active" shape: one warm
 *     process, always up.
 *   - api/index.js hands it to Vercel's serverless runtime, for a deployment
 *     that needs no machine to keep alive. This is the "client can connect from
 *     anywhere" shape.
 *
 * Both run the identical GraphQL schema, resolvers and auth, so there is no
 * second implementation to keep in step. What differs is only who owns the
 * process lifetime.
 */

/**
 * Origins allowed to call this API.
 *
 * A browser on the shop LAN talks to the backend over http://<shop-ip>:4000,
 * and any deployed frontend needs its own origin. Anything not listed is
 * rejected, so a random website cannot drive the POS with a logged-in cashier's
 * token.
 *
 * This is also the "many clients, one server" switchboard. Each frontend that
 * should be able to talk to this backend gets its origin added to CORS_ORIGINS;
 * a frontend that should not is simply absent. A shop can run the till UI, a
 * customer-facing order page and a stock phone all against one API by listing
 * three origins, and revoke one later by removing it.
 *
 * Set CORS_ORIGINS=* to restore the old open behaviour if you front the API
 * with your own proxy.
 */
function allowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (raw === '*') return '*';
  const list = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Local shop access: the API's own host, plus common dev ports.
  const local = ['http://localhost:4000', 'http://127.0.0.1:4000', 'http://localhost:5173'];
  return [...new Set([...list, ...local])];
}

/**
 * Fail fast on missing configuration.
 *
 * Without this the process boots happily and only fails later, deep inside
 * jsonwebtoken or on the first query, producing a confusing runtime error
 * instead of a clear message at startup.
 */
function assertRequiredEnv() {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Mazingira yamekoseka: ${missing.join(', ')}. ` +
        'Weka kwenye .env kisha uanzishe programu tena. ' +
        `(Missing required env: ${missing.join(', ')})`
    );
  }
}

/**
 * Whether this process can rely on an in-process timer.
 *
 * A long-lived server can: it stays up, so setInterval fires. A serverless
 * instance cannot — it is created for one request and then frozen or killed, so
 * a timer either never fires or fires once and is lost. On that path the
 * reminders have to be driven from outside (a cron hitting an endpoint, or the
 * tengeneza_ukumbusho mutation).
 */
function timerAvailable() {
  return process.env.DISABLE_REMINDER_TIMER !== 'true';
}

async function createApp() {
  assertRequiredEnv();

  const app = express();

  // Identify the real caller when the app sits behind a proxy.
  //
  // Deployed, every request reaches this process from the platform's edge, so
  // without this req.ip is one shared proxy address for all of them. The login
  // limiter keys on that address, and one customer fumbling a PIN five times
  // would lock out the entire shop for fifteen minutes — the throttle would
  // become the outage.
  //
  // TRUST_PROXY_HOPS counts proxies between the caller and this process, and
  // Express then reads the nearest address it is willing to believe. Set it to
  // the number of proxies actually in front of the app.
  //
  // Setting it too high is not fatal: the caller-supplied X-Forwarded-For then
  // influences which per-IP bucket is used, but the per-account lockout cannot
  // be dodged that way, because it is keyed on the staff id and stored in the
  // database. A too-low value is the worse mistake, since it collapses every
  // caller into one shared bucket.
  const hops = Number(process.env.TRUST_PROXY_HOPS || 1);
  app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    // J5: deliberate errors are already Kiswahili and keep their message and
    // code. Anything else (constraint violations, driver errors, bugs) is
    // replaced with a generic Kiswahili message so internal detail and
    // English stack traces never reach the shop, while the real error is
    // logged server-side for whoever operates the system.
    // Stack traces are only ever attached in development.
    formatError: (formattedError, error) => {
      const includeStack = process.env.NODE_ENV === 'development';
      const code = formattedError.extensions?.code;
      const isDeliberate =
        error instanceof GraphQLError &&
        typeof code === 'string' &&
        code !== 'INTERNAL_SERVER_ERROR';

      if (isDeliberate) {
        if (includeStack) return formattedError;
        // stacktrace lives under extensions, not at the top level.
        const { stacktrace, ...ext } = formattedError.extensions || {};
        return { ...formattedError, extensions: ext };
      }

      console.error('[graphql] hitilafu isiyotarajiwa:', error);
      return {
        message: 'Hitilafu isiyotarajiwa imetokea. Jaribu tena.',
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      };
    },
  });

  await server.start();

  app.use(cors({ origin: allowedOrigins() }));
  app.use(express.json());

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }) => {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        let user = null;
        if (token) {
          const decoded = verifyToken(token);
          if (decoded) {
            // A fired staff member's JWT stays valid until it expires, so
            // confirm the account is still active on every authenticated
            // request. One extra indexed lookup is a fair price at this scale.
            const { rows } = await pool.query('SELECT active FROM mtumiaji WHERE id = $1', [
              decoded.sub,
            ]);
            if (rows[0] && rows[0].active) {
              user = decoded;
            }
          }
        }
        return { user, req };
      },
    })
  );

  // J2: a health check that never touches the database reports "ok" while
  // Postgres is unreachable, so a supervisor would happily keep a broken
  // system alive. Verify connectivity and fail loudly instead.
  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'ok' });
    } catch (err) {
      console.error('[health] database unreachable:', err.message);
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  // A long-lived server seeds the reminders once at boot and the engine keeps
  // them fresh on its timer. A serverless instance is not allowed to start that
  // timer, and doing the initial generation here too would mean one extra write
  // burst per cold start with nothing to keep it going afterwards.
  if (timerAvailable()) {
    generateUkumbusho().catch((e) => console.error('[ukumbusho] init error:', e.message));
  }

  return app;
}

module.exports = { createApp, allowedOrigins, assertRequiredEnv, timerAvailable };
