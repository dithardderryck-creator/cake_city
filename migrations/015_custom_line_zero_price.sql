-- Custom lines start at bei = 0 until quoted (BR-05). Migration 014 forbade
-- bei = 0 for every line; that made ungeza_kipimo of a custom cake impossible.
-- Catalogue lines still cannot be free (BR-02 / D-27).

ALTER TABLE agizo_kipimo
  DROP CONSTRAINT IF EXISTS agizo_kipimo_bei_siyo_sifuri;
ALTER TABLE agizo_kipimo
  ADD CONSTRAINT agizo_kipimo_bei_siyo_sifuri
  CHECK (aina = 'custom' OR bei > 0);
