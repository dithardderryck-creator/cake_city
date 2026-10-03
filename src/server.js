require('dotenv').config();
const http = require('http');
const { createApp } = require('./app');

/**
 * Long-lived server: the "always active" deployment.
 *
 * Use this on a machine that stays on — the shop's own PC, a VPS, a container.
 * One warm process holding the connection pool, so the first request of the
 * morning is as fast as the last one of the night.
 *
 * For a deployment where nobody wants to keep a machine alive, use api/index.js
 * (Vercel) instead. Same app, same schema, same auth.
 */
async function startServer() {
  const app = await createApp();
  const httpServer = http.createServer(app);

  const port = process.env.PORT || 4000;
  // 0.0.0.0 rather than localhost, or the API refuses connections from the shop
  // LAN and from any reverse proxy in front of it. Binding to loopback is the
  // classic reason a containerised server looks healthy and serves nobody.
  const host = process.env.HOST || '0.0.0.0';
  httpServer.listen(port, host, () => {
    console.log(`Cake City POS API inatumika kwenye http://${host}:${port}/graphql`);
  });
}

startServer().catch((err) => {
  console.error('Server imeshindwa kuanza:', err);
  process.exit(1);
});
