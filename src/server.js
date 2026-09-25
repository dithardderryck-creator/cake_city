require('dotenv').config();
const express = require('express');
const http = require('http');
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
 * Origins allowed to call this API.
 *
 * A browser on the shop LAN talks to the backend over http://<shop-ip>:4000,
 * and the Vercel demo needs its own origin. Anything not listed is rejected,
 * so a random website cannot drive the POS with a logged-in cashier's token.
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
  const demo = ['https://cakecity-smoky.vercel.app'];
  return [...new Set([...list, ...local, ...demo])];
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

async function startServer() {
  assertRequiredEnv();

  const app = express();
  const httpServer = http.createServer(app);

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

  // Initial reminder generation + periodic refresh.
  generateUkumbusho().catch((e) => console.error('[ukumbusho] init error:', e.message));

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
            const { rows } = await pool.query(
              'SELECT active FROM mtumiaji WHERE id = $1',
              [decoded.sub]
            );
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

  const port = process.env.PORT || 4000;
  httpServer.listen(port, () => {
    console.log(`Cake City POS API inatumika kwenye http://localhost:${port}/graphql`);
  });
}

startServer().catch((err) => {
  console.error('Server imeshindwa kuanza:', err);
  process.exit(1);
});