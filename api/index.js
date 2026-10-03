/**
 * The Cake City API as a Vercel serverless function.
 *
 * Same Express app as src/server.js, same GraphQL schema, same auth. The only
 * difference is who owns the process: Vercel creates this for a request and
 * freezes it afterwards, instead of a process staying up indefinitely.
 *
 * That difference has two practical consequences, both handled here:
 *
 *   1. Apollo must be started before the first request is served, and that start
 *      is awaited exactly once per warm instance. The promise is cached at module
 *      scope so a second request reuses the same running server rather than
 *      starting a second one on top of it.
 *
 *   2. Vercel parses a JSON request body before handing it over, and body-parser
 *      (inside the app) must not then try to read an already-drained stream. The
 *      parsed body is put back and the stream is marked consumed, which is the
 *      documented way to tell body-parser to leave it alone.
 *
 * There is deliberately no reminder timer here. A frozen instance cannot keep a
 * setInterval alive, so reminders are driven from outside instead — see
 * DISABLE_REMINDER_TIMER in .env.example.
 */

const { createApp } = require('../src/app');

// Cached across invocations while the instance stays warm. Set to a rejected
// promise rather than left null if startup failed, so every later request on
// this instance reports the same clear configuration error instead of retrying
// a doomed startup on each one.
let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp().catch((err) => {
      // Clear the cache so a later invocation on a warm instance can try again
      // after the cause is fixed, but rethrow now so this request fails loudly.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

module.exports = async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    // A misconfigured deployment should say so plainly rather than return an
    // opaque 500 from deep inside Apollo on the first GraphQL call.
    console.error('[api] startup failed:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'Server haujaandikwa vizuri. Hakuna database au JWT_SECRET.',
      detail: err.message,
    });
    return;
  }

  // Mark the body as already consumed and hand the parsed object to the app.
  if (req.body !== undefined) {
    const parsed = req.body;
    delete req.body;
    req._body = true;
    req.body = parsed;
  }

  return app(req, res);
};
