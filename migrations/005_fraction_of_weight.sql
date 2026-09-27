-- 005_fraction_of_weight.sql
-- Lets a "slice" recipe (mapamba_variant = 'fraction_of') actually know what
-- fraction it is, so its ingredients can be derived from the parent cake.
--
-- Before this, a fraction_of recipe was structurally allowed but functionally
-- empty: it had no lines of its own and no way to say "I am one tenth of that
-- cake", so Mapishi.viambato returned nothing and the recipe looked broken.
--
-- sehemu_ya_uzito is a ratio, not a weight: 0.10 means "a tenth of the parent".
-- Storing it as a ratio keeps the arithmetic honest — if the parent cake is
-- re-weighed later, every slice automatically reflects the new weight instead
-- of drifting out of sync with a copied absolute number.

ALTER TABLE mapishi
  ADD COLUMN IF NOT EXISTS sehemu_ya_uzito NUMERIC(5,4);

-- The resolver validates the range at the application layer (0 < w < 1), but
-- this is the backstop for anything that writes the column directly.
ALTER TABLE mapishi
  DROP CONSTRAINT IF EXISTS chk_sehemu_ya_uzito;

ALTER TABLE mapishi
  ADD CONSTRAINT chk_sehemu_ya_uzito
  CHECK (mapamba_variant = 'own_recipe' OR sehemu_ya_uzito IS NOT NULL) NOT VALID;

-- Enforced for every new and updated row from the moment the constraint is
-- added. Validation is separate so that a shop which already has fraction_of
-- recipes from before this migration gets a loud, named failure to look at
-- rather than this migration silently rewriting their recipe book.
ALTER TABLE mapishi VALIDATE CONSTRAINT chk_sehemu_ya_uzito;

-- A fraction must point at a real cake, and a cake cannot be its own ancestor.
-- Without this, mapishi_ibaba could form a cycle and the parent-scaling read
-- would recurse forever.
CREATE INDEX IF NOT EXISTS mapishi_ibaba_idx
  ON mapishi (mapishi_ibaba)
  WHERE mapishi_ibaba IS NOT NULL;
