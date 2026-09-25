# Cake Shop POS System — Product Specification (v3)

**Status:** Draft for discussion
**Interface language:** Kiswahili (UI labels, receipts, messages)
**Documentation language:** English (for build/planning reference — see §11 for Kiswahili terms)
**Currency:** Tanzanian Shillings (TSh)

---

## 1. Problem Statement

The cake shop currently has no formal system for recording sales, custom cake orders, deposits, or ingredient stock — and coordination between the counter, the kitchen, and stock-keeping happens informally (verbally, on paper, or not at all). This creates real risks: cake specs get miscommunicated between cashier and chef, ingredient usage isn't logged so stock counts drift from reality, stockouts aren't caught until mid-bake, and the owner has no single place to see what's actually happening across the shop without asking each person directly. A lightweight, Kiswahili-first system built around how the shop actually operates — counter, kitchen, and stock room as connected roles, not separate silos — solves this.

## 2. Goals

1. Every sale (walk-in or custom order) is recorded in under 60 seconds at the counter.
2. No custom cake order is accepted without a tracked deposit and clear balance-due amount.
3. Cake specs move from cashier to chef without being re-typed, re-written, or verbally repeated.
4. Ingredient usage is logged as the chef works, so stock levels reflect reality without extra paperwork.
5. The owner can see the full picture — sales, kitchen activity, and stock — in one place, without asking each person individually.
6. Each of the four roles (owner, cashier, chef, inventory clerk) sees only what's relevant to their job — a cashier isn't buried in stock percentages, a chef isn't shown sales reports.

## 3. Not in v1 — Planned for Later

Nothing here is permanently out of scope — these are deliberately sequenced *after* Phase 1, so the core workflow ships fast and solid first.

- **Online ordering / customer-facing website** — **Confirmed, coming soon.** The shop is deploying a website for online orders in the near term. The system's data layer needs to be built so a website can plug into it later without a rebuild. See §5 for the shared-data implications and §13 for timing.
- **Accounting/tax filing integration** — Planned for once sales volume and reporting needs are clearer.
- **Delivery logistics/route planning** — Likely relevant once the website brings delivery requests — revisit alongside the website launch. Note this is separate from the delivery *person* being outside the system (see §4) — that's a permanent design choice, not a v1 gap.
- **Multi-branch support** — Relevant only once there's a second location.
- **Recipe-level costing (auto-calculating cost-per-cake from ingredients)** — Worth adding once the ingredient list and recipes are stable. What v1 *does* do — logging ingredient quantities used per order — lays the groundwork for this.

## 4. Users & Roles

Four people have a login and a screen. A fifth role — delivery — is deliberately excluded.

| Role | Kiswahili label | What they see | What they log/do |
|---|---|---|---|
| Owner | *Mmiliki* | Everything — sales, kitchen activity, stock, staff activity | Prices, staff accounts, edit/cancel any order |
| Cashier | *Mfanyakazi wa Kaunta* | Today's sales, orders due, stock levels (read-only), incoming website orders (Phase 2) | Sales, custom order + deposit intake, marks orders collected |
| Chef | *Mpishi* | Kitchen queue: active orders with flavor, design, size, due date; current stock (read-only) | Order status (In Progress/Ready), ingredient usage per order |
| Inventory clerk | *Mfanyakazi wa Hisa* | Stock levels, % used, usage logged by the chef | Restocking (new deliveries), waste/spoilage adjustments |

**Delivery is intentionally outside the system.** If someone handles deliveries, they don't get a login or screen — they receive the cake and pickup details verbally or on a printed/handwritten slip from the cashier or chef. This isn't a gap to fill later; it's a deliberate design choice to keep the system to the four roles that actually need to see data on a screen. (Revisit only if the shop's needs change.)

Each staff member logs in with their own PIN or account so every action — a sale, an order update, a stock log — is attributed to whoever did it.

## 5. The Shared Data Hub

Think of this the way you described it — like the circuit box in a house. Every room has its own switches and outlets, but the wiring all meets in one panel. The kitchen doesn't have its own private electrical system separate from the living room's; if the kitchen draws power, it shows up on the same panel the homeowner can check anytime.

That's the model here. There's one shared set of records — call it the tray — and all four screens (owner, cashier, chef, inventory clerk) are different *views* into that same tray, not four separate systems that need to be kept in sync by hand. When the cashier creates an order, it doesn't get "sent" to the chef in any special way — the chef's kitchen queue is just a filtered view of the same tray, so the order is already there the moment it's saved. When the chef logs ingredients used, that doesn't get "reported" to inventory — the inventory clerk's stock screen is reading the same numbers, updated live.

This is *why* a website plugging in later (§3) doesn't require a rebuild: the website becomes a fifth view into the same tray, the same way the four staff screens are.

### What's in the tray

| Entity | Key fields | Who writes | Who reads |
|---|---|---|---|
| Agizo Maalum (Custom order) | id, mteja (customer), maelezo ya keki (flavor/design/size), tarehe ya kuchukua (due date), bei jumla (price), malipo ya awali (deposit), salio (balance), hali (status) | Cashier creates it; chef updates status | Cashier, chef, owner |
| Mauzo (Sale) | id, tarehe (date), mfanyakazi (staff), bidhaa/kiasi (items/qty), jumla (total), njia ya malipo (payment method) | Cashier | Cashier (own shift), owner (all) |
| Kumbukumbu ya Matumizi (Usage log) | id, agizo_id (linked order), malighafi (ingredient), kiasi kilichotumika (qty used), mpishi (who logged it), tarehe | Chef | Inventory clerk, owner |
| Malighafi / Hisa (Stock) | id, jina (name), kiasi kilichopo (current qty), asilimia iliyotumika (% used), kiwango cha chini (low-stock threshold) | Auto-updated from usage logs; inventory clerk adjusts (restock, waste) | Chef (read-only), inventory clerk, owner |
| Bidhaa (Product) | id, jina (name), bei (price), aina (category) | Owner | Everyone |
| Mteja (Customer) | id, jina, simu, siku ya kuzaliwa, historia ya maagizo | Cashier | Cashier, owner |
| Mtumiaji (Staff account) | id, jina, jukumu (owner/cashier/chef/inventory), PIN | Owner | Owner |

The important design decision here: **the chef's usage log is what moves the stock number, not a separate manual re-entry by the inventory clerk.** The inventory clerk's job isn't to duplicate what the chef already logged — it's to reconcile (does the physical count match what the log says?), restock, and catch waste/spoilage that no one's order-related log would capture. See §12 for an open question on how strictly this should be enforced.

## 6. Order & Data Lifecycle — Walkthrough

1. **Cashier takes the order.** A customer wants a cake. The cashier enters flavor, design, size, and pickup date, and takes a deposit. This creates the Agizo Maalum record in the tray.
2. **Chef sees it immediately.** No separate step to "pass it to the kitchen" — the order appears in the chef's kitchen queue the moment it's saved, because the chef's queue is just a view of the same tray filtered to active orders.
3. **Chef marks it in progress** and, while baking, logs the ingredients used against that specific order (e.g., "2kg flour, 1kg sugar, 6 eggs").
4. **Stock updates automatically.** That usage log decrements the shared stock numbers — the inventory clerk doesn't need to be told separately.
5. **Inventory clerk monitors and restocks.** They check stock levels and % used, get low-stock alerts, log new deliveries (restocking), and log any waste or spoilage that happened outside a specific order.
6. **Chef marks the order ready.**
7. **Cashier hands it over** — to the customer directly, or to whoever's doing delivery that day (with a printed slip or verbal handoff, since delivery has no login) — and marks the order collected.
8. **Owner sees all of it, anytime** — sales, order statuses, who logged what, stock levels — without asking anyone directly, because it's all the same tray.

## 7. Core Modules

### 7.1 Sales & Checkout (*Mauzo*)
Walk-in sales: pick item(s), apply discount if any, choose payment method (cash, M-Pesa, Tigo Pesa, Airtel Money — recorded separately so daily totals reconcile per method), generate a receipt (printable and/or shared digitally, e.g. via WhatsApp/SMS).

### 7.2 Custom Cake Orders & Deposits (*Maagizo Maalum*)
Cashier captures customer contact, cake details, pickup date, price, deposit, and balance. The order automatically appears in the kitchen queue — see §6. Status flow: *Imeagizwa → Inatengenezwa → Tayari → Imechukuliwa*.

### 7.3 Kitchen Queue & Fulfillment (*Foleo ya Jikoni*)
The chef's primary screen: active orders with full cake specs and due dates, sorted by urgency. The chef updates order status and logs ingredient usage per order here — this is the write path that keeps stock accurate (§5).

### 7.4 Inventory Management (*Usimamizi wa Hisa*)
The inventory clerk's screen: current stock with quantity and % used, low-stock alerts, a view of what the chef has logged as used, and the ability to log restocking or waste/spoilage adjustments.

### 7.5 Customers & Loyalty (*Wateja*)
Customer name, phone, order history, and birthdays for proactive outreach. Simple loyalty mechanism (stamp count or repeat-order discount) to reward regulars.

### 7.6 Language & Localization
All UI labels, buttons, receipts, and system messages in Kiswahili. Currency formatted as TSh. See §11 for the terminology reference.

## 8. User Stories

**Cashier**
- As a cashier, I want to ring up a walk-in sale in a few taps so customers aren't kept waiting.
- As a cashier, I want to record a custom order with a deposit so nothing is baked without payment secured.
- As a cashier, I want the order to reach the kitchen automatically so I don't have to separately tell the chef.
- As a cashier, I want to see which orders are due today so I can prepare and follow up.

**Chef**
- As the chef, I want to see all my active orders with flavor, design, size, and due date in one place so I don't have to ask the cashier to repeat details.
- As the chef, I want to log the ingredients I use per cake so stock stays accurate without extra paperwork.
- As the chef, I want to see current stock before committing to a big order so I don't promise something I can't make.
- As the chef, I want to mark an order ready so the cashier knows it can be handed over.

**Inventory clerk**
- As the inventory clerk, I want to see stock levels and % used so I know what's running low.
- As the inventory clerk, I want to see what the chef has logged as used so my counts match reality.
- As the inventory clerk, I want to log new deliveries so the system reflects what's actually in the store.
- As the inventory clerk, I want to log waste or spoilage separately from normal usage so the numbers stay honest.

**Owner**
- As the owner, I want to see today's sales split by payment method so I can reconcile cash and mobile money.
- As the owner, I want to see all outstanding balances on custom orders so nothing is given away unpaid.
- As the owner, I want to see the full picture — sales, kitchen activity, stock — without asking each person individually.
- As the owner, I want to see who logged what, so I can track accountability across all four roles.

## 9. Requirements

### Must-Have (P0)
- [ ] Four distinct role-based logins: owner, cashier, chef, inventory clerk
- [ ] Record a walk-in sale with item(s), quantity, price, and payment method
- [ ] Generate a receipt (printable and/or shareable digitally)
- [ ] Create a custom order with customer info, cake details, pickup date, price, deposit, balance
- [ ] Order status tracking (Ordered → In Progress → Ready → Collected)
- [ ] Chef's kitchen queue: active orders with full specs and due dates
- [ ] Chef can update order status and log ingredient usage per order
- [ ] Ingredient usage automatically updates shared stock levels
- [ ] Inventory clerk's stock dashboard: quantity + % used, low-stock alerts
- [ ] Inventory clerk can log restocking and waste/spoilage adjustments
- [ ] Owner dashboard rolling up sales, orders, and stock across all roles
- [ ] Full Kiswahili interface

### Nice-to-Have (P1)
- [ ] Customer profiles with order history and birthday tracking
- [ ] Simple loyalty rewards
- [ ] Weekly/monthly reports, not just daily
- [ ] Photo attachment for custom cake design references
- [ ] Automated pickup reminder (SMS/WhatsApp)

### Future Considerations (P2)
- [ ] Recipe-based auto-suggestion of ingredient quantities (building on the usage log)
- [ ] Customer-facing order form via the website (§3)
- [ ] Multi-branch support
- [ ] Full accounting export

## 10. Kiswahili UI Terminology Glossary (starter reference)

| Kiswahili | English |
|---|---|
| Mauzo | Sales |
| Bidhaa | Product(s) |
| Agizo / Maagizo | Order(s) |
| Agizo Maalum | Custom order |
| Malipo ya Awali | Deposit |
| Salio | Balance due |
| Risiti | Receipt |
| Mteja / Wateja | Customer(s) |
| Hisa | Stock/Inventory |
| Malighafi | Ingredients/Raw materials |
| Kumbukumbu ya Matumizi | Usage log |
| Asilimia Iliyotumika | % used |
| Kujaza Upya | Restock |
| Upotevu | Waste/spoilage |
| Kiasi Kidogo cha Hisa | Low stock |
| Mfanyakazi wa Kaunta | Cashier |
| Mpishi | Chef |
| Mfanyakazi wa Hisa | Inventory clerk |
| Mmiliki / Msimamizi | Owner/Admin |
| Foleo ya Jikoni | Kitchen queue |
| Uwasilishaji | Delivery (outside the system) |
| Kaunta | Counter |
| Bei | Price |
| Punguzo | Discount |
| Taslimu | Cash |
| Pesa za Simu | Mobile money |
| Tarehe ya Kuchukua | Pickup date |
| Ukubwa | Size |
| Ladha | Flavor |
| Alama za Uaminifu | Loyalty points |

*(Living reference — will grow as we spec each screen.)*

## 11. Open Questions

- **[Engineering/Owner]** Does the shop have reliable internet at the counter, or should the system work offline and sync later?
- **[Owner]** What device(s) sit at each station — tablet, phone, laptop? Likely different per role (kitchen may want something splash-resistant).
- **[Owner]** Is a thermal receipt printer wanted, or is digital-only receipt sharing enough?
- **[Owner]** Should the chef's ingredient usage log **auto-decrement** stock the moment it's logged, or require inventory clerk confirmation first? Auto is faster; confirmation catches chef logging mistakes before they skew stock numbers.
- **[Owner]** Should low-stock alerts reach the chef directly (so they know before starting a big order), or only the inventory clerk and owner?
- **[Owner]** What loyalty mechanism feels right — stamp card, percentage discount after N orders, something else?
- **[Engineering]** Will the POS and the upcoming website share one backend/database, or run as separate systems that sync?
- **[Owner]** For delivery handoffs, is a handwritten note enough, or should the system print a simple delivery slip (still without the delivery person logging into anything)?

## 12. Suggested Phasing

- **Phase 1 (v1 core):** All four roles and their screens — this isn't optional scope, it's the actual coordination problem being solved. Sales/checkout, custom orders + deposits, kitchen queue, ingredient usage logging, inventory dashboard, Kiswahili UI, owner rollup. Data layer built as the shared hub (§5) from day one so the website can plug in later without a rebuild.
- **Phase 2 (near-term — website launch):** Customer-facing website for online orders goes live, reading/writing the same tray. Incoming website orders land in a shared queue visible to cashiers and the owner. Alongside this: customer profiles, loyalty, richer reports, pickup reminders.
- **Phase 3:** Recipe-based ingredient suggestions, delivery logistics, multi-branch.

---

*Next step: confirm the open questions in §11 that matter most (especially the auto-decrement vs confirmation question in stock logging — it shapes how the chef and inventory clerk screens actually work), then move into screen-by-screen design for the chef and inventory clerk views.*
