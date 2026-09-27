-- 004-local-data-repair.sql
-- NOT A MIGRATION. The data half of migration 004, kept out of migrations/ on
-- purpose so `npm run db:migrate` never runs it somewhere it does not belong.
--
-- Migration 004's schema is portable; this part is not. It merges the duplicate
-- customer rows this shop had, remaps the duplicate ingredients, retires a
-- duplicate product, settles usage rows that already moved stock under the old
-- trigger, and seeds six starting recipes. Every one of those decisions is
-- about rows in THIS database -- by id, by name, by what the kitchen actually
-- stocks -- so applying them to a different database would retire real products
-- and merge real customers.
--
-- It has already been applied to this database. It is kept as a record of what
-- the repair did, and as the thing to read before touching the seeded recipe
-- weights. To re-run any part of it, copy the section out and edit it by hand.
--
-- Original section markers are preserved below (B, D1, E).

-- ===========================================================================
-- B. DATA CLEANUP  (must run before section C's unique indexes)
-- ===========================================================================

-- B1. Merge the duplicate customer.
--
-- Live data had simu 0757892413 twice, both named Derryck (ids 1 and 2). The
-- surviving row is the lowest id; the other is repointed and removed. The
-- merge is only safe because a phone number is the customer's own identity --
-- two rows with the same number are the same person by definition.
UPDATE agizo_maalum SET mteja_id = 1 WHERE mteja_id = 2;

DELETE FROM mteja
WHERE id = 2
  AND simu = (SELECT simu FROM mteja WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM agizo_maalum WHERE mteja_id = 2);

-- The one-customer-per-phone-number index that used to live here now lives in
-- migrations/006_customer_and_order_notes.sql. Schema objects do not belong in a
-- file that is deliberately never run on a fresh install: a new database was
-- being created without the constraint. The merge above is the shop-specific
-- part; the index is not.

-- B2. Split family + size out of the free-text name FIRST.
--
-- Order matters: the family has to be derived before duplicates can be spotted,
-- because two rows are duplicates precisely when they land on the same
-- family+size. Doing this the other way round means guessing which rows pair
-- up, and an earlier draft of this migration guessed wrong and deactivated
-- both halves of four products.
--
-- "Keki ya Chokoleti (dira 20)" -> familia 'keki ya chokoleti', ukubwa 'dira 20'.
-- Items with no parenthesised size (Sambusa ya Nyama) get 'nzuri' -- they are
-- sold whole, and the size axis still needs a value for the uniqueness rule.
--
-- 'la' is normalised to 'ya' here. Both are correct Swahili for "of", which is
-- exactly why the catalogue ended up with Cupcake la Chokoleti AND Cupcake ya
-- Chokoleti as separate products. Without this the family+size rule would NOT
-- catch that split -- the two names produce two different family strings, so
-- they never collide. The resolver normalises on insert for the same reason.
--
-- Matched on surrounding spaces rather than \b: PostgreSQL regex has no \b
-- word boundary (that is a backspace), so a \b-based pattern silently matches
-- nothing and the normalisation appears to succeed while doing nothing.
UPDATE bidhaa
SET familia = lower(regexp_replace(regexp_replace(jina, '\s*\(([^)]*)\)\s*$', ''), ' la ', ' ya ', 'g')),
    ukubwa   = COALESCE((regexp_match(lower(jina), '\(([^)]*)\)'))[1], 'nzuri')
WHERE familia IS NULL;

-- B3. Collapse the duplicates, keeping the LOWER id in every pair.
--
-- Every pair below is the same product twice. `active = false` rather than
-- DELETE, so mauzo_bidhaa history keeps pointing at a live row and any wrong
-- call here is undone by flipping the flag back.
UPDATE bidhaa SET active = false WHERE id IN (
  19,  -- Keki ya Chokoleti (dira 20)   == id 5
  20,  -- Keki ya Vanila (dira 20)      == id 6
  21,  -- Keki ya Matunda (dira 24)     == id 7
  23,  -- Keki ya Harusi (safu 3)       == id 8  (differed only by a capital S)
  24,  -- Cupcake ya Chokoleti          == id 1   (collides once 'la' -> 'ya')
  25,  -- Cupcake ya Vanila             == id 2   (collides once 'la' -> 'ya')
  30,  -- Mkate wa Nazi                 == id 12
  34,  -- Mandazi (pcs)                 == id 16
  35   -- Sambusa ya Nyama              == id 17  (same item, one row said "(pcs)")
);

-- B4. The one pair that is NOT obviously safe.
--
-- Biskuti za Chokoleti exists at both TSh 500 (id 10) and TSh 800 (id 28).
-- Nothing in the data says which is correct, so this is a judgement call: the
-- LOWER id is kept, on the assumption that the first row is the original entry
-- and the later one the accidental re-add. If 800 is the real price, flip it:
--   UPDATE bidhaa SET active = false WHERE id = 10;
--   UPDATE bidhaa SET active = true  WHERE id = 28;
UPDATE bidhaa SET active = false WHERE id = 28;

-- B5. Categories, seeded from the existing `aina` values and then corrected.
--
-- The seeded categories are the three real groups. Mapping is done explicitly
-- rather than by copying `aina`, because 19 counter items are filed as 'keki'.
INSERT INTO kategoria (jina) VALUES
  ('Keki'), ('Mkate'), ('Vinywaji na Vikombe'), ('Mboga na Mayafi')
ON CONFLICT (jina) DO NOTHING;

UPDATE bidhaa b SET kategoria_id = k.id
FROM kategoria k
WHERE b.kategoria_id IS NULL
  AND k.jina = CASE
    WHEN b.jina ~* 'cupcake|donut|biskuti|mandazi|pufpuff|sambusa|meringue|jelimatamu|kumquat|cream'
      THEN 'Vinywaji na Vikombe'
    WHEN b.jina ~* 'mkate' THEN 'Mkate'
    WHEN b.jina ~* 'tumbaku|nyanya' THEN 'Mboga na Mayafi'
    ELSE 'Keki' END;

-- B6. Collapse the 12 material rows into the 6 real ingredients.
--
-- Live data had each ingredient twice under two names, and the stock figures
-- were nonsense (3200kg of butter, 15000kg of chocolate, 18000l of vanilla),
-- which made the chef's low-stock panel and the owner's forecasts meaningless.
--
-- Rows 1-6 are kept as the canonical set and renamed to one consistent name
-- each; rows 7-12 are repointed at their survivor and soft-deleted. Anything
-- already referencing a doomed row follows it to the survivor, so no usage,
-- adjustment or reminder history is lost. The quantities on 1-6 are set to the
-- more plausible of the pair -- these are seed values, and the owner should
-- replace them with real figures.
UPDATE kumbukumbu_matumizi SET malighafi_id = 1 WHERE malighafi_id = 7;
UPDATE kumbukumbu_matumizi SET malighafi_id = 2 WHERE malighafi_id = 8;
UPDATE kumbukumbu_matumizi SET malighafi_id = 3 WHERE malighafi_id = 9;
UPDATE kumbukumbu_matumizi SET malighafi_id = 4 WHERE malighafi_id = 10;
UPDATE kumbukumbu_matumizi SET malighafi_id = 5 WHERE malighafi_id = 11;
UPDATE kumbukumbu_matumizi SET malighafi_id = 6 WHERE malighafi_id = 12;
UPDATE marekebisho_hisa  SET malighafi_id = 1 WHERE malighafi_id = 7;
UPDATE marekebisho_hisa  SET malighafi_id = 2 WHERE malighafi_id = 8;
UPDATE marekebisho_hisa  SET malighafi_id = 3 WHERE malighafi_id = 9;
UPDATE marekebisho_hisa  SET malighafi_id = 4 WHERE malighafi_id = 10;
UPDATE marekebisho_hisa  SET malighafi_id = 5 WHERE malighafi_id = 11;
UPDATE marekebisho_hisa  SET malighafi_id = 6 WHERE malighafi_id = 12;
UPDATE ukumbusho        SET malighafi_id = 1 WHERE malighafi_id = 7;
UPDATE ukumbusho        SET malighafi_id = 2 WHERE malighafi_id = 8;
UPDATE ukumbusho        SET malighafi_id = 3 WHERE malighafi_id = 9;
UPDATE ukumbusho        SET malighafi_id = 4 WHERE malighafi_id = 10;
UPDATE ukumbusho        SET malighafi_id = 5 WHERE malighafi_id = 11;
UPDATE ukumbusho        SET malighafi_id = 6 WHERE malighafi_id = 12;

UPDATE malighafi SET active = false WHERE id IN (7, 8, 9, 10, 11, 12);

-- A third flour turned up under a bare alias ('Unga', id 26) that the pairs
-- above did not cover. Caught by exact alias match rather than a blanket
-- "delete anything not in 1-6", because on a live database that would silently
-- destroy any real ingredient an owner had added. An alias is a duplicate of a
-- canonical ingredient by definition; an unrelated name is not.
UPDATE malighafi SET active = false
WHERE active
  AND id NOT IN (1, 2, 3, 4, 5, 6)
  AND lower(jina) IN ('unga', 'sukari', 'mayai', 'siagi', 'chokoleti', 'vanila',
                      'unga wa ngano', 'sukari nyeupe', 'chokoleti ya keki',
                      'vanila extract', 'siagi ya chupa');

UPDATE malighafi SET jina = 'Unga wa Ngano',  kiasi_kilichopo = 40,  unit = 'kg'  WHERE id = 1;
UPDATE malighafi SET jina = 'Sukari Nyeupe',  kiasi_kilichopo = 25,  unit = 'kg'  WHERE id = 2;
UPDATE malighafi SET jina = 'Mayai',          kiasi_kilichopo = 500, unit = 'pcs' WHERE id = 3;
UPDATE malighafi SET jina = 'Siagi',          kiasi_kilichopo = 50,  unit = 'kg'  WHERE id = 4;
UPDATE malighafi SET jina = 'Chokoleti',      kiasi_kilichopo = 30,  unit = 'kg'  WHERE id = 5;
UPDATE malighafi SET jina = 'Vanila',         kiasi_kilichopo = 50,  unit = 'l'   WHERE id = 6;

-- D1. Settle every row that already exists.
--
-- Each of these had its stock effect applied at insert time under the old
-- trigger. They must be marked as already-settled WITHOUT the new trigger
-- seeing them, or every historical ingredient log gets subtracted a second
-- time. This runs before the new trigger is created, which is what makes it
-- safe -- no DISABLE/ENABLE juggling needed.
UPDATE kumbukumbu_matumizi
SET hali = 'imethibitishwa',
    kiasi_halisi = kiasi,
    tarehe_ya_uthibitisho = COALESCE(tarehe, NOW())
WHERE hali = 'inakadiriwa';

-- ===========================================================================
-- E. SEED RECIPES FOR THE SIX TIERED CAKES
-- ===========================================================================
--
-- Recipe amounts are a STARTING POINT, not measured truth. Whoever bakes in
-- this kitchen should weigh one dira 20 and one dira 24 and correct these --
-- a recipe that does not match real output means the stock numbers are wrong
-- from day one and nothing will reveal it for weeks.
--
-- Weights are in each material's canonical unit (kg / l / pcs). Ranges are the
-- suggested band the chef's tap UI pre-fills; he can log outside them.
--
-- NOT seeded: 'keki ya chokoleti' at dira 24, or any dira 18, because the
-- amounts are genuinely not linear in size and a scaled guess would be worse
-- than no recipe. Author those from a real bake.

INSERT INTO mapishi (ladha, ukubwa, dakika_kadirio, mapamba_variant)
VALUES
  ('Keki ya Chokoleti', 'dira 20', 90, 'own_recipe'),
  ('Keki ya Vanila',    'dira 20', 90, 'own_recipe'),
  ('Keki ya Matunda',   'dira 24', 120, 'own_recipe'),
  ('Keki ya Karoti',    'dira 18', 90, 'own_recipe'),
  ('Keki ya Harusi',    'safu 3',  360, 'own_recipe'),
  ('Keki ya Karoti',    'pcs',      10, 'fraction_of')
ON CONFLICT (ladha, ukubwa) DO NOTHING;

-- A slice is cut from the whole cake, so it points at the parent recipe rather
-- than duplicating its ingredient list.
UPDATE mapishi SET mapishi_ibaba = (SELECT id FROM mapishi WHERE ladha = 'Keki ya Karoti' AND ukubwa = 'dira 18')
WHERE ladha = 'Keki ya Karoti' AND ukubwa = 'pcs' AND mapishi_ibaba IS NULL;

-- Chocolate dira 20: the everyday cake, and the one most worth getting right.
INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
SELECT m.id, v.mid, v.lo, v.hi, v.sehemu
FROM mapishi m
CROSS JOIN (VALUES
  (1, 0.80, 1.00, 'mfuatano'),  -- Unga wa Ngano  kg
  (2, 0.70, 0.90, 'mfuatano'),  -- Sukari Nyeupe  kg
  (3, 10,   14,   'mfuatano'),  -- Mayai           pcs
  (4, 0.40, 0.55, 'mfuatano'),  -- Siagi           kg
  (5, 0.50, 0.70, 'mfuatano')   -- Chokoleti       kg
) AS v(mid, lo, hi, sehemu)
WHERE m.ladha = 'Keki ya Chokoleti' AND m.ukubwa = 'dira 20'
ON CONFLICT DO NOTHING;

INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
SELECT m.id, v.mid, v.lo, v.hi, v.sehemu
FROM mapishi m
CROSS JOIN (VALUES
  (1, 0.80, 1.00, 'mfuatano'),
  (2, 0.70, 0.90, 'mfuatano'),
  (3, 10,   14,   'mfuatano'),
  (4, 0.40, 0.55, 'mfuatano'),
  (5, 0.10, 0.20, 'mfuatano'),
  (6, 0.03, 0.06, 'mfuatano')   -- Vanila          l
) AS v(mid, lo, hi, sehemu)
WHERE m.ladha = 'Keki ya Vanila' AND m.ukubwa = 'dira 20'
ON CONFLICT DO NOTHING;

INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
SELECT m.id, v.mid, v.lo, v.hi, v.sehemu
FROM mapishi m
CROSS JOIN (VALUES
  (1, 1.00, 1.25, 'mfuatano'),
  (2, 0.85, 1.10, 'mfuatano'),
  (3, 12,   16,   'mfuatano'),
  (4, 0.50, 0.65, 'mfuatano'),
  (6, 0.04, 0.08, 'mfuatano')
) AS v(mid, lo, hi, sehemu)
WHERE m.ladha = 'Keki ya Matunda' AND m.ukubwa = 'dira 24'
ON CONFLICT DO NOTHING;

INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
SELECT m.id, v.mid, v.lo, v.hi, v.sehemu
FROM mapishi m
CROSS JOIN (VALUES
  (1, 0.70, 0.90, 'mfuatano'),
  (2, 0.60, 0.80, 'mfuatano'),
  (3, 9,    12,   'mfuatano'),
  (4, 0.45, 0.60, 'mfuatano'),
  (6, 0.03, 0.05, 'mfuatano')
) AS v(mid, lo, hi, sehemu)
WHERE m.ladha = 'Keki ya Karoti' AND m.ukubwa = 'dira 18'
ON CONFLICT DO NOTHING;

-- Wedding cake: fondant plus buttercream, so butter and chocolate appear twice
-- under different components -- which is exactly why the recipe-line key
-- includes `sehemu` rather than just the ingredient.
INSERT INTO mapishi_kipengele (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
SELECT m.id, v.mid, v.lo, v.hi, v.sehemu
FROM mapishi m
CROSS JOIN (VALUES
  (1, 4.00, 5.00, 'mfuatano'),
  (2, 3.20, 4.00, 'mfuatano'),
  (3, 48,   60,   'mfuatano'),
  (4, 1.60, 2.00, 'krimu'),
  (4, 0.60, 0.80, 'mfuatano'),
  (5, 1.20, 1.60, 'krimu'),
  (5, 0.80, 1.00, 'mfuatano'),
  (6, 0.10, 0.15, 'mfuatano')
) AS v(mid, lo, hi, sehemu)
WHERE m.ladha = 'Keki ya Harusi' AND m.ukubwa = 'safu 3'
ON CONFLICT DO NOTHING;
