const pool = require('../db/pool');

const pad2 = (n) => String(n).padStart(2, '0');
const localDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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
    return { perDay: rows[0]?.per_day || 0, daysLeft: 0, depletionDate: new Date() };
  }
  const perDay = rows[0]?.per_day || 0;
  const daysLeft = perDay > 0 ? Math.floor(ing.kiasi_kilichopo / perDay) : 999;
  const depletion = new Date();
  depletion.setDate(depletion.getDate() + daysLeft);
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
    const pickup = new Date(`${isoDate}T17:00:00`);
    const now = new Date();

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
          : `Hisa ya "${ing.jina}" itaisha ndani ya siku ~${forecast.daysLeft} (kadirio ${localDateKey(forecast.depletionDate)}).`
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

async function upsertReminder({ aina, lengo, agizo_id, malighafi_id, ujumbe, tarehe, muda }) {
  await pool.query(
    `INSERT INTO ukumbusho (aina, lengo, agizo_id, malighafi_id, ujumbe, tarehe_ya_utekelezaji, muda_inayopendekezwa)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (aina, lengo, COALESCE(agizo_id, 0), COALESCE(malighafi_id, 0)) DO NOTHING`,
    [aina, lengo, agizo_id, malighafi_id, ujumbe, tarehe, muda]
  );
}

setInterval(() => {
  generateUkumbusho().catch((e) => console.error('[ukumbusho] gen error:', e.message));
}, 5 * 60 * 1000);

module.exports = { generateUkumbusho, getPrepTime, predictStockFor };