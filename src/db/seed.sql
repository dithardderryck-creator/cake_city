-- Cake City POS – Seed data (system config only)
-- All demo staff, products, ingredients, sales and orders have been removed.
-- The first owner account is created by src/db/init.js using environment variables
-- (CAKE_OWNER_JINA / CAKE_OWNER_PIN). Set them in .env before running db:reset.

-- Prep-time defaults (dakika wa upikaji kwa ukubwa na ladha).
-- These drive the "anza kutengeneza" reminder estimation in the engine.
INSERT INTO muda_wa_kazi (ukubwa, dakika) VALUES
  ('Small',  45),
  ('Medium', 90),
  ('Large',  150),
  ('Chocolate', 95),
  ('Vanilla',   75),
  ('Red Velvet',110)
ON CONFLICT (ukubwa) DO NOTHING;