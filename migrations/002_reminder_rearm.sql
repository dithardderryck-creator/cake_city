-- 002_reminder_rearm.sql
-- Support for re-arming a reminder instead of suppressing it forever.
--
-- Previously the reminder upsert used ON CONFLICT ... DO NOTHING, so once a
-- reminder was marked read it could never fire again for that same
-- (type, role, order/ingredient) key — even when the underlying problem
-- persisted or recurred. updated_at lets the upsert tell "still relevant"
-- apart from "already handled".

ALTER TABLE ukumbusho
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Backfill so pre-existing rows are not treated as infinitely stale.
UPDATE ukumbusho SET updated_at = COALESCE(updated_at, created_at, NOW());
