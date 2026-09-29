# CakeCity spec gap analysis

Status: audited against the working tree at `ddd3e66`. Nothing below is inferred; every
line was checked against the schema, the resolvers, or the screen named.

## Phase 1 — Recipe matching

| Spec requirement | State | Evidence |
| --- | --- | --- |
| Backend picks the recipe from flavour + size | **missing** | every read of `mapishi` in `src/` is by primary key or exact `(ladha, ukubwa)`; no matching function exists |
| Cashier never sees a recipe selector | **missing** | `web/src/screens/Cashier.jsx:340-372` renders a `<Select>` of every recipe |
| Recipe stored internally on the order | present, optional | `agizo_maalum.mapishi_id`, nullable; nullable is the "off-book/custom" flag |
| Matched recipe generates the chef's suggested list | partial | `Mapishi.viambato` resolves, but the chef screen ignores it (§2 below) |

`mapishi` has no type column: `ladha` (flavour) and `ukubwa` (size) are both free text.
Cake type lives only as `agizo_maalum.umbo`, also free text. Matching therefore has to be
tolerant rather than exact.

## Phase 2 — Chef workflow

| Spec requirement | State | Evidence |
| --- | --- | --- |
| One recipe, never a candidate list | **missing** | `Chef.jsx:352-383` renders every active ingredient from `Query.malighafi` |
| Tap a range, no typing | **missing** | `Chef.jsx:79-83` collapses min/max to a midpoint; `Chef.jsx:404-411` is a free-text `type="number"` |
| The range is preserved, not a midpoint | **missing** | `kumbukumbu_matumizi.kiasi` is a single `NUMERIC(10,2)` |
| Mark an ingredient not used | **missing** | removing a pill deletes the key, so the line is never recorded at all |
| Add an ingredient that was not suggested | works, by accident | the grid is the whole catalogue, which is also why the recipe is invisible |
| `sehemu` respected when an ingredient appears twice | **broken** | `Chef.jsx:80` keys the seed on `malighafi.id` alone, so the second line overwrites the first and half of a multi-part recipe is lost |

Reuse of existing structures is required by spec §7 and already possible:
`mapishi_kipengele.kiasi_cha_chini` / `kiasi_cha_juu` exist with
`CHECK (kiasi_cha_juu >= kiasi_cha_chini)`.

## Phase 3 — Inventory verification

| Spec requirement | State | Evidence |
| --- | --- | --- |
| Chef log is not a stock movement | met | `hali_uthibitisho_matumizi('inakadiriwa','imethibitishwa')`; stock moves only on verify |
| Explicit verification | met | `Mutation.thibitisha_matumizi` |
| No double verification | met | `SELECT ... FOR UPDATE` plus two `ALREADY_VERIFIED` guards, plus the trigger's `OLD.hali` condition |
| No double stock movement | met | `trigger_usage_decrement_on_verify` fires only on `inakadiriwa → imethibitishwa` |
| The queue shows the recipe's range | **missing** | the queue shows only `row.kiasi`; min/max is never fetched |
| No duplicate *logging* | **missing** | the batch insert does no read-before-write and the chef cannot read past rows, so a double tap duplicates silently |

## Phase 4 — Request & directive engine

| Spec requirement | State | Evidence |
| --- | --- | --- |
| Generic request/directive model | **missing** | `ombi` is user-to-user with `hali_ombi('fungua','imefanyika')`; no directive concept |
| Department targeting | **missing** | `kwenda_kwa` is a person only |
| Subject, priority, related entity, deadline | **missing** | `ombi` has `ujumbe` and nothing else |
| Backend-owned state machine | **missing** | two statuses, no transition table, no invalid-transition guard |
| Approve / reject / request clarification | **missing** | only `fungua_ombi(id, jibu)`, which closes |
| Directive lifecycle to completion | **missing** | no acknowledge or in-progress state |
| Sender cannot approve their own request | **missing** | no self-approval guard |
| Audit history for requests | **missing** | there is no `audit_ombi` trigger; the other nine tables are audited |

## Phase 5 — Owner dashboard

Present: low stock, kitchen load, reminders, outstanding balances, forecast strip.
Missing: pending requests, active directives, pending verifications.

## Cross-cutting

- Permissions are a flat non-inheriting map (`can()` is one exact-key lookup). `inventory`
  has no `order.*` key, so inventory cannot change order status at all.
- `mapishi` and `kategoria` have no authoring UI. `UNDA_MAPISHI` / `HARIRI_MAPISHI` are
  defined in `web/src/graphql/mutations.js` and imported by no screen.

## Decisions taken before writing code

1. **Matching is tolerant, not exact.** `ladha` and `ukubwa` are free text, so the matcher
   normalises, then scores on exact-then-partial flavour, numeric size, and shape. It returns
   one best recipe plus a recorded reason; candidates are never sent to the client, because
   spec §3 forbids exposing them.
2. **A band is a range, and inventory still supplies the definitive number.** The chef taps a
   band; the band is stored, and the midpoint is kept only as the provisional estimate that
   spec §9 says must not move stock. `kiasi_halisi` from inventory is what moves stock.
3. **"Not used" is a recorded line, not an omission.** It becomes a sheet line with
   `hali_zingumiaji='haikutumika'`; inventory confirms it at `0`, which moves no stock and
   leaves a trace that the chef considered it. This reuses the `kiasi_halisi = 0` meaning
   already documented in the verify resolver.
4. **The state machine lives in one table** shared by requests and directives, because
   spec §15 wants one reusable engine rather than two features.
5. **The `ombi` enum is extended in place** rather than replaced, so the timeline of anything
   already recorded is not destroyed.
