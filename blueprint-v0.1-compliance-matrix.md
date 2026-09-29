# Coherence analysis: Master Blueprint v0.1 vs. current build

Reconciled 29 Sep 2026 against `cakecity-master-blueprint-v0.1.md`.
Every row was checked in the database or the source, not inferred.

First pass at this was too harsh: it scored several things "CONFLICT" that are in
fact correct-or-missing. Corrected below.

---

## 1. Where the build already IS the blueprint

The operational spine was built to this document's shape, in different words.

| Blueprint | Build | Note |
|---|---|---|
| §5.6 usage chain: Suggested → Reported → Confirmed → Stock decrements | matcher → `zingumiaji_matumizi` sheet → `amethibitishwa` → `marekebisho_hisa` | Four stages, four mechanisms. The best-aligned thing in the system |
| D-13 suggestion generated from order details | `src/recipes/matcher.js` reads flavour, size (`inch`, `vipande`), layer (`safu`) from the order | Also answers part of Q-05 already: when nothing matches, the kitchen is handed a manual ingredient list |
| D-14 preset ranges per ingredient | range tap on the sheet | Built, verified live (band + extra stay distinct) |
| BR-12 / §9 "stock is computed from movements, never overwritten" | `marekebisho_hisa` is a movement ledger | Built |
| BR-21 breakers (PIN/role → validation → audit) | `requireAuthenticated` / `requireCan` then audit write | Verified live: cashier manual override returned `FORBIDDEN` + `permission: recipe.override` |
| D-06 / BR-07 payment methods | `cash` (first = default), `tigopesa` (card), `mpesa` + `airtel_money` | 3 of 4; bank transfer missing |
| D-07 / BR-06 usually full at order time, exceptions allowed | `bei_jumla` + `malipo_ya_awali` | This is exactly full-with-exception. I previously read it as a violation — it is a match |
| §1.1 "two kinds of sales" | `bidhaa` (6) vs `agizo_maalum` (12) | The blueprint's opening distinction is already the data model's opening distinction |
| D-05 roles | `owner, cashier, chef, inventory` | The four roles exactly. Only the word for Baker differs |
| D-11 New → In production → Ready → Completed | `ordered → in_progress → ready → collected` | Same progression, different names |
| D-30 cashier advances catalogue orders | `order.collect` permission on the state moves | Partial |
| §4.4 order fields | `mteja_id, ladha, ukubwa, tarehe_ya_kuchukua, maelekezo_maalum, umbo, malipo_ya_awali` | customer ✓ delivery date ✓ notes ✓ attachment (`umbo`) ✓ payments ✓ |
| §4.8 inventory | `kiasi_kilichopo` (on hand), `kiwango_cha_chini` (reorder level) | `pending_confirmation` not stored — derived instead |
| BR-14 days of stock left | `predictStockFor` → `perDay, daysLeft, depletionDate` | Built |
| §4.9 announcements | `ukumbusho` | Built |

## 2. Missing capability — the retail half, not started

The build covers making and tracking cakes. It does not cover *selling* them as
a shop would.

| Blueprint | Status |
|---|---|
| §4.2 option groups / values / combinations (D-26, D-27, BR-02) | `bidhaa` is flat: `jina, bei, aina, familia, ukubwa, kategoria_id`. `familia`/`ukubwa` are free-text ancestors of Filling and Size, not a variation grid |
| §4.3 counter day: batches, daily count, count differences, closing review, markdown | absent (BR-18, BR-19, BR-20, D-23, D-24) |
| §4.6 / §5.8 delivery record | absent (D-29) |
| §8 alerts, dedupe, critical WhatsApp/SMS | absent (BR-23, BR-24, D-40) |
| §9 offline-first, outbox, sync | absent; BR-26 order-number uniqueness across devices cannot hold |
| §7.8 / A-06 IT role and panel map | no `it` role in `Jukumu` (D-37) |
| §7 panel vocabulary: breakers/circuits/intents/feeds/events/terminals | not a rewrite — the central logic layer exists, the structure is unnamed |

## 3. Genuine contradictions — only two survive

**BR-05 / D-28 pricing authority.** Now **closed**. The price of a custom cake
comes from an owner quote, delivered as a request, and the order is not confirmed
until the quote resolves. A new `awaiting_quote` order state lets the till describe
a cake with no price; the order is created unquoted, a quote request is raised to
the owner, no ticket is issued and no money is taken; the owner prices it via
`toa_bei` (owner-only `order.quote`), which sets the price, moves the order to
`ordered`, issues the kitchen ticket, records any deposit, and closes the quote
request in one transaction. An unquoted order cannot enter production, and a
priced order cannot be re-quoted. Pricing at the till is still allowed when a
price is supplied — this is a permission change, not a removal. Covered by
`npm run verify:br05` (15 checks).

**BR-13 usage report auto-creates a request to Inventory.** Now **closed**. A
submitted report raises a request routed to the Inventory role and linked to the
exact sheet; confirming the sheet closes that request in the same transaction, so
stock can never move with an open request still claiming to be waiting. Covered by
`npm run verify:br13` (18 checks).

Also unresolved but smaller: BR-01 (an order cannot hold both line kinds — no
`lines[]` array exists), and the per-line status of §5.1/§5.2.

**Newly noticed while closing BR-13.** The confirmation trigger
`update_stock_from_verified_usage` decrements `malighafi.kiasi_kilichopo` in
place. It does not append a `marekebisho_hisa` row. §9 says "stock is computed
from movements, never overwritten", so the usage path is the one place stock is
still overwritten rather than derived. Queued.

## 4. Corrections to the first pass

- Order-level status is **not** a wrong decision. A-07 only requires derivation for
  *mixed* orders; single-kind orders, which is all the build can express, are
  correct as they stand. Missing feature, not conflict.
- Absent `Decorating` is **not** a conflict — D-11 makes it an optional stage the
  owner switches on. Not enabled is not wrong.
- `chef` vs `baker` is cosmetic.
- BR-22 is a matter of degree: totals and permissions come from the server, but the
  screens hold some state and validation.
- The earlier claim that the payment model conflicts with the blueprint was wrong;
  `bei_jumla` + `malipo_ya_awali` implements BR-06 as written.

## 5. Supersession still to record

`cakecity-spec-2026-09-28.md` was committed as "the source of truth". That framing
is now wrong. Per §0 this needs a D-41 decision marking it superseded, a §17 bump,
and pointers in both documents. The pasted blueprint was saved verbatim and unedited.
