-- 006_customer_and_order_notes.sql
-- Customer-level and order-level free text, plus the phone-number backstop
-- that keeps one person from splitting into two customer records.
--
-- Three separate things, deliberately not merged:
--
--   mteja.mzio                  the PERSON's allergy info. It does not change
--                               between orders, so it lives on the customer and
--                               follows them to every future order.
--   agizo_maalum.maelekezo_maalum  THIS order's special instructions. Changes
--                               every time, so it belongs to the order.
--   agizo_maalum.umbo           the cake's shape. Free text, not a managed
--                               list: a product catalogue is finite and
--                               duplicates are a real recurring problem, but a
--                               custom shape is inherently one-off and
--                               creative, so a lookup table would be overhead
--                               with no dedup benefit.

ALTER TABLE mteja ADD COLUMN IF NOT EXISTS mzio TEXT;
ALTER TABLE agizo_maalum ADD COLUMN IF NOT EXISTS maelekezo_maalum TEXT;
ALTER TABLE agizo_maalum ADD COLUMN IF NOT EXISTS umbo VARCHAR(100);

-- The backstop for customer deduplication. unda_agizo now looks up an existing
-- customer by phone before inserting, but that is application logic and can be
-- bypassed by a concurrent insert; this makes a duplicate physically
-- impossible.
--
-- This index used to live in local-data-repair/, which was wrong: that file is
-- shop-specific and is deliberately never run on a fresh install, so a new
-- database was silently created without the constraint. Schema objects belong
-- in migrations/.
--
-- The partial predicate matters: a customer with no phone number recorded, or an
-- empty string from a cash-only walk-in, must not collide with the next one.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(d.simu || ' (' || d.n || ' rows)', ', ')
    INTO dupes
    FROM (
      SELECT simu, count(*) AS n
        FROM mteja
       WHERE simu IS NOT NULL AND btrim(simu) <> ''
       GROUP BY simu
      HAVING count(*) > 1
    ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce one customer per phone number. These numbers are used by more than one customer record: %',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mteja_simu_uidx
  ON mteja (simu)
  WHERE simu IS NOT NULL AND btrim(simu) <> '';
