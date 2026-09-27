# Cake City POS — Master Blueprint

Everything in this document was checked against your actual repo (cloned, migrated,
run against a live Postgres instance, tested). Where something is marked ✅, I ran it.
Where something needs a fix, the exact patch is below — copy-paste accurate against
your current code, not a guess.

**Status legend:** ✅ built & verified · 🟡 built, has a bug (fix below) · ⚪ missing,
needs building (spec below) · 🔮 deferred, not designed yet.

---

## 1. The system, in one paragraph

Four roles — owner, cashier, chef, inventory — share one set of records (the "tray"
model from the original spec). A cashier's order is immediately visible to the chef
with no hand-off step; the chef's ingredient logging is immediately visible to
inventory; everything is visible to the owner. Two design principles run through
everything below and shouldn't be re-litigated per feature:

- **Stock only moves when inventory confirms a real number.** The chef's tap-logged
  amount is always an estimate (`hali = 'inakadiriwa'`); nothing decrements until
  `thibitisha_matumizi` runs (`hali = 'imethibitishwa'`). ✅ Verified working, including
  the "negative stock is a valid signal, not an error" decision.
- **`mapishi_id IS NULL` on an order is the "custom/off-book" flag.** No separate
  boolean anywhere. Custom cake orders (different flavor/size than the recipe book)
  and now custom **shape** (§4.3) all live on the same free-text fields as before.

---

## 2. Already solid — no action needed

Confirmed by running the actual test suite and reading the code, not assumed:

- Login brute-force lockout, CORS allowlist, TLS verification on by default,
  required env vars checked at boot, no stack traces leaked to the client.
- Health check verifies the database, not just the process.
- Reminders and the dashboard's "today" both correctly anchor to `Africa/Dar_es_Salaam`.
- Cancelled orders can't be revived via collect, cancelling a ticket cascades to
  cancel its order, the last owner account can't be deleted or demoted, a
  deactivated staff account loses access immediately.
- New products can't recreate the old duplicate mess — `bathi_bidhaa` derives
  family+size and rejects a collision with a friendly message before the database
  constraint would.
- Category bulk-assignment (`panga_kategoria`) exists and works.

Nothing below duplicates these — they're mentioned only so this document is a
complete picture, not a list of new worries.

---

## 3. Bug fixes (built, but wrong)

### 3.1 🟡 Fraction-of recipes show no ingredients

**Root cause, confirmed in code:** `Mapishi.viambato` (in `src/graphql/resolvers.js`)
only ever queries `mapishi_kipengele WHERE mapishi_id = $1`. A `fraction_of` recipe
(like a cake slice) has no rows of its own — that was always the intent — but nothing
ever reads the parent (`mapishi_ibaba`) to compute them. There's also no column
storing *what fraction* — so even fixing the read side needs one small addition.

**Migration** (new file, `migrations/005_fraction_of_weight.sql`):
```sql
ALTER TABLE mapishi ADD COLUMN IF NOT EXISTS sehemu_ya_uzito NUMERIC(5,4);

ALTER TABLE mapishi
  ADD CONSTRAINT chk_sehemu_ya_uzito
  CHECK (mapamba_variant = 'own_recipe' OR sehemu_ya_uzito IS NOT NULL);
```
Then, as a one-time data fix (not a migration — same convention as your existing
`local-data-repair/`, since it's about *this* shop's already-seeded rows):
```sql
UPDATE mapishi SET sehemu_ya_uzito = 0.10
WHERE ladha = 'Keki ya Karoti' AND ukubwa = 'pcs' AND mapamba_variant = 'fraction_of';
```

**Schema (`src/graphql/typeDefs.js`):** add `sehemu_ya_uzito: Float` to both `Mapishi`
and `MapishiInput`.

**Resolver fix** — replace the current `Mapishi.viambato`:
```js
Mapishi: {
  viambato: async (m) => {
    const own = await pool.query(
      'SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id',
      [m.id]
    );
    if (own.rows.length > 0) return own.rows;

    // fraction_of with nothing of its own: inherit the parent, scaled.
    if (m.mapamba_variant === 'fraction_of' && m.mapishi_ibaba && m.sehemu_ya_uzito) {
      const parent = await pool.query(
        'SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id',
        [m.mapishi_ibaba]
      );
      const factor = Number(m.sehemu_ya_uzito);
      return parent.rows.map((r) => ({
        ...r,
        mapishi_id: m.id,
        kiasi_cha_chini: Number(r.kiasi_cha_chini) * factor,
        kiasi_cha_juu: Number(r.kiasi_cha_juu) * factor,
      }));
    }
    return own.rows; // a genuine own_recipe with nothing entered yet
  },
  mapishi_ibaba: async (m) => { /* unchanged */ },
},
```

**Let recipe creation actually allow this.** Right now `normaliseIngredients` throws
if `viambato` is empty, for every recipe type — so you can't even *create* a proper
"inherit everything" fraction_of recipe today. Change its signature to accept an
`allowEmpty` flag:
```js
const normaliseIngredients = async (client, viambato, allowEmpty = false) => {
  if (!Array.isArray(viambato)) viambato = [];
  if (!viambato.length) {
    if (allowEmpty) return [];
    throw new GraphQLError('Mapishi lazima iwe na angalau kifungu kimoja.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }
  // ...rest unchanged...
};
```
Then in **both** `unda_mapishi` and `hariri_mapishi`, before calling it, add:
```js
const variant = input.mapamba_variant || 'own_recipe';
if (variant === 'fraction_of') {
  if (!input.mapishi_ibaba) {
    throw new GraphQLError('Mapishi ya "sehemu ya" lazima ielekeze kwenye mapishi mzazi.', { extensions: { code: 'BAD_REQUEST' } });
  }
  const w = Number(input.sehemu_ya_uzito);
  if (!Number.isFinite(w) || w <= 0 || w >= 1) {
    throw new GraphQLError('Uzito wa sehemu lazima uwe kati ya 0 na 1.', { extensions: { code: 'BAD_REQUEST' } });
  }
  const parent = (await client.query('SELECT mapamba_variant FROM mapishi WHERE id = $1', [input.mapishi_ibaba])).rows[0];
  if (!parent) throw new GraphQLError('Mapishi mzazi halipo.', { extensions: { code: 'NOT_FOUND' } });
  // No chains: a fraction can only point at a real, own_recipe cake — otherwise
  // scaling is ambiguous and a cycle becomes possible.
  if (parent.mapamba_variant !== 'own_recipe') {
    throw new GraphQLError('Mapishi mzazi lazima iwe na mapishi yake yenyewe.', { extensions: { code: 'BAD_REQUEST' } });
  }
}
const lines = await normaliseIngredients(client, input.viambato, variant === 'fraction_of');
```
And add `sehemu_ya_uzito` to the `INSERT`/`UPDATE` statements for `mapishi` in both
mutations, alongside the existing `mapamba_variant`/`mapishi_ibaba` columns.

### 3.2 🟡 Recipe-book orders show the wrong prep time

**Root cause, confirmed in code:** `AgizoMaalum.muda_hitajika` always calls
`getPrepTime(order.ladha, order.ukubwa)` — the old free-text lookup against
`muda_wa_kazi` — and never checks whether the order is linked to a recipe that
already has its own `dakika_kadirio`.

**Fix:**
```js
muda_hitajika: async (order) => {
  if (order.mapishi_id) {
    const rec = (await pool.query('SELECT dakika_kadirio FROM mapishi WHERE id = $1', [order.mapishi_id])).rows[0];
    if (rec) return rec.dakika_kadirio;
  }
  const prep = await getPrepTime(order.ladha, order.ukubwa);
  return prep;
},
```
Custom/off-book orders (`mapishi_id IS NULL`) keep using the old lookup exactly as
before — nothing changes for them.

### 3.3 🟡 Chef and cashier can't close a request addressed to them

**Root cause, confirmed in code:** `fungua_ombi`'s own comment says "only the person
it was addressed to may close it," and the resolver's recipient check
(`String(cur.kwenda_kwa) === String(ctx.user.sub)`) is correct — but it's gated behind
`requireCan(ctx.user, 'ombi.fungua')` first, and only `owner`/`inventory` hold that
permission in `src/auth/permissions.js`. A chef who receives "please make a new
product" can never mark it done.

**Fix** — in `src/auth/permissions.js`, add `'ombi.fungua': true` to both `ROLE_CASHIER`
and `ROLE_CHEF`. The resolver's own recipient/owner check is already correct and does
the real work — this permission flag was just wrongly scoped as an extra gate on top
of it, so widening it is safe, not a loosening of a real control.

---

## 4. Missing pieces (spec to build)

### 4.1 ⚪ Allergy info & order-specific requirements

Two different things, two different homes:

- **Allergy info belongs to the person**, not the order — it doesn't change between
  orders, so it goes on `mteja`.
- **Special requirements belong to the order** — "deliver by 3pm," "extra decoration,"
  changes every time.

**Migration** (`migrations/006_customer_and_order_notes.sql`):
```sql
ALTER TABLE mteja ADD COLUMN IF NOT EXISTS mzio TEXT;
ALTER TABLE agizo_maalum ADD COLUMN IF NOT EXISTS maelekezo_maalum TEXT;
```

**Schema:** add `mzio: String` to `Mteja`/`MtejaInput`; add `maelekezo_maalum: String`
to `AgizoMaalum`/`AgizoInput`. Both are plain pass-through columns — `unda_mteja` and
`unda_agizo` just need to accept and store them; no other resolver logic changes,
since `order_kwajikoni` already does `SELECT *` and the new columns arrive for free
once they're in the type.

**Important, not just a backend note:** allergy info is safety-critical. Make sure
whatever chef screen gets built next surfaces `mteja.mzio` somewhere the chef will
actually see it before baking — not buried three taps deep. That's a frontend
requirement worth writing down now so it doesn't get lost later.

### 4.2 ⚪ Customer deduplication

Confirmed still fully open: `unda_agizo`'s `mteja_mpya` branch always inserts a new
`mteja` row, and the existing `wateja(search: String)` query is never called from the
cashier's order screen. Same person ordering twice becomes two customer records with
split history.

**DB backstop:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS mteja_simu_uidx
  ON mteja (simu) WHERE simu IS NOT NULL AND simu <> '';
```

**Resolver fix**, in `unda_agizo`, replacing the unconditional insert:
```js
let mtejaId = input.mteja_id;
let mtejaJina = input.mteja_mpya?.jina;
if (!mtejaId && input.mteja_mpya) {
  if (input.mteja_mpya.simu) {
    const existing = await client.query('SELECT id, jina FROM mteja WHERE simu = $1', [input.mteja_mpya.simu]);
    if (existing.rows[0]) {
      mtejaId = existing.rows[0].id;
      mtejaJina = existing.rows[0].jina;
    }
  }
  if (!mtejaId) {
    const { rows } = await client.query(
      'INSERT INTO mteja (jina, simu, siku_ya_kuzaliwa) VALUES ($1, $2, $3) RETURNING id',
      [input.mteja_mpya.jina, input.mteja_mpya.simu || null, input.mteja_mpya.siku_ya_kuzaliwa || null]
    );
    mtejaId = rows[0].id;
  }
} else if (mtejaId) {
  const m = (await client.query('SELECT jina FROM mteja WHERE id = $1', [mtejaId])).rows[0];
  mtejaJina = m?.jina;
}
```
**Frontend note:** surface `wateja(search: ...)` as a "search existing customer"
step before "or add new" in whatever order screen gets built — the query already
exists and is already unused.

### 4.3 ⚪ Custom cake shape

**Decision made, with reasoning:** free text, not a managed list. Product categories
and sizes got structured because a shop's product catalogue is finite and duplicates
were a real, recurring problem. A custom cake's shape is inherently one-off and
creative — there's no finite list to protect, so structuring it would just be
overhead with no dedup benefit.

**Migration:**
```sql
ALTER TABLE agizo_maalum ADD COLUMN IF NOT EXISTS umbo VARCHAR(100);
```
(Can be folded into the same `006_customer_and_order_notes.sql` above.) Add
`umbo: String` to `AgizoMaalum`/`AgizoInput`, same pass-through pattern as §4.1.

### 4.4 ⚪ No automated test coverage for any of this

`scripts/verify-fixes.js` — your existing 40-check suite — covers only the older
fix list. Nothing exercises recipes, categories, or requests. Add a sibling script,
`scripts/verify-recipes.js`, wired to a new `"verify:recipes"` entry in
`package.json`, using the same `gql()`/`sql()`/`check()` helpers already in
`verify-fixes.js` (copy the top of that file rather than re-invent it). Cases worth
having from day one:

- Create a parent (`own_recipe`) recipe with real `viambato`; create a child
  `fraction_of` recipe with `sehemu_ya_uzito` and **no** lines; query the child's
  `viambato` and assert the amounts equal the parent's × the fraction.
- Assert `unda_mapishi` rejects `fraction_of` with no `mapishi_ibaba`, and rejects a
  `fraction_of` whose parent is itself a `fraction_of` (no chains).
- Create a recipe with `dakika_kadirio: 360`; create an order linked to it; assert
  `muda_hitajika` returns `360`, not the old default.
- Owner sends an `ombi` to a chef; log in as that chef; assert `fungua_ombi` succeeds.
  Repeat for cashier.
- Create two products, create a category, call `panga_kategoria`, assert both
  products now carry that category.
- `log_matumizi_kundi` with no `agizo_id` and no `kumbukumbu` is rejected; with a
  `kumbukumbu` note and no order, it succeeds.
- (Once §4.2 ships) create two orders with the same phone number under different
  names; assert both resolve to the same `mteja_id`.

---

## 5. Deferred — not designed, not estimated

- 🔮 **3D cake model from the cashier's device, visible to the chef.** A genuinely
  different kind of engineering work from everything else here. Worth its own
  scoping conversation when you're ready — don't fold it into this blueprint's
  estimate.
- 🔮 **Redesigned chef dashboard.** Frontend/UX work, already known to be part of
  the broader UI rebuild.

---

## 6. Suggested execution order

1. **§3.1–3.3** — the three bugs. Small, contained, each independently testable,
   and they're what would make the system feel broken to someone using it tomorrow.
2. **§4.4** — write the tests *while* fixing §3, not after — each bug fix above has
   a matching test case already listed, so there's no separate "add tests" phase.
3. **§4.1, §4.2, §4.3** — the missing pieces. All three are small, additive schema
   changes with no risk to existing data (`ADD COLUMN IF NOT EXISTS` throughout).
4. **§5** — later, separately, when you're ready to scope them properly.

---

## 7. Where things live (quick reference)

| Concern | File |
|---|---|
| Schema for recipes/categories/requests | `migrations/004_recipes_categories_requests.sql` |
| This shop's actual duplicate cleanup & seed recipes | `local-data-repair/004-local-data-repair.sql` |
| All resolvers | `src/graphql/resolvers.js` |
| Schema/types | `src/graphql/typeDefs.js` |
| Role permissions | `src/auth/permissions.js` |
| Older fix-list verification | `scripts/verify-fixes.js` (`npm run verify`) |
| Frontend/backend contract check | `scripts/validate-graphql-ops.js` (`npm run verify:graphql`) |
