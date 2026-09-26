-- 004_recipes_categories_requests.sql
-- Recipe book, product structure, two-phase usage logging, and owner<->inventory
-- requests. This is the schema half of cakecity-recipe-verification-spec.md.
--
-- Four things happen here, in an order that matters:
--
--   1. Structure. Products get a real family + size instead of a size buried in
--      free-text `jina`, and a real category instead of free-text `aina`. Both
--      of those free-text columns are why the catalogue grew duplicate rows.
--   2. Recipes (mapishi) for CUSTOM cake orders only, with ingredient ranges.
--   3. Usage logging becomes two-phase: the chef records an estimate, and stock
--      only moves when inventory confirms the real number.
--   4. Requests (ombi) so owner and inventory can ask each other for things.
--
-- This file is SCHEMA ONLY and is safe to run on a fresh, empty database.
-- The one-time repairs for this particular shop's data -- merging duplicate
-- customers and ingredients, retiring duplicate products, settling usage rows
-- that already moved stock, and seeding the starting recipes -- live in
-- local-data-repair/ instead. They reference row ids that only mean something
-- in this database, and running them elsewhere would corrupt real rows.
-- The unique indexes in section C are still safe on a fresh install, because a
-- fresh database has no duplicates for them to reject.

-- ===========================================================================
-- A. DDL
-- ===========================================================================

-- A1. Product family + size.
--
-- "Keki ya Chokoleti (dira 20)" and "Keki ya Chokoleti (dira 24)" are the same
-- family at different sizes, and each size is its own sellable thing with its
-- own price and its own recipe. Keeping that as structure stops "dira 20",
-- "Dira 20" and "dira20" from becoming three products, and lets a report group
-- the family.
ALTER TABLE bidhaa
  ADD COLUMN IF NOT EXISTS familia VARCHAR(200),
  ADD COLUMN IF NOT EXISTS ukubwa    VARCHAR(50);

-- A2. Real categories.
--
-- `aina` is free text and 19 counter items (cupcakes, donuts, biskuti, mandazi,
-- sambusa, pufpuff...) are filed under 'keki', which already produced wrong
-- category reporting. Categories become a managed list; `aina` is left in place
-- but nothing new should read it.
CREATE TABLE IF NOT EXISTS kategoria (
  id      SERIAL PRIMARY KEY,
  jina    VARCHAR(100) NOT NULL UNIQUE,
  active  BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE bidhaa
  ADD COLUMN IF NOT EXISTS kategoria_id INTEGER REFERENCES kategoria(id);

-- A3. Recipes, for custom cake orders.
CREATE TABLE IF NOT EXISTS mapishi (
  id             SERIAL PRIMARY KEY,
  ladha          VARCHAR(200) NOT NULL,
  ukubwa         VARCHAR(50)  NOT NULL,
  dakika_kadirio INTEGER NOT NULL DEFAULT 90,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  -- A different size needs its own weighed recipe: a dira 24 is NOT 1.2x a
  -- dira 20, because pan depth and baking time change with it. But a slice IS
  -- literally cut from the whole cake, so it can be expressed as a fraction of
  -- its parent. Those two cases are not the same and are not interchangeable.
  mapamba_variant VARCHAR(20) NOT NULL DEFAULT 'own_recipe'
                    CHECK (mapamba_variant IN ('own_recipe', 'fraction_of')),
  mapishi_ibaba   INTEGER REFERENCES mapishi(id),
  created_by      INTEGER REFERENCES mtumiaji(id),
  UNIQUE (ladha, ukubwa)
);

CREATE TABLE IF NOT EXISTS mapishi_kipengele (
  id             SERIAL PRIMARY KEY,
  mapishi_id     INTEGER NOT NULL REFERENCES mapishi(id) ON DELETE CASCADE,
  malighafi_id   INTEGER NOT NULL REFERENCES malighafi(id),
  kiasi_cha_chini NUMERIC(10,2) NOT NULL,
  kiasi_cha_juu   NUMERIC(10,2) NOT NULL,
  -- The same ingredient legitimately appears twice in one cake (flour in the
  -- sponge AND in the frosting), so ingredient + component is the real key.
  sehemu         VARCHAR(30) NOT NULL DEFAULT 'mfuatano',
  CHECK (kiasi_cha_juu >= kiasi_cha_chini),
  UNIQUE (mapishi_id, malighafi_id, sehemu)
);

-- `mapishi_id IS NULL` IS the "custom / off-book" flag; no separate boolean.
ALTER TABLE agizo_maalum
  ADD COLUMN IF NOT EXISTS mapishi_id INTEGER REFERENCES mapishi(id);

-- A4. Materials: soft-delete flag.
--
-- The catalogue listed 12 rows for 6 real ingredients, and there was no way to
-- retire one without deleting it and orphaning every usage row that referenced
-- it. `bidhaa` already uses active = false, so this matches the house pattern.
ALTER TABLE malighafi
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- A5. Two-phase usage: chef's estimate vs inventory's confirmation.
--
-- `kiasi` keeps its meaning: the amount the chef logged, possibly mid-range.
-- `kiasi_halisi` stays NULL until inventory verifies, and that is the number
-- stock actually moves by.
--
-- `kumbukumbu` is the free-text note for logs with no order attached -- the
-- shop's regular production has no order number, so "20 mandazi" is the only
-- thing that will explain the deduction later.
DO $$ BEGIN
  CREATE TYPE hali_uthibitisho_matumizi AS ENUM ('inakadiriwa', 'imethibitishwa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE kumbukumbu_matumizi
  ADD COLUMN IF NOT EXISTS hali hali_uthibitisho_matumizi NOT NULL DEFAULT 'inakadiriwa',
  ADD COLUMN IF NOT EXISTS kiasi_halisi NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS imethibitishwa_na INTEGER REFERENCES mtumiaji(id),
  ADD COLUMN IF NOT EXISTS tarehe_ya_uthibitisho TIMESTAMP,
  ADD COLUMN IF NOT EXISTS kumbukumbu VARCHAR(200);

-- The verification queue is scanned constantly and is always filtered on hali.
CREATE INDEX IF NOT EXISTS idx_kumbukumbu_hali
  ON kumbukumbu_matumizi(hali);

-- A6. Requests between owner and inventory.
--
-- Distinct from the `ukumbusho` reminder engine, which is computer-generated
-- (low stock, pickup due). These are people asking each other, so they need
-- their own table -- but they surface in the same bell so the owner sees one
-- list of things needing attention, not two systems.
DO $$ BEGIN
  CREATE TYPE hali_ombi AS ENUM ('fungua', 'imefanyika');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ombi (
  id                  SERIAL PRIMARY KEY,
  kutoka_kwa          INTEGER NOT NULL REFERENCES mtumiaji(id),
  kwenda_kwa          INTEGER NOT NULL REFERENCES mtumiaji(id),
  ujumbe              TEXT NOT NULL,
  hali                hali_ombi NOT NULL DEFAULT 'fungua',
  jibu                TEXT,
  tarehe_ya_kufunguliwa TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (kutoka_kwa <> kwenda_kwa)
);

CREATE INDEX IF NOT EXISTS idx_ombi_kwenda ON ombi(kwenda_kwa, hali);
CREATE INDEX IF NOT EXISTS idx_ombi_kutoka ON ombi(kutoka_kwa, hali);

-- A7. Verification may legitimately drive stock negative.
--
-- Inventory's job is to record what actually happened. If the system thinks
-- there is no flour left and the chef used 4kg, the true statement is "our
-- stock figure was wrong", not "refuse to let the clerk say so". The old CHECK
-- aborted the whole transaction with a raw constraint error, destroying the
-- correction. Negative now simply reads as low stock, which is the truth.
ALTER TABLE malighafi DROP CONSTRAINT IF EXISTS malighafi_stock_non_negative;

-- ===========================================================================
-- C. UNIQUENESS  (only valid once section B has resolved the duplicates)
-- ===========================================================================

-- One row per family+size. This single index is what stops both the exact
-- duplicates and the 'Cupcake la'/'Cupcake ya' spelling split, because those
-- normalise to the same family and size.
CREATE UNIQUE INDEX IF NOT EXISTS bidhaa_familia_ukubwa_uidx
  ON bidhaa (LOWER(familia), LOWER(ukubwa)) WHERE active = true;

DROP TRIGGER IF EXISTS trigger_usage_decrement_stock ON kumbukumbu_matumizi;

-- Only the single inakadiriwa -> imethibitishwa transition fires this, so
-- re-saving an already-verified row cannot double-decrement. It is an
-- AFTER UPDATE trigger, so a row inserted directly as 'imethibitishwa' would
-- not move stock -- every resolver inserts as 'inakadiriwa', so that path does
-- not exist today, and the CHECK-free stock column means a missed decrement
-- shows up as a variance at the next count rather than an error.
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

DROP TRIGGER IF EXISTS trigger_usage_decrement_on_verify ON kumbukumbu_matumizi;
CREATE TRIGGER trigger_usage_decrement_on_verify
  AFTER UPDATE ON kumbukumbu_matumizi
  FOR EACH ROW EXECUTE FUNCTION update_stock_from_verified_usage();
