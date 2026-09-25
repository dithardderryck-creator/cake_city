// Idempotent database bootstrap — shared by init.js (CLI) and the
// Vercel serverless function (lazy cold-start). Applies schema, config
// seed and creates the first owner account only when the tables are missing.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const OWNER_INSERT = `INSERT INTO mtumiaji (jina, jukumu, pin_hash) VALUES ($1, 'owner', $2)`;

function randomPin() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

async function ensureOwner() {
  const ownerName = process.env.CAKE_OWNER_JINA || 'Mmiliki Mkuu';
  let ownerPin = process.env.CAKE_OWNER_PIN;

  if (!ownerPin) {
    ownerPin = randomPin();
    console.log('');
    console.log('┌───────────────────────────────────────────────────────┐');
    console.log('│  INITIAL OWNER ACCOUNT                                │');
    console.log(`│  Name: ${ownerName.padEnd(46)}│`);
    console.log(`│  PIN:  ${ownerPin.padEnd(46)}│`);
    console.log('│                                                       │');
    console.log('│  Set CAKE_OWNER_PIN in env to use your own PIN.       │');
    console.log('│  PIN is NOT stored in SQL — use the login API.        │');
    console.log('└───────────────────────────────────────────────────────┘');
    console.log('');
  }

  const pinHash = await bcrypt.hash(String(ownerPin), 10);
  await pool.query(OWNER_INSERT, [ownerName, pinHash]);
  return ownerPin;
}

async function ensureDbInitialized() {
  const { rows } = await pool.query(`SELECT to_regclass('public.mauzo') AS tbl`);
  const schemaExists = rows[0]?.tbl != null;

  if (!schemaExists) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await pool.query(schema);
    await ensureOwner();
    await pool.query(seed);
    console.log('Database initialized: schema + muda_wa_kazi defaults + initial owner account.');
  } else {
    const { rows: counts } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM mtumiaji WHERE id = 1 AND jukumu = 'owner'`
    );
    if (counts[0].c === 0) {
      await ensureOwner();
      console.log('Database already had schema; created missing initial owner account.');
    }
  }
}

module.exports = { ensureDbInitialized, randomPin };