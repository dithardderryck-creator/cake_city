// Idempotent database bootstrap — shared by init.js (CLI) and the
// Vercel serverless function (lazy cold-start). Applies schema, config
// seed and creates the first owner account only when the tables are missing.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { runMigrations } = require('./migrate');

// J4: recovery notice path. Kept next to the project so the shop owner (or
// whoever installed it) can be shown the PIN directly, instead of it existing
// only in a deployment log nobody in the shop can read.
const RECOVERY_FILE = path.join(__dirname, '..', '..', 'OWNER-PIN.txt');

function writeRecoveryNotice(name, pin) {
  try {
    fs.writeFileSync(
      RECOVERY_FILE,
      [
        'Cake City POS — mmiliki mkuu (owner account)',
        '',
        `Jina / Name : ${name}`,
        `PIN         : ${pin}`,
        '',
        'Badilisha PIN mara moja baada ya kuingia, kisha futua faili hii.',
        '(Change the PIN after first login, then delete this file.)',
        '',
        `Imeandikwa / Written: ${new Date().toISOString()}`,
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    return true;
  } catch (err) {
    // A read-only filesystem must not stop the shop from starting.
    console.warn(
      `[bootstrap] could not write ${RECOVERY_FILE} (${err.message}). ` +
        'Show the PIN in the console to the shop owner instead.'
    );
    return false;
  }
}

const OWNER_INSERT = `INSERT INTO mtumiaji (jina, jukumu, pin_hash) VALUES ($1, 'owner', $2)`;

function randomPin() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

async function ensureOwner() {
  const ownerName = process.env.CAKE_OWNER_JINA || 'Mmiliki Mkuu';
  let ownerPin = process.env.CAKE_OWNER_PIN;
  let generated = false;

  if (!ownerPin) {
    ownerPin = randomPin();
    generated = true;
    // J4: a PIN printed only to server logs is invisible to the shop, and on
    // a serverless host the log is developer-only — the owner would be locked
    // out with no way to learn the new PIN. Write it somewhere the operator
    // can actually reach, and say so out loud.
    const written = writeRecoveryNotice(ownerName, ownerPin);
    console.log('');
    console.log('┌───────────────────────────────────────────────────────┐');
    console.log('│  INITIAL OWNER ACCOUNT                                │');
    console.log(`│  Name: ${ownerName.padEnd(46)}│`);
    console.log(`│  PIN:  ${ownerPin.padEnd(46)}│`);
    console.log('│                                                       │');
    console.log('│  Set CAKE_OWNER_PIN in env to use your own PIN.       │');
    console.log('│  PIN is NOT stored in SQL — use the login API.        │');
    if (written) {
      console.log(`│  Also saved to ${path.basename(RECOVERY_FILE)} — show it to the owner.`.padEnd(56) + '│');
    }
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

  // Bring existing installs forward to the current schema version. Runs on
  // every boot but applies each numbered step at most once.
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
  }
}

module.exports = { ensureDbInitialized, randomPin, RECOVERY_FILE, writeRecoveryNotice };