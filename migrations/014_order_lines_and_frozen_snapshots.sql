-- BR-01, BR-02, BR-11, BR-26: order lines with a snapshot frozen at entry.
--
-- agizo_maalum is one row per custom cake. That was fine while a custom cake was
-- the only thing you could order. The blueprint says an order holds lines[], and
-- a line is either a catalogue combination or a custom cake, with any mix of the
-- two (BR-01). An order line table is the only way to express that, and it is
-- what BR-11 needs anyway: a snapshot has to live somewhere, and a snapshot per
-- line is where it belongs.
--
-- The snapshot columns are the whole point of this migration. The owner renames
-- a size from "8-inch" to "8 inch (feeds 12)", changes a price, or corrects an
-- allergen. If the order line held only mchanganyiko_id, the old order would
-- silently rewrite itself, and a receipt printed next month would disagree with
-- the one printed today. So the line copies what it needs at the moment of entry
-- and is never rewritten afterwards. The live combination id is kept alongside
-- it for stock and reports, but it is a pointer, not the record.
--
-- Ordering: the order number is a human-readable value someone reads aloud at
-- pickup, so it needs a device prefix plus a per-day sequence (BR-26). Two
-- till devices in the same shop must not hand out the same number, and a device
-- that was offline all afternoon must not collide with one that never was. A
-- per-device, per-day counter in the database gives both, and is the piece
-- offline sync later replays against.

-- ── Device identity (BR-26) ──────────────────────────────────────────
-- One row per till or panel. The prefix is what keeps order numbers unique
-- across devices; it is short and human-readable because it gets read aloud.
-- ukumbusho_namba is a 0-based per-device counter used as the sequence, kept
-- per day so numbers stay short and sort in date order.
CREATE TABLE IF NOT EXISTS kifaa (
  id SERIAL PRIMARY KEY,
  alama VARCHAR(20) NOT NULL UNIQUE,
  jina VARCHAR(100) NOT NULL,
  kiakili INTEGER NOT NULL DEFAULT 0,
  tarehe_namba DATE DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- The counter advances with one atomic UPDATE rather than a read-then-write, so
-- two devices (or two browser tabs) taking a number at the same instant cannot
-- read the same value. Rolling the date in the same statement is what resets it
-- daily: if today has moved on, the counter restarts at 0 for this device.
-- Resets do not repeat numbers within a day, and a day change is the only thing
-- that restarts the sequence.
CREATE OR REPLACE FUNCTION kifaa_chukua_namba(p_kifaa_id INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE kifaa
     SET kiakili = CASE WHEN tarehe_namba = CURRENT_DATE THEN kiakili + 1 ELSE 1 END,
         tarehe_namba = CURRENT_DATE
   WHERE id = p_kifaa_id
  RETURNING kiakili INTO n;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Kifaa % hakipo', p_kifaa_id;
  END IF;
  RETURN n;
END;
$$;

-- ── Order lines (BR-01) ──────────────────────────────────────────────
-- aina is the kind of line, not a second guess about status: a catalogue line
-- is sold from stock at a price the owner already set, a custom line is made to
-- order and priced by quote. Keeping the two in one table with a discriminator
-- is what lets an order hold both without two parallel code paths, and without
-- the order having to know which kind of shop it belongs to.
CREATE TYPE aina_ya_kipimo AS ENUM ('katalogi', 'custom');

CREATE TABLE IF NOT EXISTS agizo_kipimo (
  id SERIAL PRIMARY KEY,
  agizo_id INTEGER NOT NULL REFERENCES agizo_maalum(id) ON DELETE CASCADE,
  aina aina_ya_kipimo NOT NULL,

  -- Live pointer. Nullable for a custom line, and deliberately kept nullable for
  -- catalogue too: an archived or restructured combination must not be able to
  -- cascade into deleting a line of history. The snapshot below is the record.
  mchanganyiko_id INTEGER REFERENCES mchanganyiko(id) ON DELETE SET NULL,
  bidhaa_id INTEGER REFERENCES bidhaa(id) ON DELETE SET NULL,

  -- ── The frozen snapshot (BR-11) ────────────────────────────────────
  -- What the order was, at entry. Not a denormalisation for speed: these are
  -- deliberately divergent from the catalogue, because the catalogue moved on
  -- and the order did not.
  jina TEXT NOT NULL,
  chaguo TEXT[] NOT NULL DEFAULT '{}',   -- chosen options, in axis order
  viambisho TEXT[] NOT NULL DEFAULT '{}', -- union of the chosen values' allergens
  bei DECIMAL(10,2) NOT NULL,            -- price at entry, owner-set or quoted
  kiasi INTEGER NOT NULL DEFAULT 1 CHECK (kiasi > 0),

  -- Custom-cake recipe attributes. Kept on the line rather than on the order
  -- because they describe this line: an order with a custom line and a catalogue
  -- line has exactly one set of them. Free text from the customer sits in
  -- maelezo so the kitchen can read it even if these are blank.
  --
  -- The set here is D-42: the attributes that change what is baked. An
  -- inscription changes what is written on the cake, not what is baked, so it
  -- lives in maelezo with the decoration notes rather than here.
  kimo TEXT,        -- servings_or_size
  ladha_za_chakula TEXT,  -- flavor
  kijazi TEXT,      -- filling
  tabaka INTEGER,   -- layers
  mzabibu TEXT,     -- dietary

  maelezo TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reading an order is always "this order's lines, in the order they were
-- added", so the index serves that directly and the covering order matches the
-- common query rather than needing a sort.
CREATE INDEX IF NOT EXISTS idx_agizo_kipimo_agizo
  ON agizo_kipimo (agizo_id, id);

-- "Which lines point at this combination" is the stock-decrement query at
-- completion, and the only reason mchanganyiko_id is kept at all.
CREATE INDEX IF NOT EXISTS idx_agizo_kipimo_mchanganyiko
  ON agizo_kipimo (mchanganyiko_id)
  WHERE mchanganyiko_id IS NOT NULL;

-- ── Order number (BR-26) ────────────────────────────────────────────
-- Separate from id because id is a database sequence with no meaning to a human
-- reading it out at a shop counter, and two devices will never agree on it.
-- chanzo (walk-in or phone) and njia_ya_kutimiza (pickup or delivery) come
-- straight from §4.4's Order record. Enums rather than free text because both
-- are decided once and drive behaviour — a delivery order needs an address, a
-- phone order is not a walk-in — and a typo in a free-text value would quietly
-- fall into the default branch instead of being refused.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agizo_chanzo') THEN
    CREATE TYPE agizo_chanzo AS ENUM ('walk_in', 'phone');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'njia_ya_kutimiza') THEN
    CREATE TYPE njia_ya_kutimiza AS ENUM ('pickup', 'delivery');
  END IF;
END $$;

ALTER TABLE agizo_maalum
  ADD COLUMN IF NOT EXISTS nambari VARCHAR(30) UNIQUE,
  ADD COLUMN IF NOT EXISTS kifaa_id INTEGER REFERENCES kifaa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chanzo agizo_chanzo NOT NULL DEFAULT 'walk_in',
  ADD COLUMN IF NOT EXISTS njia_ya_kutimiza njia_ya_kutimiza NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS anwani_ya_kuleta TEXT;

-- Existing orders get numbers in a dedicated, obviously-fake device prefix. They
-- were created before order numbers existed, and backfilling them with a real
-- device's prefix would pretend a device handed them out. This keeps the column
-- populated (so no report has to cope with NULL) and honest about its origin.
-- AG0 is not a device any shop will actually use.
-- active = false on purpose. This device exists only to give the old orders a
-- number, and it must never issue a new one: its counter is 0, so the first
-- order it numbered would be AG0-1 and collide with the backfilled order id 1.
INSERT INTO kifaa (alama, jina, active)
VALUES ('AG0', 'Agizo za awali (kabla ya nambari)', false)
ON CONFLICT (alama) DO NOTHING;

UPDATE agizo_maalum a
   SET nambari = 'AG0-' || a.id,
       kifaa_id = (SELECT id FROM kifaa WHERE alama = 'AG0')
 WHERE a.nambari IS NULL;

-- njia_ya_kutimiza is 'delivery' only when an address is present, so the
-- requirement in §4.4 ("delivery_address required if delivery") is enforced by
-- the data rather than only by the resolver.
ALTER TABLE agizo_maalum
  DROP CONSTRAINT IF EXISTS agizo_anwani_ya_kuleta_inahitajika;
ALTER TABLE agizo_maalum
  ADD CONSTRAINT agizo_anwani_ya_kuleta_inahitajika
  CHECK (njia_ya_kutimiza <> 'delivery' OR NULLIF(BTRIM(anwani_ya_kuleta), '') IS NOT NULL);

-- Catalogue lines must carry a real price (BR-02 / D-27). Custom lines start at
-- 0 until the owner quotes them (BR-05); that zero is the signal kipimo_bado
-- reads, not a free cake. A zero catalogue price is the free-cake failure
-- arriving through a different door, so it stays forbidden.
ALTER TABLE agizo_kipimo
  DROP CONSTRAINT IF EXISTS agizo_kipimo_bei_siyo_sifuri;
ALTER TABLE agizo_kipimo
  ADD CONSTRAINT agizo_kipimo_bei_siyo_sifuri
  CHECK (aina = 'custom' OR bei > 0);

-- An order's number is unique, but only once it has one. A NULL number is "not
-- issued yet" rather than a duplicate, which is how a partially-created order
-- can be rolled back and retried without fighting this index.
--
-- Each order needs at least one line to be real, but that cannot be a constraint
-- here: the line is written after the order row, inside the same transaction, and
-- a NOT VALID check would still be re-validated on every insert. The resolver
-- refuses to leave an order with no lines, and the order is rolled back with it
-- if that happens.
