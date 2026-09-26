-- 003_order_payments_as_sales.sql
-- Record money taken on a special order in the same sales ledger as the till.
--
-- `agizo_maalum` tracks what a customer OWES (bei_jumla / malipo_ya_awali /
-- salio), but nothing recorded what they actually PAID. A deposit taken at the
-- counter was real money in the till that appeared in no sales figure, and
-- because `salio` is a generated column there was also no way to settle the
-- remainder at pickup.
--
-- Linking a mauzo row to its order lets any payment — the deposit or a later
-- balance collection — be written into the sales ledger, so the cashier's daily
-- total means "money actually taken today". A NULL agizo_id is an ordinary
-- counter sale, so existing rows and reports are unaffected.

ALTER TABLE mauzo
  ADD COLUMN IF NOT EXISTS agizo_id INTEGER REFERENCES agizo_maalum(id) ON DELETE SET NULL;

-- Settling a balance looks up the order's payments, and the dashboard groups by
-- this to separate order takings from plain counter sales.
CREATE INDEX IF NOT EXISTS idx_mauzo_agizo ON mauzo(agizo_id);

-- A single order may be paid in several instalments (deposit + balance), but
-- never twice for the same amount by accident: the mutation validates the
-- running total, and this index keeps that check cheap.
CREATE INDEX IF NOT EXISTS idx_agizo_malipo ON agizo_maalum(id, malipo_ya_awali);
