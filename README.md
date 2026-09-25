# CakeCity POS

Mfumo wa POS (Point of Sale) kwa duka la keki — **Kiswahili kizima**, kinachofanya kazi
**ndani kabisa ya PC ya duka**. Hakuna mtandao unaohitajika wakati wa kutumia.

A complete, offline-first Point of Sale system for a bakery, built for a single shop
running entirely on its own computer. Entire UI, schema, and seed data are in Kiswahili.

---

## Demo (live, online)

**https://cakecity-smoky.vercel.app**

| | |
|---|---|
| Mmiliki (login id) | `1` |
| PIN | `1234` |

> The hosted demo runs on a temporary tunnel, so it sleeps when the local machine is off.
> For the shop itself, the whole system runs locally — see [Running it](#running-it).

---

## What it does

- **Bidhaa (Products)** — stock, price, category, low-stock alerts
- **Malighafi (Ingredients)** — stock levels with reorder thresholds
- **Mauzo (Sales)** — checkout, receipts, daily totals
- **Agizo (Orders)** — including special orders and fulfilment
- **Mteja (Customers)** — customer records
- **Mtumiaji (Users)** — role-based access (owner / cashier / chef / inventory)
- **Hisa na marekebisho** — stock adjustments and variance tracking
- **Kumbukumbu (Records)** — full sales and usage history

## Tech

| Layer | Choice |
|---|---|
| Backend | Node.js, Express 5, Apollo Server 4 (GraphQL) |
| Database | PostgreSQL (embedded, no cloud) |
| Auth | JWT + bcryptjs |
| Frontend | React 18, Vite, Apollo Client, Framer Motion |
| Language | JavaScript (ESM) |

The backend has **zero native dependencies** — no compiled modules, so the same code
runs on Windows, macOS, and Linux without rebuilding.

---

## Running it

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 15+ (running locally, default port 5432)

### 2. Configure

```bash
cp .env.example .env
```

Then edit `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/cakecity
PORT=4000
JWT_SECRET=<long random string>
CAKE_OWNER_JINA=Mmiliki Mkuu
CAKE_OWNER_PIN=1234
```

> `.env` is gitignored. **Never commit it** — it holds the owner's PIN and the JWT
> signing secret.

### 3. Install

```bash
npm install
cd web && npm install && cd ..
```

### 4. Create the database

```bash
createdb cakecity
npm run db:init     # schema + seed
```

The seed creates the owner account using `CAKE_OWNER_JINA` / `CAKE_OWNER_PIN`.
To wipe and start over: `npm run db:reset`.

### 5. Run

```bash
npm run dev         # backend on :4000, auto-reload
cd web && npm run dev   # UI on :5173
```

Open http://localhost:5173 and log in with the owner credentials.

### Production build

```bash
cd web && npm run build     # outputs to web/dist
```

The API URL is baked in at build time:

```bash
VITE_API_URL=http://localhost:4000/graphql npm run build
```

---

## Project layout

```
src/
  server.js            Express + Apollo entry point
  auth/jwt.js          token sign/verify, role guard
  db/
    pool.js            PostgreSQL pool
    schema.sql         14 tables (Kiswahili)
    seed.sql           starter data
    init.js            applies schema + seed
  graphql/             typeDefs + resolvers
web/
  src/                 React app (Apollo Client, Swahili UI)
  vite.config.js
paketi-pos/            Windows/macOS installer artifacts (gitignored)
```

---

## Deployment

The web app is static and deploys to Vercel (`framework: vite`, served from
`web/dist`). The API is a separate process — for a real shop you run it on the
shop's own computer; for the online demo it's tunneled from a dev machine.

---

## Security notes

- Passwords hashed with **bcryptjs**; PINs never stored in plaintext
- **JWT_SECRET** must be set to a long random value before any real use
- Change the default owner PIN before handing the system to a shop
- `.env`, keys, and installer binaries are gitignored by design
