-- 001_integrity_constraints.sql
-- Data-integrity backstops for quantities and amounts that move money/stock.
--
-- Every constraint is added NOT VALID first, then VALIDATEd. NOT VALID
-- enforces the rule on all *new* and *updated* rows immediately without
-- scanning or locking existing rows, so this migration is safe on a live
-- shop database. VALIDATE is a separate step that can fail if legacy rows
-- already violate the rule — the runner surfaces those rows by name so the
-- operator can decide, rather than silently rewriting money records.

-- A line item with a non-positive quantity reduces the sale total and
-- inserts a nonsensical mauzo_bidhaa row.
ALTER TABLE mauzo_bidhaa
  ADD CONSTRAINT mauzo_bidhaa_kiasi_positive CHECK (kiasi > 0) NOT VALID;

-- A negative usage log *increases* stock via update_stock_from_usage trigger.
ALTER TABLE kumbukumbu_matumizi
  ADD CONSTRAINT kumbukumbu_matumizi_kiasi_positive CHECK (kiasi > 0) NOT VALID;

-- Same inversion: negative "waste" would increase stock.
ALTER TABLE marekebisho_hisa
  ADD CONSTRAINT marekebisho_hisa_kiasi_positive CHECK (kiasi > 0) NOT VALID;

-- A deposit larger than the order total makes the generated salio column
-- negative.
ALTER TABLE agizo_maalum
  ADD CONSTRAINT agizo_maalum_deposit_not_over_total
  CHECK (malipo_ya_awali <= bei_jumla) NOT VALID;

-- Hard backstop for log_matumizi's race: if the resolver's check-and-insert
-- ever interleaves badly, the row lock plus this constraint make stock going
-- negative fail loudly instead of silently.
ALTER TABLE malighafi
  ADD CONSTRAINT malighafi_stock_non_negative CHECK (kiasi_kilichopo >= 0) NOT VALID;

ALTER TABLE mauzo_bidhaa VALIDATE CONSTRAINT mauzo_bidhaa_kiasi_positive;
ALTER TABLE kumbukumbu_matumizi VALIDATE CONSTRAINT kumbukumbu_matumizi_kiasi_positive;
ALTER TABLE marekebisho_hisa VALIDATE CONSTRAINT marekebisho_hisa_kiasi_positive;
ALTER TABLE agizo_maalum VALIDATE CONSTRAINT agizo_maalum_deposit_not_over_total;
ALTER TABLE malighafi VALIDATE CONSTRAINT malighafi_stock_non_negative;
