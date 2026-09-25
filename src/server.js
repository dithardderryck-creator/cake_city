require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { verifyToken } = require('./auth/jwt');
const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');
const pool = require('./db/pool');
const { generateUkumbusho } = require('./reminders/engine');

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  // Initial reminder generation + periodic refresh.
  generateUkumbusho().catch((e) => console.error('[ukumbusho] init error:', e.message));

  app.use(cors());
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

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const port = process.env.PORT || 4000;
  httpServer.listen(port, () => {
    console.log(`Cake City POS API inatumika kwenye http://localhost:${port}/graphql`);
  });
}

startServer().catch((err) => {
  console.error('Server imeshindwa kuanza:', err);
  process.exit(1);
});