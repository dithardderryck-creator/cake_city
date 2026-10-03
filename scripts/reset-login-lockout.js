/**
 * Clear login throttling state.
 *
 * Lockouts are stored in Postgres, so they now survive a restart and a redeploy
 * on purpose — otherwise an attacker facing more than one instance gets a fresh
 * set of attempts for every instance, and clearing the record of a grinding
 * attack is as easy as waiting for a deploy.
 *
 * The cost of that is that a lockout no longer clears itself when the shop
 * closes up. If a cashier is locked out and nobody can wait fifteen minutes,
 * this is the way back in. Run it from the machine that has the database:
 *
 *   npm run login:reset
 *
 * Pass a staff id to clear one account instead of everything:
 *
 *   npm run login:reset -- 7
 *
 * This is a recovery tool, not a routine one: it clears the per-IP throttle too,
 * so it also erases the evidence that one address was grinding many accounts.
 * Reach for it when staff are blocked, not as a way to make a warning go away.
 */

require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');

async function main() {
  const id = process.argv[2];

  if (id) {
    if (!/^\d+$/.test(id)) {
      console.error('Namba ya mtumiaji lazima iwe namba. (Staff id must be a number.)');
      process.exit(1);
    }
    const { rowCount } = await pool.query('DELETE FROM jaribio_la_ingia WHERE kituo = $1', [
      `id:${id}`,
    ]);
    console.log(
      rowCount > 0
        ? `Akaunti ya mtumiaji ${id} imefunguliwa. (Staff account ${id} unlocked.)`
        : `Akaunti ya mtumiaji ${id} haikuwa imefungwa. (Staff account ${id} was not locked.)`
    );
    return;
  }

  const { rowCount } = await pool.query('DELETE FROM jaribio_la_ingia');
  console.log(
    `Majaribio yote ya kuingia yamefutwa (${rowCount}). ` +
      `Sasa mtu yeyote anaweza kujaribu tena. ` +
      `(All login throttling cleared: ${rowCount} rows. Anyone may now log in.)`
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Imeshindwa kufuta majaribio:', err.message);
    process.exit(1);
  });
