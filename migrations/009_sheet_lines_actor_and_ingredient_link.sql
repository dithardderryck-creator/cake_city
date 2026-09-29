-- 009_sheet_lines_actor_and_ingredient_link.sql
-- Corrections to 008, found while building the chef sheet against real data.
--
-- 1. 008's per-sheet uniqueness was one ingredient per sheet. A recipe can list
--    the same ingredient twice, once for the base and once for the frosting, and
--    that is the case the whole sehemu column exists to express. 008's index made
--    those recipes unrecordable, and made the sheet claim something the recipe
--    book does not say. The uniqueness has to be per recipe line for lines that
--    came from the recipe, and per ingredient only for the chef's own extras.
--
-- 2. The audit log recorded what changed but never who changed it, so no history
--    anywhere in the app could name a person. The actor is passed in by the
--    request layer as a transaction-local setting, which is the only way a
--    trigger can know, and the only way that cannot leak between pooled requests.
--
-- 3. 008's CHECK named kumbukumbu_matumizi_line_matches_ingredient but only
--    tested that malighafi_id was present, which proves nothing about the link.
--    A link that points at a recipe line mentioning a different ingredient is a
--    sheet contradicting the recipe, and it has to be refused at the database,
--    not only in the resolver that happens to be in front of it today.

-- ── 1. Per-line uniqueness instead of per-ingredient ────────────────────────────

-- The old index is wrong rather than merely incomplete, so it goes. Re-adding it
-- would make the constraint below impossible to create.
DROP INDEX IF EXISTS uq_kumbukumbu_sheeti_line;

-- A recipe-sourced line is identified by which recipe line it came from, so the
-- same ingredient twice in one sheet is allowed and the same line twice is not.
-- A retried submission that partly succeeded would otherwise write the same
-- recipe line twice and leave inventory verifying two halves of one line.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kumbukumbu_sheeti_kipengele
  ON kumbukumbu_matumizi(zingumiaji_id, mapishi_kipengele_id)
  WHERE zingumiaji_id IS NOT NULL AND mapishi_kipengele_id IS NOT NULL;

-- An extra is identified by the ingredient itself, because an extra has no
-- recipe line to point at.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kumbukumbu_sheeti_ya_ziada
  ON kumbukumbu_matumizi(zingumiaji_id, malighafi_id)
  WHERE zingumiaji_id IS NOT NULL AND mapishi_kipengele_id IS NULL;

COMMENT ON INDEX uq_kumbukumbu_sheeti_kipengele IS
  'One line per recipe line per sheet. The same ingredient may appear twice in a '
  'sheet when the recipe uses it in two sections.';
COMMENT ON INDEX uq_kumbukumbu_sheeti_ya_ziada IS
  'One row per extra ingredient per sheet. Extras have no recipe line, so the '
  'ingredient is the identity.';

-- ── 2. Name the person in the audit log ───────────────────────────────────────

ALTER TABLE kumbukumbu_kitendo ADD COLUMN IF NOT EXISTS fanya_kwa INTEGER;

DO $$ BEGIN
  ALTER TABLE kumbukumbu_kitendo
    ADD CONSTRAINT kumbukumbu_kitendo_fanya_kwa_fk
    FOREIGN KEY (fanya_kwa) REFERENCES mtumiaji(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN kumbukumbu_kitendo.fanya_kwa IS
  'Who caused the change. Supplied by the request layer as a transaction-local '
  'setting, because a trigger has no other way to know. NULL for changes made '
  'outside a request, such as a migration.';

-- The trigger body is replaced rather than edited in place, because a function
-- that an existing trigger depends on has to keep the same name and signature.
CREATE OR REPLACE FUNCTION fn_audit_kitendo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  kabla JSONB;
  baada JSONB;
  nini INT;
BEGIN
  IF TG_TABLE_NAME = 'mtumiaji' THEN
    kabla := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'pin_hash' ELSE NULL END;
    baada := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'pin_hash' ELSE NULL END;
  ELSE
    kabla := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    baada := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  END IF;

  -- Set by the request layer inside the same transaction, and scoped to it, so a
  -- pooled connection carrying somebody's id into somebody else's request cannot
  -- happen. NULL when unset: current_setting on an unknown name raises, hence the
  -- second argument.
  BEGIN
    nini := NULLIF(current_setting('app.fanya_kwa', true), '')::INT;
  EXCEPTION WHEN OTHERS THEN
    nini := NULL;
  END;

  INSERT INTO kumbukumbu_kitendo (meza, kitendo, node_id, data_ya_kabla, data_ya_baada, fanya_kwa)
  VALUES (TG_TABLE_NAME, TG_OP, COALESCE((NEW).id, (OLD).id), kabla, baada, nini);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 3. A recipe line reference has to mean something ───────────────────────────

CREATE OR REPLACE FUNCTION fn_kumbukumbu_matumizi_anagendelea_kiungo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  malighafi_ya_recipe INTEGER;
  sehemu_ya_recipe VARCHAR(30);
BEGIN
  IF NEW.mapishi_kipengele_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- malighafi_id, not kiasi. The line on a sheet names an ingredient and a
  -- quantity, and it is the ingredient that has to agree with the recipe line
  -- it points at. Reading the quantity here compared a number of kilograms
  -- against an ingredient id, so every line carrying a recipe reference was
  -- rejected, and a sheet that the API had already validated could not be saved.
  SELECT malighafi_id, sehemu INTO malighafi_ya_recipe, sehemu_ya_recipe
    FROM mapishi_kipengele WHERE id = NEW.mapishi_kipengele_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kipengele cha mapishi % hakipo.', NEW.mapishi_kipengele_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF malighafi_ya_recipe IS NULL OR malighafi_ya_recipe <> NEW.malighafi_id THEN
    RAISE EXCEPTION
      'Kipengele cha mapishi % hakihusiani na malighafi % (mapishi ina malighafi % sasa, sheet ina %).',
      NEW.mapishi_kipengele_id, NEW.malighafi_id, malighafi_ya_recipe, NEW.malighafi_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The section is copied from the recipe rather than trusted, so a sheet cannot
  -- claim the cocoa went in the filling because the client said so.
  IF NEW.sehemu IS NULL AND sehemu_ya_recipe IS NOT NULL THEN
    NEW.sehemu := sehemu_ya_recipe;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kumbukumbu_matumizi_anagendelea_kiungo ON kumbukumbu_matumizi;
CREATE TRIGGER kumbukumbu_matumizi_anagendelea_kiungo
  BEFORE INSERT OR UPDATE ON kumbukumbu_matumizi
  FOR EACH ROW EXECUTE FUNCTION fn_kumbukumbu_matumizi_anagendelea_kiungo();

-- The old CHECK claimed to enforce the link and did not. Keep it (it is cheap and
-- still true) but stop it being the thing that reads as enforcement.
-- The old CHECK has to go as well as the new one going on. It claimed to enforce
-- the link and compared an ingredient id to a quantity, so every sheet line
-- carrying a recipe reference violated it on a fresh database.
ALTER TABLE kumbukumbu_matumizi DROP CONSTRAINT IF EXISTS kumbukumbu_matumizi_line_matches_ingredient;

DO $$ BEGIN
  ALTER TABLE kumbukumbu_matumizi
    ADD CONSTRAINT kumbukumbu_matumizi_line_has_ingredient
    CHECK (mapishi_kipengele_id IS NULL OR malighafi_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON CONSTRAINT kumbukumbu_matumizi_line_has_ingredient ON kumbukumbu_matumizi IS
  'A line that points at a recipe line must name an ingredient. Whether that '
  'ingredient is the right one is enforced by trigger '
  'kumbukumbu_matumizi_anagendelea_kiungo, which can read the recipe; a CHECK '
  'cannot.';
