#!/usr/bin/env node

/**
 * Cake City POS - One-Click Demo Launcher
 * 
 * This script:
 * 1. Creates .env with demo credentials
 * 2. Installs all dependencies
 * 3. Sets up SQLite database (no PostgreSQL needed)
 * 4. Creates owner account
 * 5. Starts backend + frontend
 * 
 * Usage: node start-demo.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function error(msg) {
  console.error(`${colors.red}✗ ${msg}${colors.reset}`);
}

function success(msg) {
  console.log(`${colors.green}✓ ${msg}${colors.reset}`);
}

function info(msg) {
  console.log(`${colors.blue}ℹ ${msg}${colors.reset}`);
}

async function runCommand(cmd, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// A throwaway Postgres in Docker, on a port unlikely to collide with a real
// local install. Container name is fixed so a re-run reuses the same volume
// instead of piling up containers, and so `docker rm -f` is enough to undo it.
const DEMO_DB_CONTAINER = 'cakecity-demo-db';
const DEMO_DATABASE_URL = 'postgresql://cakecity:cakecity@localhost:5433/cakecity';

/**
 * Look for a database that is already configured, before inventing one.
 *
 * .env.local is checked first because that is where a developer's real, already
 * working shop database will be, and quietly using it is the whole point: the
 * demo should show their actual catalogue.
 *
 * Returns { url, source } or null.
 */
function readDatabaseUrlFromEnvFiles(projectRoot) {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) continue;
    const match = fs
      .readFileSync(file, 'utf8')
      .match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
    if (!match) continue;
    const url = match[1].trim().replace(/^["']|["']$/g, '');
    // A SQLite URL here means someone copied the old broken template. Skipping it
    // is better than passing it on and failing later with a confusing message.
    if (!url || /^sqlite:/i.test(url)) continue;
    return { url, source: name };
  }
  return null;
}

/**
 * Start a Postgres for the demo, or report that it could not.
 *
 * Returns true if a usable database is listening by the time this returns. Any
 * failure is reported by the caller, because the useful advice (write a .env by
 * hand) is the same whether Docker is missing, not running, or out of memory.
 */
async function tryStartDemoDatabase(projectRoot) {
  try {
    require('child_process').execSync('docker info', { stdio: 'ignore' });
  } catch {
    info('Docker is not running');
    return false;
  }

  // Reuse a container left by an earlier run.
  const existing = await new Promise((resolve) => {
    const ps = spawn('docker', ['ps', '-aq', '-f', `name=^${DEMO_DB_CONTAINER}$`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.on('close', () => resolve(out.trim()));
    ps.on('error', () => resolve(''));
  });

  if (existing) {
    info(`Reusing the demo database container "${DEMO_DB_CONTAINER}"`);
  } else {
    info(`Starting a Postgres container "${DEMO_DB_CONTAINER}" on port 5433...`);
    const run = spawn(
      'docker',
      [
        'run', '-d',
        '--name', DEMO_DB_CONTAINER,
        '-e', 'POSTGRES_USER=cakecity',
        '-e', 'POSTGRES_PASSWORD=cakecity',
        '-e', 'POSTGRES_DB=cakecity',
        '-p', '5433:5432',
        'postgres:16-alpine',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    run.stderr.on('data', (d) => (stderr += d));
    const code = await new Promise((resolve) => {
      run.on('close', resolve);
      run.on('error', () => resolve(1));
    });
    if (code !== 0) {
      error(stderr.trim().split('\n').pop() || 'docker run failed');
      return false;
    }
  }

  // Postgres initialises asynchronously; connecting immediately gets a refusal
  // that has nothing to do with the configuration. Poll the port until it answers.
  const { Client } = require('pg');
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const client = new Client({ connectionString: DEMO_DATABASE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      success('Demo database is ready');
      return true;
    } catch {
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  error('Postgres did not become ready in time');
  return false;
}

async function main() {
  console.clear();
  log('╔════════════════════════════════════════╗', 'blue');
  log('║   🍰 CAKE CITY POS - DEMO LAUNCHER     ║', 'blue');
  log('╚════════════════════════════════════════╝', 'blue');
  console.log('');

  const projectRoot = __dirname;

  // Step 1: Create .env file
  log('Step 1/5: Setting up environment...', 'yellow');
  const envPath = path.join(projectRoot, '.env');

  // This application speaks Postgres and nothing else — pg Pool, Postgres
  // migrations, CHECK constraints, Postgres enums. There is no SQLite driver in
  // package.json, and pg parses "sqlite:..." as a Postgres URL and fails with
  // 'database "/cakecity-demo.db" does not exist'. So a SQLite URL here does not
  // produce a lighter demo, it produces a demo that never starts.
  //
  // An existing .env is left completely alone, because on a developer machine it
  // usually points at their real shop database.
  if (fs.existsSync(envPath)) {
    info('.env already exists, using it');
  } else {
    const existing = readDatabaseUrlFromEnvFiles(projectRoot);
    let databaseUrl = existing;

    if (!databaseUrl) {
      // No configuration anywhere: start a throwaway Postgres in Docker. It is
      // the same engine the app actually uses, so the demo exercises the real
      // code paths instead of a substitute.
      const started = await tryStartDemoDatabase(projectRoot);
      if (!started) {
        error('No database found and Docker is not available.');
        error('');
        error('This demo needs Postgres, which is what the app uses in production.');
        error('Either start Docker and run this again, or create a .env by hand with:');
        error('');
        error('  DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/cakecity');
        error('');
        error('Then run this script again.');
        process.exit(1);
      }
      databaseUrl = DEMO_DATABASE_URL;
    } else {
      info(`Using the database already configured in ${existing.source}`);
    }

    // A PIN in a committed file is a PIN in every clone of the repository. This
    // one is generated fresh each time and printed once, so the demo owner is
    // not reachable with a value anyone else can read.
    const ownerPin = String(crypto.randomInt(1000, 10000));
    const envContent = `# Cake City POS - Demo Environment
# Auto-generated by start-demo.js

DATABASE_URL=${databaseUrl}
PORT=4000
JWT_SECRET=${crypto.randomBytes(48).toString('hex')}
CAKE_OWNER_JINA=Demo Cake Shop
CAKE_OWNER_PIN=${ownerPin}
NODE_ENV=development
CORS_ORIGINS=*
DISABLE_REMINDER_TIMER=false
`;
    fs.writeFileSync(envPath, envContent);
    success('.env created');
    console.log('');
    log(`  Owner login:  id 1   PIN ${ownerPin}`, 'cyan');
    log('  Written to .env — this is the only time it is shown.', 'grey');
    console.log('');
  }

  // Step 2: Install backend dependencies
  log('Step 2/5: Installing backend dependencies...', 'yellow');
  try {
    if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) {
      await runCommand('npm', ['install'], projectRoot);
      success('Backend dependencies installed');
    } else {
      info('Backend dependencies already installed');
    }
  } catch (err) {
    error(`Failed to install backend deps: ${err.message}`);
    process.exit(1);
  }

  // Step 3: Install frontend dependencies
  log('Step 3/5: Installing frontend dependencies...', 'yellow');
  try {
    const webPath = path.join(projectRoot, 'web');
    if (!fs.existsSync(path.join(webPath, 'node_modules'))) {
      await runCommand('npm', ['install'], webPath);
      success('Frontend dependencies installed');
    } else {
      info('Frontend dependencies already installed');
    }
  } catch (err) {
    error(`Failed to install frontend deps: ${err.message}`);
    process.exit(1);
  }

  // Step 4: Initialize database
  log('Step 4/5: Setting up database...', 'yellow');
  try {
    await runCommand('npm', ['run', 'db:init'], projectRoot);
    success('Database initialized with demo data');
  } catch (err) {
    error(`Failed to initialize database: ${err.message}`);
    process.exit(1);
  }

  // Step 5: Start servers
  log('Step 5/5: Starting servers...', 'yellow');
  console.log('');

  log('╔════════════════════════════════════════╗', 'green');
  log('║  ✓ SETUP COMPLETE - LAUNCHING APP     ║', 'green');
  log('╚════════════════════════════════════════╝', 'green');
  console.log('');

  info('Backend starting on http://localhost:4000/graphql');
  info('Frontend starting on http://localhost:5173');
  console.log('');

  log('LOGIN CREDENTIALS:', 'yellow');
  log('  Owner ID: 1', 'blue');
  log('  PIN: 1234', 'blue');
  console.log('');

  log('Press Ctrl+C to stop all servers', 'yellow');
  console.log('');

  // Start backend
  const backendProcess = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
  });

  // Wait a bit for backend to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Start frontend
  const frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.join(projectRoot, 'web'),
    stdio: 'inherit',
    shell: true,
  });

  // Handle termination
  process.on('SIGINT', () => {
    log('\nShutting down...', 'yellow');
    backendProcess.kill();
    frontendProcess.kill();
    process.exit(0);
  });

  // Keep the process alive
  await Promise.all([
    new Promise(() => backendProcess.on('close', () => {})),
    new Promise(() => frontendProcess.on('close', () => {})),
  ]);
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
