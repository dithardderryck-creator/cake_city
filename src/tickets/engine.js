/**
 * Mfumo wa Tikiti (Ticket Engine)
 *
 * Allocates a per-day sequential ticket number and creates a ticket row
 * inside the caller's transaction, so a sale/order and its ticket are
 * committed (or rolled back) together — no record is ever lost.
 *
 * Note: date handling always uses Postgres CURRENT_DATE, never JS date
 * math, to avoid timezone shifts (EAT vs UTC).
 */

/**
 * Atomically allocate the next daily ticket number.
 * Must be called inside an open transaction (client).
 * Returns { dateKey, namba } where dateKey is a YYYY-MM-DD string.
 */
async function nextTicketNumber(client) {
  const { rows } = await client.query(
    `INSERT INTO mlolongo_wa_tikiti (tarehe, namba)
     VALUES (CURRENT_DATE, 1)
     ON CONFLICT (tarehe) DO UPDATE SET namba = mlolongo_wa_tikiti.namba + 1
     RETURNING tarehe::date AS day, namba`
  );
  const row = rows[0];
  return {
    dateKey: row.day.toISOString().slice(0, 10),
    namba: row.namba,
  };
}

/**
 * Create a ticket for a sale (counter sale) inside the transaction.
 */
async function tikitishaMauzo(client, { mauzo_id, jumla, maelezo, jina }) {
  const { namba } = await nextTicketNumber(client);
  const { rows } = await client.query(
    `INSERT INTO tikiti (namba, tarehe, aina, hali, mauzo_id, jina, maelezo, jumla)
     VALUES ($1, CURRENT_DATE, 'mauzo', 'in_queue', $2, $3, $4, $5) RETURNING *`,
    [namba, mauzo_id, jina || 'Mteja', maelezo || null, jumla]
  );
  return rows[0];
}

/**
 * Create a ticket for a custom order (agizo maalum) inside the transaction.
 */
async function tikitishaAgizo(client, { agizo_id, jumla, maelezo, jina }) {
  const { namba } = await nextTicketNumber(client);
  const { rows } = await client.query(
    `INSERT INTO tikiti (namba, tarehe, aina, hali, agizo_id, jina, maelezo, jumla)
     VALUES ($1, CURRENT_DATE, 'agizo', 'in_queue', $2, $3, $4, $5) RETURNING *`,
    [namba, agizo_id, jina || 'Mteja', maelezo || null, jumla]
  );
  return rows[0];
}

module.exports = {
  nextTicketNumber,
  tikitishaMauzo,
  tikitishaAgizo,
};