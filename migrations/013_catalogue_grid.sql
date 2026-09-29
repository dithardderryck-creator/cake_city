-- §4.2 / D-26 / D-27 / BR-02: the catalogue becomes a variation grid.
--
-- bidhaa was flat: one row is one thing with one price. The blueprint's model
-- is a product that has axes of variation (Size, Filling, Dietary), a shared
-- library of values across products, and a Combination per specific version
-- with its own price and stock count. That is what "Chocolate Fudge, 8-inch,
-- Vanilla cream, Eggless" is.
--
-- Q-03 is resolved here as multi-choice for a group whose values can combine
-- (a person can want eggless AND gluten-free). This is not a schema fork: a
-- single- or multi-selection group is a column on the group, and the
-- combination is a set of values either way. What changes is the validation
-- rule below, which is why it is written once and enforced by a trigger rather
-- than by the resolver alone.
--
-- Backfill: every existing bidhaa row becomes a product with one combination
-- carrying its current price. A drink with no variations still has exactly one
-- combination, and every existing sale line keeps pointing at something real.
--
-- Nothing is dropped. bidhaa.bei stays as the price of a product's single
-- combination, so the old sell screen and old queries keep working unchanged
-- until they are moved onto the grid.

-- ---------------------------------------------------------------- groups ---
CREATE TABLE IF NOT EXISTS chagizo_kundi (
  id          serial PRIMARY KEY,
  jina        text NOT NULL,              -- Size/servings, Filling, Dietary
  -- 'moja' (single) or 'nyingi' (multi). This is the Q-03 answer, per group:
  -- a shop can make Dietary multi and Size single without the schema caring.
  uteuzi      text NOT NULL DEFAULT 'moja'
                CHECK (uteuzi IN ('moja', 'nyingi')),
  -- A required group must have a value chosen on every combination.
  inahitaji   boolean NOT NULL DEFAULT true,
  -- Products are archived not deleted (BR-10); a shared library is no
  -- different, and an archived group must stop appearing in pickers.
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now(),
  created_by  int REFERENCES mtumiaji(id),
  UNIQUE (jina)
);

-- ---------------------------------------------------------------- values ---
CREATE TABLE IF NOT EXISTS chagizo_thamani (
  id          serial PRIMARY KEY,
  kundi_id    int NOT NULL REFERENCES chagizo_kundi(id) ON DELETE CASCADE,
  jina        text NOT NULL,              -- "8-inch", "Vanilla cream", "Eggless"
  -- Declared allergens travel with the value, so a combination's allergen list
  -- is the union of its values' lists and a snapshot can be frozen from it
  -- (BR-11). Sorted, deduped by the writer.
  viambisho   text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now(),
  created_by  int REFERENCES mtumiaji(id),
  UNIQUE (kundi_id, jina)
);

-- ---------------------------------------------------------- combinations ---
CREATE TABLE IF NOT EXISTS mchanganyiko (
  id          serial PRIMARY KEY,
  bidhaa_id   int NOT NULL REFERENCES bidhaa(id) ON DELETE CASCADE,
  -- D-27: the owner sets this by hand. There is no price rule engine, and none
  -- is coming; a combination that should not exist is marked unavailable
  -- instead.
  bei         numeric(12,2) NOT NULL CHECK (bei >= 0),
  -- A-14: every available combination carries a stock count.
  hesafa      int NOT NULL DEFAULT 0 CHECK (hesafa >= 0),
  status      text NOT NULL DEFAULT 'patikana'
                CHECK (status IN ('patikana', 'haipatikani')),
  -- The frozen label, so a receipt and an old order read correctly even after
  -- the owner renames a value or archives it (BR-11).
  maelezo     text,
  created_at  timestamp NOT NULL DEFAULT now(),
  created_by  int REFERENCES mtumiaji(id),
  -- A product cannot have the same set of option values twice. Enforced on the
  -- value set in the trigger below, since it spans two tables.
  UNIQUE (bidhaa_id, id)
);

-- The join that makes the grid a grid: a combination picks one value per group
-- (single) or several (multi).
CREATE TABLE IF NOT EXISTS mchanganyiko_thamani (
  mchanganyiko_id int NOT NULL REFERENCES mchanganyiko(id) ON DELETE CASCADE,
  thamani_id      int NOT NULL REFERENCES chagizo_thamani(id) ON DELETE CASCADE,
  PRIMARY KEY (mchanganyiko_id, thamani_id)
);

CREATE INDEX IF NOT EXISTS idx_ct_thamani ON mchanganyiko_thamani(thamani_id);
CREATE INDEX IF NOT EXISTS idx_mch_bidhaa  ON mchanganyiko(bidhaa_id);

-- ------------------------------------------------ product <-> group link ---
-- A group is a shared library reused across products (§4.2), so the link is its
-- own table rather than a column on bidhaa. nafasi is the order the owner
-- wants the axes to appear in on the sell screen.
CREATE TABLE IF NOT EXISTS chagizo_kundi_kazi (
  bidhaa_id int NOT NULL REFERENCES bidhaa(id) ON DELETE CASCADE,
  kundi_id   int NOT NULL REFERENCES chagizo_kundi(id) ON DELETE CASCADE,
  nafasi     int NOT NULL DEFAULT 0,
  PRIMARY KEY (bidhaa_id, kundi_id)
);

CREATE INDEX IF NOT EXISTS idx_ckk_kundi ON chagizo_kundi_kazi(kundi_id);

-- ------------------------------------------------ combination validation ---
-- Enforced in the database, not only in the resolver, because the rule is about
-- the shape of a thing rather than about who typed it: a single-selection group
-- has exactly one value, a multi group at least one, and a required group is
-- never left empty. Anything that writes a combination gets this, including a
-- future import.
--
-- Deferred to the end of the statement on purpose. A row-level trigger fires
-- per inserted value and so cannot tell whether the set is finished — inserting
-- "8-inch" then "Vanilla" would fail a single-group check on the first row.
-- Checking once at the end lets a combination be built in as many statements
-- as it takes, which is also how the generate-combinations resolver wants to
-- write it.
CREATE OR REPLACE FUNCTION thibitisha_mchanganyiko() RETURNS trigger AS $$
DECLARE
  kundi_bad text;
  uteuzi_bad text;
  picked     int;
BEGIN
  -- Walk the groups this product uses, and find the first one the combination
  -- that was just written does not satisfy. Reported one at a time so the
  -- message names the actual axis rather than a count.
  FOR kundi_bad, uteuzi_bad, picked IN
    SELECT k.jina, k.uteuzi, count(v.id)
      FROM chagizo_kundi_kazi gk
      JOIN chagizo_kundi k ON k.id = gk.kundi_id
      LEFT JOIN mchanganyiko_thamani mv
             ON mv.mchanganyiko_id = NEW.mchanganyiko_id
      LEFT JOIN chagizo_thamani v
             ON v.id = mv.thamani_id AND v.kundi_id = k.id
     WHERE gk.bidhaa_id = (SELECT bidhaa_id FROM mchanganyiko
                            WHERE id = NEW.mchanganyiko_id)
       AND k.inahitaji
       AND k.active
     GROUP BY k.jina, k.uteuzi
    -- Empty is wrong for a required group, whatever its selection type.
    HAVING count(v.id) = 0
        -- More than one is only wrong for a single-selection group.
        OR (k.uteuzi = 'moja' AND count(v.id) > 1)
     LIMIT 1
  LOOP
    -- One message for both failures, because from the person filling the form
    -- they are the same mistake: the Size axis was not answered correctly. The
    -- count says which way it went wrong.
    RAISE EXCEPTION
      'Mchanganyiko haukidhi kundi "%" (uteuzi %): zilizochaguliwa %. Inahitaji thamani %s',
      kundi_bad, uteuzi_bad, picked,
      CASE WHEN picked = 0
           THEN 'hakuna — chagua moja kwenye kundi hili'
           WHEN uteuzi_bad = 'moja'
           THEN 'moja tu — kundi hili ni single-choice'
           ELSE 'au zaidi — kundi hili ni multi-choice'
      END
      USING ERRCODE = 'check_violation';
  END LOOP;

  RETURN NULL;  -- AFTER trigger: the return value is ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_thibitisha_mchanganyiko ON mchanganyiko_thamani;
CREATE CONSTRAINT TRIGGER trg_thibitisha_mchanganyiko
  AFTER INSERT OR UPDATE ON mchanganyiko_thamani
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION thibitisha_mchanganyiko();

-- ---------------------------------------------------------------- backfill --
-- Every existing bidhaa becomes a product with exactly one combination at its
-- current price. A drink with no axes of variation still has one combination:
-- "one thing" is a grid of one, and the sell screen then has nothing special
-- to handle. Nothing here is guessed — the label is the product's own name.
--
-- Idempotent, so a re-run after a partial failure does not duplicate. The
-- product id is the natural key: one combination per bidhaa, always.
INSERT INTO mchanganyiko (bidhaa_id, bei, hesafa, status, maelezo)
SELECT b.id, b.bei, 0,
       CASE WHEN b.active THEN 'patikana' ELSE 'haipatikani' END,
       b.jina
  FROM bidhaa b
 WHERE NOT EXISTS (SELECT 1 FROM mchanganyiko m WHERE m.bidhaa_id = b.id);



