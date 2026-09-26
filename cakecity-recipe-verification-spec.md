# CakeCity POS — Recipes, Tap Logging, Categories & Owner↔Inventory Requests

**Status:** v2 plan. Supersedes the v1 draft of this file.
**Reconciled against actual code on 2026-09-26** (commit `3a2ff04`). All table/column
names below were verified against the live schema, not assumed.

---

## 0. Locked decisions

Agreed in discussion. These are settled — do not re-litigate during implementation.

| # | Decision |
|---|---|
| D1 | **Chef gets the tap logging system from day one.** Not deferred to a later phase. |
| D2 | **Recipes exist only for custom cake orders.** A custom order opens with a suggested ingredient list pre-filled from its recipe. |
| D3 | **Regular shop products have no recipe.** Chef taps the ingredients he used, and writes a short free-text note of what he made — e.g. `20 mandazi`, `batch of biskuti`. |
| D4 | **A usage log may have no order attached.** The note is the only description of what the ingredients were for. |
| D5 | **Stock decrements only when inventory confirms the real number.** Never at the moment the chef logs. |
| D6 | **Counter sales never touch stock automatically.** Deliberate, not an oversight. |
| D7 | **Product identity is `familia` + `ukubwa` (size)**, with a uniqueness constraint. Separate concern from recipes; applies to shop products. |
| D8 | **Duplicate products are resolved two ways:** either they are genuinely different sizes (keep both, restructure) or one is deactivated. |
| D9 | **Products get real, managed categories** — a proper list (Cakes / Bread / Snacks) instead of free-text `aina`. |
| D10 | **Bulk actions on products** — select many, assign category, in one action. |
| D11 | **Sales reports group by category** (falls out of D9 once categories are real). |
| D12 | **Owner ↔ inventory requests** are human-to-human, distinct from automated reminders, surfaced in the same notification bell. **Whoever received the request clears it.** |

### Why D3/D4 matter

A custom order already has a name and an order number, so its usage logs are
self-describing. A regular batch has neither. The note carries that context, and
it is the only thing that will tell anyone six months later why 4 kg of flour was
deducted on a Tuesday.

This closes the D6 gap for the shop's bulk production. Walk-in sales still don't
write usage, but *batch baking* does — which is where the majority of the flour,
sugar and butter actually goes.

---

## 1. Data model

### 1.1 `bidhaa`: structured family + size (D7)

The size is currently trapped inside the free-text `jina` — which is *why* the
duplicates exist. Verified duplicates in the live data:

```
keki ya chokoleti (dira 20)   ids 5,19    same size, same price
keki ya vanila (dira 20)      ids 6,20    same size, same price
keki ya matunda (dira 24)     ids 7,21    same size, same price
keki ya harusi (safu 3)       ids 8,23    same size, same price
mandazi (pcs)                 ids 16,34   same size, same price
biskuti za chokoleti (pcs)    ids 10,28   ** PRICE CONFLICT: 500 vs 800 **
mkate wa nazi                ids 12,30   same size, same price
```

Plus a naming inconsistency that produces duplicates nobody would catch by eye:

```
Cupcake la Chokoleti  ==  Cupcake ya Chokoleti     (both 1200)
Cupcake la Vanila     ==  Cupcake ya Vanila        (both 1100)
```

`la` and `ya` are both valid Swahili for "of", so no amount of careful typing
prevents this. Structure prevents it.

```sql
ALTER TABLE bidhaa
  ADD COLUMN familia VARCHAR(200),
  ADD COLUMN ukubwa    VARCHAR(50);

-- Backfill by parsing the existing free-text jina, then enforce.
CREATE UNIQUE INDEX bidhaa_familia_ukubwa_uidx
  ON bidhaa (LOWER(familia), LOWER(ukubwa)) WHERE active = true;
```

One constraint kills both the duplicates and the naming variants.

### 1.2 Recipe scale is not linear — read before authoring recipes

Each size needs its own weighed recipe. **A dira 24 is not 1.2× a dira 20** —
pan depth, baking time and structure all change, and linear scaling produces a
cake that fails in the middle.

There is one legitimate exception: **a portion of the same cake.** A slice is
literally cut from the whole. The live data has exactly one such case:

```
Keki ya Karoti (dira 18)  ->  TSh 35,000
Keki ya Karoti (pcs)       ->  TSh 3,500      (exactly 1/10)
```

So the model distinguishes two variant relationships:

- **`own_recipe`** — a different size. Authored and weighed separately.
- **`fraction_of`** — a portion of one cake. Computed from the parent + cutting loss.

```sql
ALTER TABLE mapishi ADD COLUMN mapamba_variant VARCHAR(20) DEFAULT 'own_recipe';
ALTER TABLE mapishi ADD COLUMN mapishi_ibaba  INTEGER REFERENCES mapishi(id);
```

### 1.3 `mapishi` — custom cake orders only (D2)

```sql
CREATE TABLE mapishi (
  id SERIAL PRIMARY KEY,
  ladha VARCHAR(200) NOT NULL,
  ukubwa VARCHAR(50)  NOT NULL,
  dakika_kadirio INTEGER NOT NULL DEFAULT 90,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  mapamba_variant VARCHAR(20) DEFAULT 'own_recipe',
  mapishi_ibaba INTEGER REFERENCES mapishi(id),
  UNIQUE (ladha, ukubwa)
);
```

`dakika_kadirio` here also retires the fragile free-text size lookup for anything
ordered from the book. **Correction to the v1 draft:** `muda_wa_kazi` is a lookup
*table* (`muda_wa_kazi(ukubwa, dakika)`), not a column, and it is matched by
`LOWER(ukubwa)` in `src/reminders/engine.js:19`. Keep it as the fallback for
custom/off-book orders.

`DEFAULT 90` is a placeholder, not a sensible default — cupcakes are ~25 min and
a 3-tier wedding cake is hours. Author every value.

### 1.4 `mapishi_kipengele` — and the unit problem

```sql
CREATE TABLE mapishi_kipengele (
  id SERIAL PRIMARY KEY,
  mapishi_id INTEGER NOT NULL REFERENCES mapishi(id) ON DELETE CASCADE,
  malighafi_id INTEGER NOT NULL REFERENCES malighafi(id),
  kiasi_cha_chini NUMERIC(10,2) NOT NULL,
  kiasi_cha_juu NUMERIC(10,2) NOT NULL,
  CHECK (kiasi_cha_juu >= kiasi_cha_chini),
  UNIQUE (mapishi_id, malighafi_id)
);
```

Three unresolved problems with the above:

1. **No unit column.** Quantities are bare `NUMERIC` — kg? g? pcs? Quantities are
   stored in the material's canonical unit and the unit is *documented by
   convention*, not enforced by the schema. Fix the unit master first (§5).
2. **`UNIQUE (mapishi_id, malighafi_id)` forbids the same ingredient twice in one
   recipe.** Real cakes use flour in the sponge *and* in the frosting. Either drop
   the constraint or add a component column (`sponge` / `frosting` / `filling`).
3. **No yield field.** A cupcake recipe yields 12; the sellable unit is per-piece.
   "This makes N" does not exist anywhere, so the tap flow is undefined for
   anything that isn't one whole cake.

The range is a **suggestion for the tap UI**, not a constraint. The chef can log
outside it, or add an ingredient that isn't in the recipe at all (D3).

### 1.5 Two-phase usage — estimate, then confirm (D5)

```sql
CREATE TYPE hali_uthibitisho_matumizi AS ENUM ('inakadiriwa', 'imethibitishwa');

ALTER TABLE kumbukumbu_matumizi
  ADD COLUMN hali hali_uthibitisho_matumizi NOT NULL DEFAULT 'inakadiriwa',
  ADD COLUMN kiasi_halisi NUMERIC(10,2),
  ADD COLUMN imethibitishwa_na INTEGER REFERENCES mtumiaji(id),
  ADD COLUMN tarehe_ya_uthibitisho TIMESTAMP;
```

`kiasi` keeps its current meaning — the chef's estimate, possibly mid-range.
`kiasi_halisi` stays NULL until inventory verifies.

**Good news, verified:** `kumbukumbu_matumizi.agizo_id` is **already nullable**.

```
kumbukumbu_matumizi.agizo_id  ->  integer  nullable
```

D4 therefore needs **no migration**. Only the GraphQL layer blocks it:
`MatumiziInput` declares `agizo_id: ID!` and the resolver rejects unknown orders.
Relax the input, add a note column, and order-less batch logging works on the
existing tables.

### 1.6 Stock trigger — decrement moves from insert to verification

```sql
DROP TRIGGER trigger_usage_decrement_stock ON kumbukumbu_matumizi;

CREATE OR REPLACE FUNCTION update_stock_from_verified_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.hali = 'imethibitishwa' AND OLD.hali = 'inakadiriwa' THEN
    UPDATE malighafi
    SET kiasi_kilichopo = kiasi_kilichopo - NEW.kiasi_halisi
    WHERE id = NEW.malighafi_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usage_decrement_on_verify
  AFTER UPDATE ON kumbukumbu_matumizi
  FOR EACH ROW EXECUTE FUNCTION update_stock_from_verified_usage();
```

The guard makes it idempotent — only the one `inakadiriwa → imethibitishwa`
transition fires it. Note the trigger is `AFTER UPDATE` only: a row inserted
directly as `imethibitishwa` would not decrement. All resolvers insert as
`inakadiriwa`, so this is a non-issue today, but constrain it.

### 1.7 Migration trap — do not double-decrement

Every existing row already had its stock applied at insert time under the old
trigger. Backfill the new columns as already-settled **before** creating the new
trigger:

```sql
UPDATE kumbukumbu_matumizi
SET hali = 'imethibitishwa',
    kiasi_halisi = kiasi,
    tarehe_ya_uthibitisho = tarehe
WHERE hali = 'inakadiriwa';
```

Run before `trigger_usage_decrement_on_verify` exists, or wrap in
`ALTER TABLE kumbukumbu_matumizi DISABLE TRIGGER ... ENABLE TRIGGER`. Getting this
wrong silently subtracts every historical log from stock a second time.

### 1.8 Categories (D9) and the `aina` problem

`aina` is free text. Verified miscategorisation — 19 counter items are filed
under `aina = 'keki'`:

```
cupcakes, donuts, biskuti, mandazi, sambusa, pufpuff, meringue, jelimatamu, kumquat
```

This already produced wrong reporting, and it will corrupt anything grouped by
category until fixed.

```sql
CREATE TABLE kategoria (
  id SERIAL PRIMARY KEY,
  jina VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true
);

ALTER TABLE bidhaa ADD COLUMN kategoria_id INTEGER REFERENCES kategoria(id);
```

Backfill by mapping the existing `aina` values, then set `kategoria_id NOT NULL`
and drop the `aina` free-text dependency.

---

## 2. Owner ↔ inventory requests (D12)

Human-to-human, distinct from the automated `ukumbusho` reminder engine (low
stock, pickup reminders) which is computer-generated.

```sql
CREATE TYPE hali_ombi AS ENUM ('fungua', 'imefanyika');
CREATE TYPE upendeleo_ombi AS ENUM ('kutoka_kwa_mfanyakazi', 'kwenda_kwa_mfanyakazi');

CREATE TABLE ombi (
  id SERIAL PRIMARY KEY,
  kutoka_kwa INTEGER NOT NULL REFERENCES mtumiaji(id),
  kwenda_kwa INTEGER NOT NULL REFERENCES mtumiaji(id),
  ujumbe TEXT NOT NULL,
  hali hali_ombi NOT NULL DEFAULT 'fungua',
  jibu TEXT,
  tarehe_ya_kufunguliwa TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

- Owner → inventory: `fetch` / restock something. Inventory clears it when done.
- Inventory → owner: needs approval to buy, or a new material created. Owner clears.
- **Rule: the recipient clears it.** No third party, no auto-close.
- Both directions surface in the existing `ReminderBell` so it reads as one list
  of "things needing my attention", not two systems.

---

## 3. GraphQL additions

```graphql
type Mapishi {
  id: ID!
  ladha: String!
  ukubwa: String!
  dakika_kadirio: Int!
  active: Boolean
  viambato: [MapishiKipengele!]!
}

type MapishiKipengele {
  id: ID!
  malighafi: Malighafi!
  kiasi_cha_chini: Float!
  kiasi_cha_juu: Float!
}

input MapishiKipengeleInput { malighafi_id: ID!, kiasi_cha_chini: Float!, kiasi_cha_juu: Float! }
input MapishiInput { ladha: String!, ukubwa: String!, dakika_kadirio: Int, viambato: [MapishiKipengeleInput!]! }

enum HaliUthibitishoMatumizi { inakadiriwa imethibitishwa }

# NOTE: agizo_id is optional — D4, order-less batch logging.
#       kumbukumbu is the note ("20 mandazi").
input MatumiziKipengeleInput { malighafi_id: ID!, kiasi: Float! }
input MatumiziKundiInput { agizo_id: ID, kumbukumbu: String, vitu: [MatumiziKipengeleInput!]! }

type Kategoria { id: ID!, jina: String!, active: Boolean }
type Ombi { id: ID!, ujumbe: String!, hali: String!, jibu: String, created_at: DateTime }

extend type Query {
  mapishi(active: Boolean): [Mapishi!]!
  kumbukumbu_matumizi_kusubiri: [KumbukumbuMatumizi!]!
  kategoria(active: Boolean): [Kategoria!]!
  ombi(fungua: Boolean): [Ombi!]!
}

extend type Mutation {
  unda_mapishi(input: MapishiInput!): Mapishi!
  hariri_mapishi(id: ID!, input: MapishiInput!): Mapishi!
  futa_mapishi(id: ID!): Boolean!

  log_matumizi_kundi(input: MatumiziKundiInput!): [KumbukumbuMatumizi!]!
  thibitisha_matumizi(id: ID!, kiasi_halisi: Float!): KumbukumbuMatumizi!

  panga_kategoria(bidhaa_ids: [ID!]!, kategoria_id: ID!): Int!   # D10 bulk action

  tumia_ombi(kwenda_kwa: ID!, ujumbe: String!): Ombi!
  fungua_ombi(id: ID!, jibu: String): Ombi!                        # recipient only
}
```

`panga_kategoria` is the bulk action — one call reassigns many products.

Extend `KumbukumbuMatumizi` with `hali`, `kiasi_halisi`, `imethibitishwa_na`,
`tarehe_ya_uthibitisho`, and `kumbukumbu` (the D3/D4 note).

**The verification queue must join order + recipe.** Returning bare usage lines
means the clerk sees "flour 4–5" with no idea which cake or how many, which
defeats the whole two-phase idea. Show `chocolate dira 20 x4`.

### Permissions

- `recipe.manage` — owner + inventory. *(judgment call, flagged in v1, still unconfirmed)*
- `usage.verify` — inventory + owner only. Distinct from `usage.read_all` and from
  the chef's `usage.create`. Keep the separate key.
- `ombi.tuma` / `ombi.fungua` — sender may send; **only the recipient may clear**.
- `log_matumizi_kundi` reuses `usage.create` (chef + owner).

---

## 4. Workflow

1. **Cashier** — unchanged. Same product grid, same prices, same flow.
2. **Chef** — for a custom order (D2), the basket is pre-filled from the recipe
   with each ingredient's suggested range, defaulting to the midpoint, editable.
   Tap to confirm, tap-search to add extras. For a regular product (D3), the
   basket starts empty; the chef taps ingredients from scratch and types a short
   note. Submits via `log_matumizi_kundi` — **stock does not move.**
3. **Inventory** — sees the pending verification queue with order/recipe context.
   Confirms the real number. `thibitisha_matumizi` is where stock actually moves.
4. **Owner** — costing per product from `bidhaa.mapishi_id` vs `bidhaa.bei`;
   requests to inventory; reports grouped by category.

---

## 5. Blockers — must be resolved before implementing

**B1. The dedupe and unique indexes will fail on existing data.** Verified: 7
duplicate `bidhaa` pairs and 1 duplicate customer (`simu 0757892413` → id 1 and
id 2, both `Derryck`). `CREATE UNIQUE INDEX` errors on violating data. A dedupe
migration must run first, and per D8 each pair is either a real size split or a
deactivation. **The Biskuti 500-vs-800 conflict is a human decision.**

**B2. `mteja` unique index also needs an empty-string guard.**
`WHERE simu IS NOT NULL` is not enough — `''` is not NULL, so two blank-phone
customers collide. Use `WHERE simu IS NOT NULL AND simu <> ''`.
Also note `unda_agizo` currently blind-`INSERT`s customers; verified. The `wateja`
search query already exists in the schema and is unused by the UI — surface it.

**B3. Dropping the old trigger silently breaks the existing chef button.**
`web/src/screens/Chef.jsx:74` still calls the single-item `LOG_MATUMIZI`. After
§1.6, that resolver inserts with `hali = 'inakadiriwa'` and would **never
decrement stock** — silently, with no error. That path must be removed or
repointed in the same change.

**B4. `malighafi_stock_non_negative` CHECK fights verification.** Verified:

```
CHECK (kiasi_kilichopo >= 0)
```

If inventory confirms more than the system thinks exists — which is exactly what
happens when stock was wrong or usage went unlogged — the trigger aborts the
transaction with a raw constraint error. **Recommendation: allow negative on
verification and surface it as a variance.** Inventory's job is to record
reality; blocking that tells the truth-teller they can't speak. Needs a decision.

**B5. The material master is unusable as-is.** 12 rows describing 6 real
ingredients, each duplicated under two names:

```
Unga wa Ngano Bora 40kg  +  Unga wa Nagno 49kg
Sukari Nyeupe 25kg       +  Sukari 50kg
Mayai (Bata) 500pcs      +  Mayai 50pcs
Siagi ya Chupa 3200kg    +  Siagi 50kg
Chokoleti ya Keki 15000kg + Chokoleti 30kg
Vanila Extract 18000l    +  Vanila 50l
```

Recipes attach to materials, so this is a hard prerequisite, not a side task. The
`3200 kg` of butter and `18000 l` of vanilla also mean the chef's low-stock panel
and the owner's forecasts are currently meaningless. Also: `malighafi.unit` is
free text with no normalisation — `kg` and `KG` would silently become separate
buckets that don't sum.

**B6. Unit conversion layer is missing entirely.** Cups do not convert to grams
by a fixed number — flour is ~120 g/cup, cocoa ~85 g/cup, sugar ~200 g/cup,
butter ~227 g/cup. A fixed cup→gram assumption **doubles the flour**. Rules:
mass↔mass and volume↔volume are safe; **volume→mass only via a per-ingredient
density table**; and if no density is on file, **refuse rather than guess**.
`pcs` never auto-converts. Store internally in base units (g, ml, count) and
convert for display only. If recipes are authored by hand on a scale, `kg`/`g`/`pcs`
is sufficient — but the unit must be documented and the conversion layer is what
makes an imported recipe library viable. Not in v1 scope; explicitly acknowledged.

**B7. v1 §5 claimed `kiasi_halisi = 0` works as partial rejection. It does not.**
`thibitisha_matumizi` as drafted throws on `<= 0`. Direct contradiction. Either
allow 0, or drop partial rejection from scope.

**B8. `dakika_kadirio DEFAULT 90` is wrong for most of the catalogue.** ~25 min
for cupcakes, hours for a 3-tier. Fine as a column, bad as a global default.

---

## 6. Still open

- **Sales mix** — counter goods vs cake orders by volume. Determines how urgent
  the D3/D4 batch-logging path is. *The live database cannot answer this: all 10
  sales in it are test rows, all order-linked, none with line items.*
- **`recipe.manage` grant** — owner only, or owner + inventory?
- **Should the verification queue badge ingredients not in the recipe** (D3 path)
  so the clerk scrutinises them? Cheap at read time, not required for v1.
- **Verification lag** — stock only moves at verification, so low-stock alerts
  lag by however long items sit unverified. Same-day is fine; once-daily means the
  owner's stock picture is stale for hours. Could reuse the `ukumbusho` engine
  with a new kind targeted at inventory.
- **A5 / I1 / K3** from `cakecity-pos-fix-list.md` remain open and unrelated.
