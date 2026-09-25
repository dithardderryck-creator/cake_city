# Cake City POS — Backend Fix List (work order)

> **Status: implemented 2026-09-25.** Items B1–B4, C1–C3, D1, E1–E2, F1, G1, H1,
> J1–J5, K1–K2 and A1–A4 are fixed and covered by `npm run verify`
> (`scripts/verify-fixes.js`, 35 end-to-end checks, all green).
> A5, I1 and K3 are deliberately still open — see "Still open" at the end.
> Original findings are kept below unchanged so the reasoning stays auditable.

You are working on the Cake City POS backend (`src/`) — a Node/Express/Apollo GraphQL
API over PostgreSQL, serving a bakery POS. The frontend is being rebuilt separately, so
**do not change GraphQL type/field names or resolver signatures** unless a fix explicitly
requires it (noted per-item below). Fix items in the order listed — later items sometimes
depend on earlier ones (e.g. add DB constraints before relying on them in resolver logic).

For every fix: update the resolver/schema/SQL as needed, and if a `CHECK` constraint or
migration is required, add it as a new migration step rather than editing `schema.sql`
in place (the shop may already have a live database).

---

## A. Security (already known — fix these too, they're not optional)

### A1. No brute-force protection on login
`login` mutation has no rate limiting or lockout, PINs are 4 digits, and the
`wafanyakazi` query is unauthenticated and returns every staff member's id/name/role —
handing an attacker the exact inputs needed to grind PINs.
**Fix:** add a per-account and per-IP attempt counter (even a simple in-memory or
Postgres-backed lockout after ~5 failed attempts within N minutes is enough for a
single-shop deployment). Consider requiring PINs longer than 4 digits going forward.

### A2. CORS wholly open
`app.use(cors())` in `src/server.js` has no origin allowlist.
**Fix:** restrict to the known frontend origin(s) via `cors({ origin: [...] })`.

### A3. TLS verification disabled for managed Postgres
`src/db/pool.js` sets `ssl: { rejectUnauthorized: false }` for any non-local host.
**Fix:** load the provider's CA certificate and verify properly, or at minimum only
disable verification when an explicit `DB_INSECURE_TLS=true` env flag is set, never by
default.

### A4. No startup check for `JWT_SECRET`
If unset, the app boots fine and only fails inside `jsonwebtoken` on first login.
**Fix:** in `src/server.js` startup, `if (!process.env.JWT_SECRET) throw new Error(...)`
before calling `httpServer.listen`.

### A5. JWT stored in `localStorage`
Standard SPA tradeoff, but worth reconsidering given A1 — an XSS bug becomes full
account takeover. Since the frontend is being rebuilt anyway, consider httpOnly cookies
+ CSRF token instead. Not urgent if A1–A2 are fixed first.

---

## B. State-machine correctness (order ↔ ticket sync)

### B1. `chukua_agizo` and `chukua_tikiti` have no guard against terminal states
Both mutations (`src/graphql/resolvers.js`) jump straight to
`UPDATE ... SET hali = 'collected'` with no check on the current status. Calling either
on a `cancelled` record silently resurrects it to `collected`.
**Fix:** in both, look up current `hali` first and throw a `BAD_REQUEST` GraphQLError if
it's already `cancelled` (mirror the guard already present in `badge_hali_order`/
`badge_hali_tikiti`). Also tighten `chukua_agizo`'s companion ticket update from
`WHERE agizo_id = $1 AND hali != 'collected'` to
`WHERE agizo_id = $1 AND hali NOT IN ('collected', 'cancelled')`.

### B2. `futa_tikiti` doesn't cascade-cancel the linked order
Cancelling a ticket (used by the ticket board's cancel button) only updates
`tikiti.hali`. It never reads `agizo_id` or touches `agizo_maalum`, so a cancelled
ticket leaves its custom order alive in `ordered`/`in_progress` forever — it keeps
showing in the chef's kitchen queue and the owner's outstanding-balance report.
**Fix:** mirror what `futa_agizo` does in reverse — after cancelling the ticket, if
`cur.agizo_id` is set, also `UPDATE agizo_maalum SET hali = 'cancelled' ... WHERE id =
$1 AND hali != 'collected'` inside the same transaction.

### B3. `hariri_mfanyakazi` has no last-owner guard
`futa_mfanyakazi` (delete) correctly blocks removing the last active owner, but
`hariri_mfanyakazi` (edit) does not — you can demote the last owner's `jukumu` to
`cashier` and lock the shop out of admin functions entirely.
**Fix:** before applying a role change away from `owner`, run the same
`COUNT(*) FROM mtumiaji WHERE jukumu = 'owner' AND active = true` check used in
`futa_mfanyakazi` and reject if the target is the last one.

### B4. Deactivated staff keep working until their JWT naturally expires
`futa_mfanyakazi` sets `active = false`, but the GraphQL context only verifies JWT
signature/expiry (`verifyToken`), never re-checks `active` against the DB per request.
A fired staff member's token stays valid for up to 12h.
**Fix:** either (a) look up `active` from `mtumiaji` on every authenticated request and
reject if false, or (b) shorten `TOKEN_TTL` significantly and accept the residual
window. (a) is the more correct fix; add a small cache/short TTL if the extra query per
request is a concern at scale (irrelevant here, but note it).

---

## C. Data integrity — validation gaps

### C1. No floor on quantities/amounts that move money or stock
None of the following are validated server-side:
- `unda_mauzo`: `bidhaa[].kiasi` (line-item quantity) — accepts negative values, which
  reduce the sale total and insert a negative `mauzo_bidhaa.kiasi` row.
- `unda_mauzo`: `punguzo` (discount) — no `>= 0` check server-side (client has
  `min="0"` but that doesn't protect the mutation itself).
- `log_matumizi`: `kiasi` — a negative value run through the `update_stock_from_usage`
  trigger *increases* stock instead of decreasing it.
- `marekebisho_hisa`: `kiasi` — same issue; a negative "waste" quantity increases stock.

**Fix:** add `CHECK (kiasi > 0)` (or `>= 0` where zero is meaningful) constraints in the
schema for `mauzo_bidhaa.kiasi`, `kumbukumbu_matumizi.kiasi`, `marekebisho_hisa.kiasi`,
plus resolver-level validation that throws a friendly `BAD_REQUEST` before hitting the
DB (so the error message is useful instead of a raw constraint violation). Also validate
`punguzo >= 0` in `unda_mauzo`.

### C2. `unda_agizo` doesn't validate deposit vs. total
No check that `malipo_ya_awali <= bei_jumla`, so the generated `salio` column
(`bei_jumla - malipo_ya_awali`) can go negative.
**Fix:** validate in the resolver before insert; optionally also add
`CHECK (malipo_ya_awali <= bei_jumla)` on `agizo_maalum`.

### C3. `log_matumizi` has a TOCTOU race on the stock check
It does `SELECT kiasi_kilichopo` → compares in JS → `INSERT` (which fires a trigger
that decrements). Two concurrent logs against the same ingredient can both pass the
check and both decrement, pushing stock negative.
**Fix:** wrap the check-and-insert in a transaction using
`SELECT kiasi_kilichopo FROM malighafi WHERE id = $1 FOR UPDATE` to lock the row for the
duration, or add `CHECK (kiasi_kilichopo >= 0)` on `malighafi` as a hard backstop (the
insert will then fail loudly instead of silently going negative — catch that error and
surface `INSUFFICIENT_STOCK` same as today).

---

## D. Owner dashboard correctness

### D1. Outstanding-balance figures include cancelled orders
In `riport_dashboard`, the `balancesRes` query is:
```sql
SELECT * FROM agizo_maalum WHERE hali != 'collected' ORDER BY tarehe_ya_kuchukua
```
This feeds both `maagizo_ambayo_hajakusanywa` (the "pending balance" list shown to the
owner) and `salio_jumla_ajira` (total money owed). Cancelled orders are never excluded,
so a cancelled order still appears as an unpaid pending order and its balance still gets
summed into "money owed."
**Fix:** change the filter to `WHERE hali NOT IN ('collected', 'cancelled')`.

---

## E. Timezone / temporal correctness

The codebase has one place that gets this right and several that don't. `src/tickets/
engine.js` deliberately avoids JS date math in favor of Postgres `CURRENT_DATE`,
with an explicit comment explaining why (EAT vs UTC shifts). Apply the same discipline
everywhere else:

### E1. `src/reminders/engine.js` computes pickup deadlines in server-local time
```js
const pickup = new Date(`${isoDate}T17:00:00`);
```
This string has no timezone designator, so JS parses it as local time *of the Node
process*, not Tanzania time. If the server runs in UTC, "5pm pickup" is actually
computed as 8pm EAT — three hours late — which directly skews the "anza kutengeneza"
(start baking now) reminder timing, a flagship feature.
**Fix:** either set `TZ=Africa/Dar_es_Salaam` on the process explicitly, or better,
construct the deadline with an explicit offset (`${isoDate}T17:00:00+03:00`) so it's
correct regardless of the host's timezone.

### E2. `mauzo_ya_leo` and `riport_dashboard` compute "today" in JS, not SQL
```js
const today = localDateKey(new Date());
... WHERE tarehe = $1 ...
```
`tarehe` was stored using Postgres's `CURRENT_DATE`; "today" here is computed from the
Node process's local clock. If these ever diverge from Tanzania's calendar day (e.g.
sales made 00:00–03:00 EAT), sales can be attributed to the wrong business day and
silently disappear from "today's" totals.
**Fix:** replace the JS-computed date with a query that uses `CURRENT_DATE` directly
(`WHERE tarehe = CURRENT_DATE`), same pattern as the ticket engine, and ensure the
Postgres session timezone is set to `Africa/Dar_es_Salaam` (or store/compare using UTC
consistently — pick one source of truth and apply it everywhere).

---

## F. Reminder engine lifecycle

### F1. Reminders are single-fire per key, forever
```sql
ON CONFLICT (aina, lengo, COALESCE(agizo_id, 0), COALESCE(malighafi_id, 0)) DO NOTHING
```
Once a reminder for a given (type, role, order/ingredient) combination has been created
and later marked read (`imesomwa = true`), nothing ever deletes the row or resets the
flag — so every future `generateUkumbusho()` run hits `DO NOTHING` and that exact alert
can never fire again, even if the underlying problem persists or recurs (e.g. an
ingredient stays below threshold indefinitely after the first alert is dismissed).
**Fix:** two options, pick based on desired behavior:
- (a) Change the upsert to `DO UPDATE SET ujumbe = EXCLUDED.ujumbe, imesomwa = false,
  tarehe_ya_utekelezaji = EXCLUDED.tarehe_ya_utekelezaji` so a still-relevant condition
  re-surfaces with fresh content instead of being permanently suppressed.
- (b) Add a cleanup step that deletes/archives reminder rows once their underlying
  condition resolves (order reaches `ready`/`collected`, or ingredient stock rises above
  threshold), so stale reminders don't linger and the dedupe key becomes reusable
  naturally.
(a) is the smaller, safer change; (b) is more correct long-term. Do (a) now, note (b) as
a follow-up.

---

## G. Dead / misleading permission-check code

### G1. `requireCan(...) || requireCan(...)` doesn't do what it looks like
Appears in three places in `src/graphql/resolvers.js`: the `marekebisho_hisa` query,
`utabiri_hisa` query, and `tengeneza_ukumbusho` mutation. `requireCan` throws on
failure rather than returning `false`, so `||` never actually falls through — if the
first permission is missing, it throws before the second is ever checked. In effect
only the *first-listed* permission is the real gate; the `if (!can(...) && !can(...))`
block written immediately after is unreachable dead code. It happens to work today only
because the roles currently calling these endpoints hold that first permission too.
**Fix:** replace each pair with a plain boolean check and a single explicit throw, e.g.:
```js
if (!can(ctx.user, 'usage.read_all') && !can(ctx.user, 'stock.adjust_restock')
    && !can(ctx.user, 'stock.adjust_waste')) {
  throw new GraphQLError('Hamna ruhusa ya kuona marekebisho.', { extensions: { code: 'FORBIDDEN' } });
}
```
Do this for all three call sites; delete the now-truly-dead follow-up `if` blocks.

---

## H. Frontend/backend contract gap (fix on the backend side; note for new frontend)

### H1. `MAUZO_YA_LEO` query is missing `created_at`
`Mauzo` has a `created_at: DateTime` field and it's resolved correctly elsewhere, but
`web/src/graphql/queries.js`'s `MAUZO_YA_LEO` only selects `tarehe` (a date-only scalar,
no time component). Any UI reading `sale.created_at` for a receipt timestamp will always
get `undefined` and fall back to midnight.
**Fix:** add `created_at` to the `MAUZO_YA_LEO` selection set (and to `MAUZO` for
consistency). No resolver change needed — the field already exists. Flag this for
whoever builds the new frontend so the receipts list actually shows sale time.

---

## I. Schema design smell (lower priority, note for next migration)

### I1. `muda_wa_kazi` uses one `UNIQUE` column for two different concepts
`getPrepTime` looks up prep time by `ukubwa` (size) first, then falls back to `ladha`
(flavor) — both against the same `ukubwa VARCHAR(50) UNIQUE` column. Works today because
no size and flavor happen to share a name, but it's a landmine: adding a size called
"Chocolate" or a flavor called "Large" will silently collide via the unique constraint
and overwrite the other row's prep time.
**Fix (next migration, not urgent):** split into two explicit lookup tables/columns —
`muda_kwa_ukubwa` and `muda_kwa_ladha` — or add a `aina_ya_ufunguo` discriminator column
included in the uniqueness constraint (`UNIQUE (aina_ya_ufunguo, thamani)`).

---

## J. Deployment & operational readiness (found in the follow-up pass)

### J1. `setInterval`-based reminder generation doesn't fit a serverless target
`src/reminders/engine.js` registers a module-level
`setInterval(..., 5 * 60 * 1000)` that assumes a long-running Node process. That's
correct for the "runs on the shop's own computer" model described in the README, but
if the API is ever deployed as a serverless function (the demo already runs the
frontend on Vercel), this breaks: a cold instance may be torn down before the interval
ever fires, and a warm instance reused across invocations can end up with duplicate
timers registered.
**Fix:** confirm which deployment target you're polishing for. If it's ever going to be
serverless, replace the interval with an externally-triggered job — a scheduled cron
hitting a dedicated route (or reusing the existing `tengeneza_ukumbusho` mutation) —
instead of an in-process timer. If it's always the "shop's own PC" model, this is
already fine as-is.

### J2. `/health` doesn't check the database
```js
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```
Returns "ok" unconditionally — it never verifies Postgres connectivity. Any process
supervisor or uptime monitor watching this endpoint would report healthy even while the
database is unreachable.
**Fix:** have it run a lightweight `SELECT 1` against the pool (with a short timeout)
and return a non-200 / `"degraded"` status if that fails.

### J3. No fail-fast validation for required env vars at boot
Beyond `JWT_SECRET` (A4), `DATABASE_URL` is never validated either — if it's missing,
`pg`'s `Pool` silently falls back to `PG*` env vars or defaults and only fails on the
first real query, producing a confusing runtime error instead of a clear one at startup.
**Fix:** check `DATABASE_URL` and `JWT_SECRET` are both set before calling
`httpServer.listen`, and exit with a clear message naming the missing var if not.

### J4. Owner-account recovery on redeploy is fragile and not shop-visible
`src/db/bootstrap.js`'s `ensureOwner()` re-run check
(`WHERE id = 1 AND jukumu = 'owner'`) only recreates an owner account when that exact
row/role combination is missing — e.g. after a B3-style role-demotion incident. When it
does fire and `CAKE_OWNER_PIN` isn't set in the environment at that point, it generates
a random PIN and only `console.log`s it, which on a serverless host lands in
developer-only deployment logs — invisible to the actual shop owner, who'd be locked
out with no way to see the new PIN.
**Fix:** fixing B3 makes this path rare, but you still want a real recovery story —
either document a manual DB/CLI recovery step, or build a small authenticated
"break-glass" CLI command an operator can run, rather than relying on a console log the
shop can't reach.

### J5. Unhandled errors can leak raw, non-Kiswahili messages
Every deliberate `GraphQLError` throw in the codebase is correctly in Kiswahili, which
matches the product's "Kiswahili kizima" pledge. But anything not explicitly caught — a
Postgres constraint violation, an unexpected driver error, a bug — passes through
Apollo's default error formatting untouched: in English, and potentially with internal
detail attached. Apollo Server 4's stack-trace inclusion is tied to `NODE_ENV`, which
this codebase never validates is actually set to `production` wherever it deploys.
**Fix:** add a `formatError` function to the `ApolloServer` config in `src/server.js`
that passes your own `GraphQLError`s through unchanged, maps everything else to a
generic Kiswahili message ("Hitilafu isiyotarajiwa imetokea. Jaribu tena.") while
logging the real error server-side, and confirm `NODE_ENV=production` is actually set
in whatever environment this runs in.

---

## K. Minor polish (low priority, quick wins)

### K1. Inconsistent error code on login failure
`login` throws with `code: 'UNAUTHORIZED'`; every other "not logged in" case in the
codebase uses `UNAUTHENTICATED`, reserving `FORBIDDEN` for "logged in but not allowed."
Align it for consistency — purely cosmetic, but cheap to fix while you're in this file.

### K2. `hisa.asilimia_iliyotumika` is a permanent stub
Always resolves to `null` — intentional (it ties to the spec's deferred P2
recipe-costing feature) but nothing in the schema marks it as unimplemented.
**Fix:** either add a schema description noting it's not yet implemented, or drop the
field until it's real, so whoever builds the new frontend doesn't design a UI around a
value that will never populate.

### K3. Field resolvers are all one-query-per-row (N+1), and that's fine
`Mauzo.mfanyakazi`, `AgizoMaalum.mteja`, `KumbukumbuMatumizi.*`, `Tikiti.mauzo`/`agizo`,
`AgizoMaalum.muda_hitajika`, etc. each issue a separate query per row rather than
batching. At this shop's realistic data volume (tens of rows per query, one shop) this
is a non-issue and not worth spending time on before launch — noting it here only so
it's a documented, deliberate tradeoff rather than something that got missed.

---

## Suggested execution order

1. **B1–B4, D1** — state-machine and dashboard-accuracy fixes; these produce visibly
   wrong data/behavior today and are self-contained.
2. **C1–C3** — add the validation and constraints before anything else depends on
   "trusted" stock/money numbers.
3. **G1** — quick, mechanical, low-risk cleanup.
4. **E1–E2** — timezone fixes; test carefully around midnight EAT since these are easy
   to "fix" incorrectly without a real test against the actual business day boundary.
5. **F1** — reminder upsert change.
6. **H1, I1** — frontend contract note + schema follow-up, can happen alongside the
   frontend rebuild.
7. **J1–J5** — deployment/operational hardening; do these right before you actually ship
   (J1 in particular depends on knowing the final hosting target).
8. **K1–K3** — quick, low-risk cleanup, fold in wherever convenient.
9. **A1–A5** — security hardening, already scoped separately.

For each item, add or update a test (or at minimum a manual repro script) that exercises
the specific broken path described above, so the fix is verifiable and doesn't regress.

---

## What was implemented

| Item | Where | Notes |
| --- | --- | --- |
| A1 | `src/auth/loginAttempts.js`, `login` resolver | 5 failures / 15 min locks the account **and** the source IP. Always runs a bcrypt compare so response timing can't enumerate staff IDs. |
| A2 | `src/server.js` | Explicit origin allowlist. `CORS_ORIGINS=*` restores the old open behaviour. |
| A3 | `src/db/pool.js` | `rejectUnauthorized: true` by default; opt out only with `DB_INSECURE_TLS=true`, which warns loudly. |
| A4 / J3 | `src/server.js` | Boot fails fast, naming the missing `DATABASE_URL` / `JWT_SECRET`. |
| B1 | `chukua_agizo`, `chukua_tikiti` | Refuse to resurrect a cancelled record; companion updates now skip `collected` **and** `cancelled`. |
| B2 | `futa_tikiti` | Cascade-cancels the linked order in one transaction. |
| B3 | `hariri_mfanyakazi` | Blocks demoting the last active owner. |
| B4 | `src/server.js` context | `mtumiaji.active` re-checked on every authenticated request. |
| C1–C3 | `migrations/001`, resolvers | CHECK constraints (`NOT VALID` → `VALIDATE` so live rows aren't locked), Kiswahili `BAD_REQUEST` validation, and `SELECT … FOR UPDATE` to close the stock race. |
| D1 | `riport_dashboard` | Balance list and money-owed total exclude cancelled orders. |
| E1 | `src/lib/dates.js`, reminder engine | Pickup deadlines use an explicit `+03:00`; a UTC host no longer fires reminders 3h late. |
| E2 | resolvers, `src/db/pool.js` | `CURRENT_DATE` in SQL, `Africa/Dar_es_Salaam` session timezone, 7-day axis via `generate_series`. |
| F1 | `migrations/002`, reminder engine | Upsert re-arms on changed content or after 4h, instead of `DO NOTHING` forever. |
| G1 | 3 resolvers, `src/auth/permissions.js` | Dead `requireCan \|\|` chains replaced with real boolean checks; new `requireAuthenticated()` documents why `requireCan` must not be chained. |
| H1 | `web/src/graphql/queries.js` | `created_at` added to `MAUZO_YA_LEO` and the dashboard's sales list. |
| J1 | reminder engine | Timer `unref()`d (it was pinning the event loop open) and skippable via `DISABLE_REMINDER_TIMER`. |
| J2 | `src/server.js` | `/health` runs `SELECT 1`, returns 503 `degraded` when Postgres is unreachable. |
| J4 | `src/db/bootstrap.js` | Generated owner PIN is written to `OWNER-PIN.txt` (0600, gitignored) instead of only a log line. |
| J5 | `src/server.js` | `formatError` strips stack traces and replaces unexpected errors with generic Kiswahili. |
| K1 | `login` resolver | Now `UNAUTHENTICATED`, consistent with the rest of the codebase. |
| K2 | `src/graphql/typeDefs.js` | `asilimia_iliyotumika` documented as NOT YET IMPLEMENTED. |

New infrastructure: `migrations/` + `src/db/migrate.js` (numbered, transactional,
idempotent, applied at boot), `src/lib/dates.js` (EAT-pinned date helpers, replacing two
divergent copies of `localDateKey`), and `scripts/verify-fixes.js` (`npm run verify`).

## Still open

- **A5 — JWT in `localStorage`.** Not done: it is a frontend-auth rewrite and the
  work order itself ranks it as not urgent once A1–A2 are fixed, which they now are.
  Revisit when the frontend is rebuilt.
- **I1 — `muda_wa_kazi` unique column carries two concepts** (size and flavor in one
  `ukubwa` column). Deliberately deferred: the fix needs a real data migration to split
  the lookup, which is riskier than the rest of this batch. Do it as its own migration
  when the recipe/prep-time feature is next touched — the `migrations/` runner is now in
  place for it.
- **K3 — N+1 field resolvers.** Intentionally left as-is; documented in code as a
  deliberate tradeoff at this shop's data volume, not an oversight.

## Notes for whoever picks this up

- Run `npm start`, then `npm run verify` in a second terminal. The lockout test runs last
  on purpose because it deliberately locks the calling IP out for 15 minutes — restart the
  API before re-running.
- `npm run db:migrate` applies pending migrations without booting the server.
- Migrations are applied on boot, so a fresh install picks up the CHECK constraints too.
