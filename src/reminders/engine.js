const pool = require('../db/pool');
const { eatDateKey, eatNow, eatWallClock } = require('../lib/dates');

/**
 * Mfumo wa Ukumbusho wa Mwongozaji (Guided Reminder Engine)
 *
 * Predicts deadlines from data and routes reminders to departments:
 *  - Chef:  prep-time estimate -> "start baking now or risk missing pickup"
 *  - Cashier: pickup date approaching -> collect prep / hand off.
 *  - Inventory: stock depletion forecast -> day-by-day consumption rate.
 *  - Owner: sees all of the above (via lengo filter in resolver).
 */

const MIN_PICKUP_LOOKAHEAD_HOURS = 24;
const STOCK_FORECAST_DAYS = 7;

async function getPrepTime(ladha, ukubwa) {
  const { rows } = await pool.query(
    `SELECT dakika FROM muda_wa_kazi WHERE LOWER(ukubwa) = LOWER($1)`,
    [ukubwa || '']
  );
  if (rows[0]) return rows[0].dakika;
  // Flavor-based fallback (common boring sizes store as flavor too)
  const alt = await pool.query(
    `SELECT dakika FROM muda_wa_kazi WHERE LOWER(ukubwa) = LOWER($1)`,
    [ladha || '']
  );
  if (alt.rows[0]) return alt.rows[0].dakika;
  return 90; // default
}

async function predictStockFor(malighafiId) {
  // Daily usage rate over the last 14 days (excludes wasted today).
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(kiasi)::float / NULLIF(COUNT(DISTINCT tarehe::date), 0), 0) AS per_day,
        COUNT(*) AS days_logged
     FROM kumbukumbu_matumizi
     WHERE malighafi_id = $1
       AND tarehe >= CURRENT_DATE - INTERVAL '14 days'`,
    [malighafiId]
  );
  const ing = (
    await pool.query(
      `SELECT kiasi_kilichopo, kiwango_cha_chini FROM malighafi WHERE id = $1`,
      [malighafiId]
    )
  ).rows[0];
  if (!ing || ing.kiasi_kilichopo <= 0) {
    return { perDay: rows[0]?.per_day || 0, daysLeft: 0, depletionDate: eatNow() };
  }
  const perDay = rows[0]?.per_day || 0;
  const daysLeft = perDay > 0 ? Math.floor(ing.kiasi_kilichopo / perDay) : 999;
  // Add days on the EAT wall clock so the forecast date cannot slip a day
  // when the host process runs in a different timezone.
  const depletion = eatNow();
  depletion.setUTCDate(depletion.getUTCDate() + daysLeft);
  return { perDay, daysLeft, depletionDate: depletion };
}

async function generateUkumbusho() {
  // ── 1. Chef + Cashier reminders from active custom orders ──────────
  const orders = (
    await pool.query(
      `SELECT a.*, to_char(a.tarehe_ya_kuchukua, 'YYYY-MM-DD') AS tarehe_chukua, m.jina AS mteja_jina
       FROM agizo_maalum a
       LEFT JOIN mteja m ON m.id = a.mteja_id
       WHERE a.hali IN ('ordered', 'in_progress', 'ready')
       ORDER BY a.tarehe_ya_kuchukua`
    )
  ).rows;

  for (const o of orders) {
    const prepMin = await getPrepTime(o.ladha, o.ukubwa);
    const isoDate = o.tarehe_chukua;
    // Pin the deadline to Tanzania time explicitly. Without the +03:00 offset
    // JS parses this as the *host's* local time, so a UTC server would treat a
    // 17:00 EAT pickup as 20:00 and fire "start baking now" three hours late.
    const pickup = eatWallClock(isoDate, 17, 0);
    const now = eatNow();

    const startBy = new Date(pickup.getTime() - prepMin * 60 * 1000);
    const hoursToPickup = (pickup - now) / 3600_000;

    // Chef: order still not started but should be by now
    if (o.hali === 'ordered' && now >= startBy) {
      await upsertReminder({
        aina: 'anza_kutengeneza',
        lengo: 'chef',
        agizo_id: o.id,
        malighafi_id: null,
        ujumbe: `"${o.ladha}" (${o.ukubwa || 'ukubwa binafsi'}) inahitaji kuanza kujengwa sasa — inakadiriwa dakika ${prepMin} hadi kuchukuliwa (siku ${isoDate}, saa 17:00).`,
        tarehe: o.tarehe_ya_kuchukua,
        muda: startBy,
      });
    }

    // Cashier: pickup within 24h — get ready to hand over
    if (o.hali !== 'ready' && o.hali !== 'collected' && hoursToPickup <= MIN_PICKUP_LOOKAHEAD_HOURS && hoursToPickup >= 0) {
      await upsertReminder({
        aina: 'tarehe_ya_kuchukua',
        lengo: 'cashier',
        agizo_id: o.id,
        malighafi_id: null,
        ujumbe: `Agizo "${o.ladha}" lichukuliwe tarehe ${isoDate} (saa 17:00) — tayarisha risiti ya ${o.mteja_jina || 'mteja'}.`,
        tarehe: o.tarehe_ya_kuchukua,
        muda: pickup,
      });
    }
  }

  // ── 2. Inventory + owner: stock depletion forecast ─────────────────
  const ingredients = (
    await pool.query(`SELECT id, jina, unit FROM malighafi`)
  ).rows;
  for (const ing of ingredients) {
    const forecast = await predictStockFor(ing.id);
    if (forecast.daysLeft <= STOCK_FORECAST_DAYS) {
      const msg =
        forecast.daysLeft <= 0
          ? `Hisa ya "${ing.jina}" imeisha. Jaza upya mara moja.`
          : `Hisa ya "${ing.jina}" itaisha ndini ya siku ~${forecast.daysLeft} (kadirio ${eatDateKey(forecast.depletionDate)}).`
      await upsertReminder({
        aina: 'hisa_itakosa',
        lengo: 'inventory',
        agizo_id: null,
        malighafi_id: ing.id,
        ujumbe: msg,
        tarehe: forecast.depletionDate,
        muda: null,
      });
      // Owner sees the same alert so they can verify.
      await upsertReminder({
        aina: 'hisa_itakosa',
        lengo: 'owner',
        agizo_id: null,
        malighafi_id: ing.id,
        ujumbe: msg,
        tarehe: forecast.depletionDate,
        muda: null,
      });
    }
  }

  return true;
}

// How long a dismissed reminder stays quiet while its condition persists.
// A new message (e.g. stock went from 3 days to 1 day left) re-arms it
// immediately regardless of this window.
const REMINDER_REARM_HOURS = 4;

async function upsertReminder({ aina, lengo, agizo_id, malighafi_id, ujumbe, tarehe, muda }) {
  await pool.query(
    `INSERT INTO ukumbusho (aina, lengo, agizo_id, malighafi_id, ujumbe, tarehe_ya_utekelezaji, muda_inayopendekezwa)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (aina, lengo, COALESCE(agizo_id, 0), COALESCE(malighafi_id, 0))
     DO UPDATE SET
       ujumbe = EXCLUDED.ujumbe,
       imesomwa = false,
       tarehe_ya_utekelezaji = EXCLUDED.tarehe_ya_utekelezaji,
       muda_inayopendekezwa = EXCLUDED.muda_inayopendekezwa,
       updated_at = NOW()
     WHERE ukumbusho.ujumbe IS DISTINCT FROM EXCLUDED.ujumbe
        OR ukumbusho.updated_at < NOW() - ($8 || ' hours')::interval`,
    [
      aina,
      lengo,
      agizo_id,
      malighafi_id,
      ujumbe,
      tarehe,
      muda,
      String(REMINDER_REARM_HOURS),
    ]
  );
}

/**
 * Periodic reminder refresh.
 *
 * J1: an in-process interval assumes a long-running Node process, which is
 * correct for the "runs on the shop's own PC" model. It is NOT correct for a
 * serverless target, where a cold instance may be torn down before the
 * interval fires and a warm instance can register duplicates. Set
 * DISABLE_REMINDER_TIMER=true when running serverless and trigger generation
 * from the existing tengeneza_ukumbusho mutation or an external cron instead.
 *
 * unref() keeps the timer from holding the event loop open, so `node
 * src/server.js`, CLI scripts and tests can exit cleanly.
 */
const timerDisabled = process.env.DISABLE_REMINDER_TIMER === 'true';
if (!timerDisabled) {
  const timer = setInterval(() => {
    generateUkumbusho().catch((e) => console.error('[ukumbusho] gen error:', e.message));
  }, 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { generateUkumbusho, getPrepTime, predictStockFor, REMINDER_REARM_HOURS };