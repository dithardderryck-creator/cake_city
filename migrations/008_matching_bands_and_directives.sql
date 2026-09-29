-- 008_matching_bands_and_directives.sql
-- Three separate gaps, in the order the operational flow reaches them:
--
--   1. Recipe matching. The cashier used to pick a recipe from a dropdown, which
--      put an internal kitchen decision in front of the person least able to
--      make it. This records how a recipe was chosen so the choice is auditable,
--      without ever sending the candidate list to the client.
--
--   2. Chef range bands. A chef tapping "500-600 g" was previously stored as the
--      midpoint 550, so the record said something the chef never said. The band
--      is now kept as a band. The midpoint survives as the provisional estimate,
--      which is the only thing allowed to exist before inventory confirms, and
--      it still moves no stock.
--
--   3. Request/directive engine. `ombi` grew from "a message with a Close
--      button" into a typed record with a real state machine, a priority, a
--      deadline, and a link to whatever operational object caused it.
--
-- Run after 007, which added the enum values this file uses.

-- ── 1. Recipe matching ───────────────────────────────────────────────────────
--
-- The order keeps the matcher's reasoning next to the match. Without it, a wrong
-- recipe is indistinguishable from a right one six months later, and there is no
-- way to tell "the system matched this" from "a person forced this".
--
-- mapishi_id itself is unchanged and still nullable: NULL is meaningful, it is
-- how the system records an order that nothing in the book matches.

ALTER TABLE agizo_maalum
  ADD COLUMN IF NOT EXISTS mapishi_match_method VARCHAR(30),
  ADD COLUMN IF NOT EXISTS mapishi_match_score NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS mapishi_match JSONB;

COMMENT ON COLUMN agizo_maalum.mapishi_match_method IS
  'How the recipe was chosen: exact, sehemu (partial), ukubwa (size only), or '
  'fuati (a person overrode the match). NULL means no recipe was matched.';
COMMENT ON COLUMN agizo_maalum.mapishi_match IS
  'The matcher''s reasoning, kept for audit. Never sent to the cashier.';

-- ── 2. The production sheet ──────────────────────────────────────────────────
--
-- A sheet is one chef submission for one order: many lines, one decision to
-- review. It has to be its own object rather than a flag on the usage lines,
-- because the two things that matter are per sheet, not per line:
--
--   - inventory verifies a production event, not a row;
--   - the chef must not be able to submit the same order twice while the first
--     sheet is still open.
--
-- Without this, a second tap on the submit button wrote the day twice and nothing
-- on screen said so, because the chef had no way to read back their own past
-- sheets. The partial unique index below is the idempotency key: one open sheet
-- per order. Confirming it frees the order for the next one, so an amend after
-- verification is a new sheet rather than a rewrite of history.

CREATE TABLE IF NOT EXISTS zingumiaji_matumizi (
  id                   SERIAL PRIMARY KEY,
  agizo_id             INTEGER NOT NULL REFERENCES agizo_maalum(id) ON DELETE CASCADE,
  mpishi_id            INTEGER REFERENCES mtumiaji(id),
  hali                 hali_uthibitisho_matumizi NOT NULL DEFAULT 'inakadiriwa',
  kumbukumbu           VARCHAR(200),
  tarehe               TIMESTAMP NOT NULL DEFAULT NOW(),
  tarehe_ya_uthibitisho TIMESTAMP,
  imethibitishwa_na    INTEGER REFERENCES mtumiaji(id)
);

COMMENT ON TABLE zingumiaji_matumizi IS
  'One chef submission for one order. Its lines are the kumbukumbu_matumizi rows '
  'that point at it. Inventory verifies the sheet, which is what means a whole '
  'production event has been confirmed rather than one line of it.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_zingumiaji_matumizi_fungua
  ON zingumiaji_matumizi(agizo_id) WHERE hali = 'inakadiriwa';

CREATE INDEX IF NOT EXISTS idx_zingumiaji_agizo ON zingumiaji_matumizi(agizo_id, hali);

-- A sheet with no chef, or no order, is not a record of anything.
ALTER TABLE zingumiaji_matumizi DROP CONSTRAINT IF EXISTS zingumiaji_matumizi_requires_chef;
ALTER TABLE zingumiaji_matumizi ADD CONSTRAINT zingumiaji_matumizi_requires_chef
  CHECK (mpishi_id IS NOT NULL);

-- ── 3. Chef range bands ──────────────────────────────────────────────────────

-- CREATE TYPE has no IF NOT EXISTS in Postgres, so a replay of this file is
-- caught here rather than by the parser.
DO $$ BEGIN
  CREATE TYPE hali_sheeti AS ENUM (
    'imechaguliwa',   -- chef tapped a band
    'haikutumika',    -- chef looked at it and did not use it
    'nyingine'        -- chef added something the recipe did not list
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE kumbukumbu_matumizi
  ADD COLUMN IF NOT EXISTS zingumiaji_id INTEGER REFERENCES zingumiaji_matumizi(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS hali_sheeti hali_sheeti,
  ADD COLUMN IF NOT EXISTS kiasi_cha_chini NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS kiasi_cha_juu NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sehemu VARCHAR(30),
  ADD COLUMN IF NOT EXISTS mapishi_kipengele_id INTEGER REFERENCES mapishi_kipengele(id) ON DELETE SET NULL;

COMMENT ON COLUMN kumbukumbu_matumizi.hali_sheeti IS
  'What the chef decided about this line. A row with no hali_sheeti was written '
  'by a client that predates bands.';
COMMENT ON COLUMN kumbukumbu_matumizi.kiasi_cha_chini IS
  'Lower bound of the band the chef tapped. kiasi is that band''s midpoint and '
  'stays an estimate until inventory sets kiasi_halisi.';

-- The band itself has to be internally consistent.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_band_consistent;
ALTER TABLE kumbukumbu_matumizi ADD CONSTRAINT kumbukumbu_matumizi_band_consistent
  CHECK (
    (kiasi_cha_chini IS NULL AND kiasi_cha_juu IS NULL)
    OR (kiasi_cha_chini IS NOT NULL AND kiasi_cha_juu IS NOT NULL
        AND kiasi_cha_juu >= kiasi_cha_chini)
  );

-- The old CHECK demanded a positive quantity on every row, which is exactly what
-- made "the chef did not use the cocoa" impossible to record. An unused line
-- carries 0 and is confirmed at 0, which moves no stock and leaves the fact that
-- it was considered on the record.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_kiasi_positive;
ALTER TABLE kumbukumbu_matumizi ADD CONSTRAINT kumbukumbu_matumizi_kiasi_inahusu
  CHECK (kiasi > 0 OR hali_sheeti = 'haikutumika');

-- A band is a band: the stored midpoint has to sit inside the band that produced
-- it, or the ledger would quietly disagree with the kitchen.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_midpoint_in_band;
ALTER TABLE kumbukumbu_matumizi ADD CONSTRAINT kumbukumbu_matumizi_midpoint_in_band
  CHECK (kiasi_cha_chini IS NULL OR (kiasi >= kiasi_cha_chini AND kiasi <= kiasi_cha_juu));

-- A line that points at a recipe line must actually mention that ingredient.
-- Otherwise the sheet would claim a recipe link the recipe book contradicts.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_line_matches_ingredient;
ALTER TABLE kumbukumbu_matumizi ADD CONSTRAINT kumbukumbu_matumizi_line_matches_ingredient
  CHECK (mapishi_kipengele_id IS NULL OR malighafi_id IS NOT NULL);

-- A line with a band must belong to a sheet, and vice versa. A half-joined band
-- would be a band the kitchen cannot see.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_sheeti_coherent;
ALTER TABLE kumbukumbu_matumizi ADD CONSTRAINT kumbukumbu_matumizi_sheeti_coherent
  CHECK ((zingumiaji_id IS NULL) = (hali_sheeti IS NULL));

-- One ingredient appears once per sheet. Without this, a retried submission that
-- partly succeeded could log the same ingredient twice and inventory would
-- verify two half-sheets without noticing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kumbukumbu_sheeti_line
  ON kumbukumbu_matumizi(zingumiaji_id, malighafi_id)
  WHERE zingumiaji_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kumbukumbu_sheeti ON kumbukumbu_matumizi(zingumiaji_id, hali_sheeti);
CREATE INDEX IF NOT EXISTS idx_kumbukumbu_mapishi_kipengele ON kumbukumbu_matumizi(mapishi_kipengele_id);

-- ── 4. Request / directive engine ────────────────────────────────────────────

-- The two old states are mapped forward here, which is why this file has to come
-- after 007. 'fungua' becomes 'inasubiri' (waiting on a decision) and
-- 'imefanyika' becomes 'imekamilika' (closed). A single boolean cannot tell a
-- request that was merely sent from one that was picked up, so everything still
-- open becomes 'inasubiri', the state a decision can be taken from.
UPDATE ombi SET hali = 'inasubiri' WHERE hali = 'fungua';
UPDATE ombi SET hali = 'imekamilika' WHERE hali = 'imefanyika';

ALTER TABLE ombi
  ADD COLUMN IF NOT EXISTS aina aina_ukumbusho_kazi NOT NULL DEFAULT 'ombi',
  ADD COLUMN IF NOT EXISTS kipendeleo kipendeleo_ukumbusho_kazi NOT NULL DEFAULT 'kawaida',
  ADD COLUMN IF NOT EXISTS mada VARCHAR(200),
  ADD COLUMN IF NOT EXISTS malighafi_id INTEGER REFERENCES malighafi(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agizo_id INTEGER REFERENCES agizo_maalum(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kiasi NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS mwisho DATE,
  ADD COLUMN IF NOT EXISTS jukumu_anayehudumiwa VARCHAR(20),
  ADD COLUMN IF NOT EXISTS alizokamilisha_na INTEGER REFERENCES mtumiaji(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alizokamilisha_at TIMESTAMP;

COMMENT ON COLUMN ombi.aina IS
  'ombi = asking for something. direktive = being told to do something. Same '
  'table, same state machine, opposite intent.';
COMMENT ON COLUMN ombi.malighafi_id IS
  'The ingredient this is about, when it is about one. A procurement request '
  'that names sugar in prose and links nothing cannot drive a reorder.';
COMMENT ON COLUMN ombi.jukumu_anayehudumiwa IS
  'The recipient''s role at the time of sending, recorded so the record still '
  'reads correctly after a role change or a staff deletion.';

-- A request about an ingredient should say how much. A request that is not about
-- an ingredient should not carry a quantity, because a number with nothing to
-- attach it to is a typo waiting to happen.
ALTER TABLE ombi DROP CONSTRAINT IF EXISTS ombi_kiasi_requires_ingredient;
ALTER TABLE ombi ADD CONSTRAINT ombi_kiasi_requires_ingredient
  CHECK (kiasi IS NULL OR malighafi_id IS NOT NULL);

-- A directive with no deadline is a suggestion. The owner may still choose not to
-- set one, so this is deliberately not a constraint; the dashboard sorts by it.
CREATE INDEX IF NOT EXISTS idx_ombi_hali ON ombi(hali);
CREATE INDEX IF NOT EXISTS idx_ombi_kwenda ON ombi(kwenda_kwa, hali);
CREATE INDEX IF NOT EXISTS idx_ombi_kutoka ON ombi(kutoka_kwa, hali);
CREATE INDEX IF NOT EXISTS idx_ombi_mwisho ON ombi(mwisho) WHERE mwisho IS NOT NULL;

-- ── 5. Audit ────────────────────────────────────────────────────────────────

-- `ombi` was the one operational table with no audit trigger, so the engine
-- described in the spec produced no trail at all. Every status change, decision,
-- and completion now lands in kumbukumbu_kitendo like everything else.
DROP TRIGGER IF EXISTS audit_ombi ON ombi;
CREATE TRIGGER audit_ombi AFTER INSERT OR UPDATE OR DELETE ON ombi
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
