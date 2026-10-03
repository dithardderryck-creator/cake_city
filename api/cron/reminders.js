/**
 * Generate the day's kitchen reminders, on a schedule.
 *
 * On a machine that stays on, src/reminders/engine.js refreshes these itself
 * every five minutes. A serverless instance cannot: it is frozen between
 * requests, so an interval registered at load either never fires or fires once
 * and is lost. That is why DISABLE_REMINDER_TIMER exists.
 *
 * This endpoint is the replacement. Vercel Cron calls it on a schedule and, when
 * CRON_SECRET is set, sends it as `Authorization: Bearer $CRON_SECRET`.
 *
 * That check is the whole reason this file exists in a separate function rather
 * than being another GraphQL mutation. Generation is owner-only over the API,
 * which is right for the app, and unusable for a cron — a scheduler has no staff
 * session and should not be given one. So this authenticates with a secret
 * instead, and the secret grants exactly one thing: run the generator. It cannot
 * read the ledger, change a price, or log in as anybody.
 *
 * Without CRON_SECRET configured this endpoint refuses every request, rather than
 * defaulting to open. An unauthenticated way to make the shop spend its budget
 * is not worth the convenience of a demo.
 */

const { generateUkumbusho } = require('../../src/reminders/engine');


module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({
      status: 'error',
      message: 'CRONE_SECRET haijasetwa. (CRON_SECRET is not configured.)',
    });
    return;
  }

  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Constant-time compare: a plain === leaks the secret a character at a time to
  // anyone who can measure the response.
  const ok =
    presented.length === secret.length &&
    require('crypto').timingSafeEqual(Buffer.from(presented), Buffer.from(secret));

  if (!ok) {
    res.status(401).json({ status: 'error', message: 'Not authorised.' });
    return;
  }

  const started = Date.now();
  try {
    await generateUkumbusho();
    res.status(200).json({ status: 'ok', ms: Date.now() - started });
  } catch (err) {
    // Log the real reason; return something generic. This response is reachable
    // by anyone who has the cron secret, but there is no reason to hand a stack
    // trace to a scheduler.
    console.error('[ukumbusho] cron generation failed:', err);
    res.status(500).json({ status: 'error', ms: Date.now() - started });
  }
  // The pool is deliberately left open. Closing it is the right habit in a CLI
  // script, and the wrong one here: Vercel reuses warm instances, and an
  // instance that closed its pool on invocation one fails on invocation two,
  // which turns a routine nightly job into an intermittent one. Idle connections
  // are reclaimed when the instance is reclaimed, which is the runtime's job.
};
